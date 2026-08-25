import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

import {
  createMinecraftService,
  mcSystemPrompt,
  extractDecision,
  pickReaction,
  REACTIONS,
  SILENT_TASKS,
  mcErrorLine
} from '../src/main/services/minecraft.service.js'
import { DEFAULTS } from '../src/main/data/defaults.js'
import { on } from '../src/main/bus.js'

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mc-'))
  fs.mkdirSync(path.join(root, 'drone'))
  fs.writeFileSync(path.join(root, 'drone', 'bot.js'), '// drone')
  return root
}

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
    this.kill = vi.fn()
    this.spawnArgs = null
  }
}

class FakeWS extends EventEmitter {
  constructor(url) {
    super()
    this.url = url
    this.sent = []
    this.closed = false
    FakeWS.instances.push(this)
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.closed = true
  }
  static instances = []
  static reset() {
    FakeWS.instances = []
  }
}

function makeHarness({
  ai = {},
  save = {},
  onlineApiModel = 'fallback-model',
  fetchImpl,
  rand = () => 0,
  rootOverride
} = {}) {
  const root = rootOverride ?? makeRoot()
  const configState = {
    online_api_model: onlineApiModel,
    minecraft_v2: {
      ...structuredClone(DEFAULTS.minecraft_v2),
      brain_url: 'http://brain.test/v1/chat',
      brain_key: 'sk-test',
      ...ai
    }
  }
  const config = {
    getConfig: () => configState,
    getSave: () => ({ pet_name: 'Raven', user_name: 'User', persona: 'Gothic', ...save })
  }
  let lastChild = null
  const spawnImpl = (_cmd, args, opts) => {
    lastChild = new FakeChild()
    lastChild.spawnArgs = { args, opts }
    return lastChild
  }
  FakeWS.reset()
  const svc = createMinecraftService({
    rootDir: root,
    config,
    getWin: () => null,
    spawnImpl,
    WebSocketImpl: FakeWS,
    fetchImpl: fetchImpl ?? (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) })),
    rand
  })
  const collectors = {}
  const watch = (topic) => {
    const arr = []
    const off = on(topic, (p) => arr.push(p))
    ;(collectors[topic] ??= []).push(off)
    return arr
  }
  const stopWatching = () => {
    for (const offs of Object.values(collectors)) for (const off of offs) off()
  }

  async function openChannel() {
    svc.connect()
    vi.advanceTimersByTime(1500)
    const ws = FakeWS.instances.at(-1)
    ws.emit('open')
    return ws
  }

  return { svc, config, configState, watch, stopWatching, openChannel, child: () => lastChild, root }
}

const brainReply = (content) => async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] })
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

// Drain every await point inside callModel chains (setImmediate stays real
// because only setTimeout/clearTimeout are faked).
const flushAsync = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
}

describe('minecraft brain — JSON extraction', () => {
  it('parses clean JSON', () => {
    expect(extractDecision('{"chat":"hi","emotion":"happy"}')).toEqual({ chat: 'hi', emotion: 'happy' })
  })

  it('strips ```json fences', () => {
    expect(extractDecision('```json\n{"chat":"yo","emotion":"neutral"}\n```')).toEqual({ chat: 'yo', emotion: 'neutral' })
  })

  it('finds a JSON block wrapped in prose', () => {
    const raw = 'Sure! Here you go: {"chat":"x","emotion":"love"} — hope that helps!'
    expect(extractDecision(raw)).toEqual({ chat: 'x', emotion: 'love' })
  })

  it('returns null for plain text so caller applies fallback', () => {
    expect(extractDecision('just chatting, no structure here')).toBeNull()
  })

  it('returns null for broken JSON blocks', () => {
    expect(extractDecision('{"chat": oops')).toBeNull()
  })
})

describe('minecraft brain — system prompt + pools', () => {
  it('renders persona names and description', () => {
    const sys = mcSystemPrompt({ pet_name: 'Nyx', user_name: 'Abtin', persona: 'Gothic' })
    expect(sys).toContain('You are Nyx, an AI companion playing Minecraft with Abtin.')
    expect(sys).toContain('PERSONALITY:')
    expect(sys).toContain('"emotion": "one of: neutral happy sad angry blush')
  })

  it('falls back to Raven/User when save data is blank', () => {
    const sys = mcSystemPrompt({})
    expect(sys).toContain('You are Raven, an AI companion playing Minecraft with User.')
  })

  it('picks from known pools deterministically', () => {
    expect(pickReaction('death', () => 0)).toBe(REACTIONS.death[0])
    expect(pickReaction('death', () => 0.999)).toBe(REACTIONS.death.at(-1))
    expect(pickReaction('nonexistent_key', () => 0)).toBe('...')
  })

  it('has every legacy reaction pool', () => {
    for (const key of ['task_done', 'task_error', 'death', 'got_diamonds', 'gift_received', 'creeper', 'warden', 'chest_found']) {
      expect(REACTIONS[key].length).toBeGreaterThan(0)
    }
  })

  it('maps connection error codes to companion lines', () => {
    expect(mcErrorLine('ETIMEDOUT at 1.2.3.4')).toMatch(/Server timed out/)
    expect(mcErrorLine('ECONNREFUSED 25565')).toMatch(/Connection refused/)
    expect(mcErrorLine('getaddrinfo ENOTFOUND foo')).toMatch(/Can't find that server/)
    expect(mcErrorLine('ECONNRESET')).toMatch(/Connection was reset/)
    expect(mcErrorLine('Unsupported protocol version')).toMatch(/Version mismatch/)
    expect(mcErrorLine('something else')).toBeNull()
  })
})

describe('minecraft brain — LLM call flow', () => {
  it('sends system prompt + history with temperature/max_tokens like legacy', async () => {
    const calls = []
    const h = makeHarness({ fetchImpl: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":"ok","emotion":"happy"}' } }] }) }
    } })
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'Steve', message: 'hello' })
    await flushAsync()
    expect(calls[0].url).toBe('http://brain.test/v1/chat')
    expect(calls[0].body.model).toBe('fallback-model')
    expect(calls[0].body.temperature).toBe(0.85)
    expect(calls[0].body.max_tokens).toBe(80)
    expect(calls[0].body.messages[0].role).toBe('system')
    expect(calls[0].body.messages[1].content).toBe('[WHISPER from Steve]: "hello"')
    // decision applied → said + echoed in-game
    expect(ws.sent.some((m) => m.cmd === 'chat' && m.message === 'ok')).toBe(true)
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('falls back to online_api_model when brain_model is blank', async () => {
    const bodies = []
    const h = makeHarness({ fetchImpl: async (_u, opts) => {
      bodies.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":null,"emotion":"neutral"}' } }] }) }
    } })
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'A', message: 'x' })
    await flushAsync()
    expect(bodies[0].model).toBe('fallback-model')
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('refuses to call the brain without an API key', async () => {
    let fetched = 0
    const h = makeHarness({ ai: { brain_key: '' }, fetchImpl: async () => {
      fetched++
      return { ok: true, json: async () => ({}) }
    } })
    const says = h.watch('mc:say')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'A', message: 'x' })
    await Promise.resolve()
    expect(fetched).toBe(0)
    expect(says[0].text).toMatch(/No API key set for Minecraft brain/)
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('caps history at 20 entries', async () => {
    const bodies = []
    const h = makeHarness({ fetchImpl: async (_u, opts) => {
      bodies.push(JSON.parse(opts.body))
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":"k","emotion":"neutral"}' } }] }) }
    } })
    const ws = await h.openChannel()
    for (let i = 0; i < 14; i++) {
      h.svc.routeEvent({ type: 'whisper', username: 'U', message: `msg ${i}` })
      await flushAsync()
    }
    expect(bodies.length).toBe(14)
    expect(bodies[13].messages.length).toBe(21) // system + max 20 history
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('surfaces HTTP errors as Brain error lines', async () => {
    const h = makeHarness({ fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'bad key' } })
    }) })
    const says = h.watch('mc:say')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'A', message: 'x' })
    await flushAsync()
    expect(says[0].text).toBe('*sparks* Brain error: bad key')
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('surfaces network failures as Brain hiccup lines', async () => {
    const h = makeHarness({ fetchImpl: async () => { throw new Error('socket down') } })
    const says = h.watch('mc:say')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'A', message: 'x' })
    await flushAsync()
    expect(says[0].text).toBe('*confused* Brain hiccup: socket down')
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('treats non-JSON model output as a direct chat line', async () => {
    const h = makeHarness({ fetchImpl: brainReply('Hewwo~ I am just vibing') })
    const says = h.watch('mc:say')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'A', message: 'x' })
    await flushAsync()
    expect(says[0].text).toBe('Hewwo~ I am just vibing')
    expect(says[0].emotion).toBe('neutral')
    ws.removeAllListeners()
    h.svc.disconnect()
  })
})

describe('minecraft event router', () => {
  it('observation → bubble + emotion + in-game echo', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const events = h.watch('mc:event')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'observation', text: 'I see diamonds!', emotion: 'excited' })
    expect(says[0]).toEqual({ text: 'I see diamonds!', emotion: 'excited' })
    expect(events[0].kind).toBe('observation')
    expect(ws.sent).toContainEqual({ cmd: 'chat', message: 'I see diamonds!' })
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('ignores non-# chat entirely', async () => {
    let fetched = 0
    const h = makeHarness({ fetchImpl: async () => { fetched++ } })
    const says = h.watch('mc:say')
    h.svc.routeEvent({ type: 'chat', username: 'Steve', message: 'regular chatter' })
    await flushAsync()
    expect(fetched).toBe(0)
    expect(says.length).toBe(0)
    h.stopWatching()
  })

  it('#chat goes to the brain when ai_hash_chat is on (default)', async () => {
    const h = makeHarness({ fetchImpl: brainReply('{"chat":"sup Steve","emotion":"smirk"}') })
    const says = h.watch('mc:say')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'chat', username: 'Steve', message: '#hey bot' })
    await flushAsync()
    expect(says[0]).toEqual({ text: 'sup Steve', emotion: 'smirk' })
    expect(ws.sent).toContainEqual({ cmd: 'chat', message: 'sup Steve' })
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('#chat is ignored when ai_hash_chat is off', async () => {
    let fetched = 0
    const h = makeHarness({ ai: { ai_features: { ai_hash_chat: false } }, fetchImpl: async () => { fetched++ } })
    const says = h.watch('mc:say')
    h.svc.routeEvent({ type: 'chat', username: 'Steve', message: '#hey bot' })
    await flushAsync()
    expect(fetched).toBe(0)
    expect(says.length).toBe(0)
    h.stopWatching()
  })

  it('whispers always go to the AI regardless of toggles', async () => {
    let fetched = 0
    const h = makeHarness({
      ai: { ai_features: { ai_hash_chat: false, ai_events: false } },
      fetchImpl: async () => {
        fetched++
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":"psst","emotion":"evil"}' } }] }) }
      }
    })
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'whisper', username: 'Ghost', message: 'secret' })
    await flushAsync()
    expect(fetched).toBe(1)
    expect(says[0].text).toBe('psst')
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('task_start announces non-silent tasks with thinking emotion', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const tasks = h.watch('mc:task')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'task_start', task: 'mine iron', task_list: ['mine iron'] })
    expect(says[0].text).toBe('*starts* mine iron~')
    expect(tasks[0]).toEqual({ label: 'mine iron', active: true })
    expect(ws.sent).toContainEqual({ cmd: 'chat', message: '*starts* mine iron~' })
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('task_start stays silent for inventory/status tasks', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const tasks = h.watch('mc:task')
    await h.openChannel()
    h.svc.routeEvent({ type: 'task_start', task: 'inv' })
    expect(says.length).toBe(0)
    expect(tasks[0].active).toBe(true)
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('task_queued announces only the first queued task', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'task_queued', task: 'chop tree', queue_length: 1, task_list: ['chop tree'] })
    h.svc.routeEvent({ type: 'task_queued', task: 'craft sticks', queue_length: 2, task_list: ['chop tree', 'craft sticks'] })
    expect(says.length).toBe(1)
    expect(says[0].text).toBe('On it! → chop tree')
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('task_progress reports notes and switches emotion near completion', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const emotions = h.watch('emotion:set')
    await h.openChannel()
    h.svc.routeEvent({ type: 'task_progress', done: 2, total: 10 })
    h.svc.routeEvent({ type: 'task_progress', done: 9, total: 10 })
    expect(says[0].text).toBe('*working* 2/10')
    expect(emotions).toEqual(['thinking', 'happy'])
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('task_result done → local celebration pool with note', async () => {
    const h = makeHarness({ rand: () => 0 })
    const says = h.watch('mc:say')
    const tasks = h.watch('mc:task')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'task_result', task: 'mine', status: 'done', message: 'got 5 iron', task_list: [] })
    expect(says[0].text).toBe(`*dusts hands* Done! got 5 iron`)
    expect(tasks[0]).toEqual({ label: '', active: false })
    expect(ws.sent.some((m) => m.cmd === 'chat' && m.message.includes('got 5 iron'))).toBe(true)
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('task_result done for inventory tasks stays quiet', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'task_result', task: 'inv', status: 'done', message: '42 slots' })
    expect(says.length).toBe(0)
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('task_result error → confused frown', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const emotions = h.watch('emotion:set')
    await h.openChannel()
    h.svc.routeEvent({ type: 'task_result', task: 'goto', status: 'error', message: 'unreachable' })
    expect(says[0].text).toBe('*frowns* unreachable')
    expect(emotions.includes('confused')).toBe(true)
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('task_result cleared → queue cleared line + neutral', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const tasks = h.watch('mc:task')
    await h.openChannel()
    h.svc.routeEvent({ type: 'task_result', task: '', status: 'cleared', message: '' })
    expect(says[0].text).toBe('*stops* Queue cleared~')
    expect(tasks[0].active).toBe(false)
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('mode_changed + mode_info reach the bubble', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'mode_changed', mode: 'task', message: 'Mode: task' })
    h.svc.routeEvent({ type: 'mode_info', mode: 'follower' })
    expect(says[0].text).toBe('Mode: task')
    expect(says[1].text).toBe('Current mode: follower')
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('advancement uses local pool when AI toggle off', async () => {
    let fetched = 0
    const h = makeHarness({ fetchImpl: async () => { fetched++ } })
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'advancement', username: 'RavenBot', title: 'Getting Wood', description: '' })
    expect(fetched).toBe(0)
    expect(says[0].emotion).toBe('excited')
    expect(says[0].text).toContain('"Getting Wood"!!')
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('advancement calls the brain when ai_advancements is on', async () => {
    let promptText = ''
    const h = makeHarness({ ai: { ai_features: { ai_advancements: true } }, fetchImpl: async (_u, opts) => {
      promptText = JSON.parse(opts.body).messages.at(-1).content
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":"yay","emotion":"excited"}' } }] }) }
    } })
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'advancement', username: 'RavenBot', title: 'Diamonds!', description: '' })
    await flushAsync()
    expect(promptText).toContain('[ADVANCEMENT]')
    expect(says[0].text).toBe('yay')
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('gift → love reaction naming the item', async () => {
    const h = makeHarness({ rand: () => 0 })
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'gift', item: 'diamond' })
    expect(says[0].emotion).toBe('love')
    expect(says[0].text).toBe(`*picks up diamond* ${REACTIONS.gift_received[0]}`)
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('died → death pool line plus item-retrieval line', async () => {
    const h = makeHarness({ rand: () => 0 })
    const says = h.watch('mc:say')
    const emotions = h.watch('emotion:set')
    const ws = await h.openChannel()
    h.svc.routeEvent({ type: 'event', event: 'died', username: 'RavenBot' })
    expect(emotions.includes('sad')).toBe(true)
    expect(says.length).toBe(2)
    expect(says[0].text).toBe(REACTIONS.death[0])
    expect(says[1].text).toBe('*respawning* Going to grab my stuff!')
    expect(ws.sent.filter((m) => m.cmd === 'chat').length).toBe(2)
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('player_joined → happy greeting', async () => {
    const h = makeHarness({ rand: () => 0 })
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'event', event: 'player_joined', username: 'Steve' })
    expect(says[0]).toEqual({ text: REACTIONS.player_joined[0], emotion: 'happy' })
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('friend_added is silent (bot.js already replied)', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    h.svc.routeEvent({ type: 'event', event: 'friend_added', username: 'Steve' })
    expect(says.length).toBe(0)
    h.stopWatching()
  })

  it('kicked notifies without AI unless ai_events is on', async () => {
    let fetched = 0
    const h = makeHarness({ fetchImpl: async () => { fetched++ } })
    const says = h.watch('mc:say')
    await h.openChannel()
    h.svc.routeEvent({ type: 'event', event: 'kicked', reason: 'Banned by admin' })
    expect(fetched).toBe(0)
    expect(says[0].text).toBe('*disconnected* kicked: Banned by admin')
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('kicked calls the brain when ai_events is on', async () => {
    let fetched = 0
    const h = makeHarness({ ai: { ai_features: { ai_events: true } }, fetchImpl: async () => {
      fetched++
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":null,"emotion":"sad"}' } }] }) }
    } })
    await h.openChannel()
    h.svc.routeEvent({ type: 'event', event: 'disconnected', reason: '' })
    await Promise.resolve()
    expect(fetched).toBe(1)
    FakeWS.instances.at(-1).removeAllListeners()
    h.svc.disconnect()
  })

  it('emotion_hint only sets the emotion', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const emotions = h.watch('emotion:set')
    h.svc.routeEvent({ type: 'emotion_hint', emotion: 'shocked' })
    expect(emotions).toEqual(['shocked'])
    expect(says.length).toBe(0)
    h.stopWatching()
  })

  it('low-health stats trigger shocked', async () => {
    const h = makeHarness()
    const emotions = h.watch('emotion:set')
    h.svc.routeEvent({ type: 'stats', health: 2, food: 20 })
    h.svc.routeEvent({ type: 'stats', health: 18, food: 20 })
    expect(emotions).toEqual(['shocked'])
    h.stopWatching()
  })

  it('radar routes entities to the UI topic', async () => {
    const h = makeHarness()
    const radars = h.watch('mc:radar')
    h.svc.routeEvent({ type: 'radar', entities: [{ kind: 'hostile', name: 'zombie', x: 3, z: -4 }] })
    expect(radars[0].entities[0].name).toBe('zombie')
    h.stopWatching()
  })

  it('inventory_update bypasses chat/TTS', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const inv = h.watch('mc:inventory')
    h.svc.routeEvent({ type: 'inventory_update', items: [{ name: 'cobblestone', count: 64 }] })
    expect(inv[0].items.length).toBe(1)
    expect(says.length).toBe(0)
    h.stopWatching()
  })

  it('status_update bypasses chat/TTS', async () => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const st = h.watch('mc:bot-status')
    h.svc.routeEvent({ type: 'status_update', hp: 18, food: 20, x: 1, y: 64, z: -2, held: 'iron_pickaxe' })
    expect(st[0].data.hp).toBe(18)
    expect(says.length).toBe(0)
    h.stopWatching()
  })

  it.each([
    ['fatal', 'ETIMEDOUT something', 'shocked', /Server timed out/],
    ['warning', 'ECONNREFUSED 127.0.0.1:25565', 'confused', /Connection refused/],
    ['fatal', 'getaddrinfo ENOTFOUND hypixel.net', 'shocked', /Check the IP/],
    ['info', 'Unsupported version 1.7', 'confused', /Version mismatch/],
    ['warning', 'No path found — destination unreachable.', 'confused', null]
  ])('error level=%s maps %s', (level, message, emotion, pattern) => {
    const h = makeHarness()
    const says = h.watch('mc:say')
    const emotions = h.watch('emotion:set')
    h.svc.routeEvent({ type: 'error', level, message })
    expect(emotions).toEqual([emotion])
    if (pattern) expect(says[0].text).toMatch(pattern)
    else expect(says[0].text).toBe(message)
    h.stopWatching()
  })
})

describe('minecraft commands', () => {
  it('% input rides as {cmd:"text",text} for the bot parser', async () => {
    const h = makeHarness()
    const ws = await h.openChannel()
    expect(h.svc.sendRaw('%mine iron_ore 5')).toBe(true)
    expect(ws.sent).toEqual([{ cmd: 'text', text: '%mine iron_ore 5' }])
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('plain console input goes through the MC brain', async () => {
    let seen = ''
    const h = makeHarness({ fetchImpl: async (_u, opts) => {
      seen = JSON.parse(opts.body).messages.at(-1).content
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"chat":null,"emotion":"neutral"}' } }] }) }
    } })
    const ws = await h.openChannel()
    expect(h.svc.sendRaw('what should we do today')).toBe(true)
    await flushAsync()
    expect(seen).toBe('[PLAYER_INPUT] User: "what should we do today"')
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('sendCmd flattens args onto the payload like legacy send_cmd', async () => {
    const h = makeHarness()
    const ws = await h.openChannel()
    h.svc.sendCmd('mine', { block: 'diamond_ore', count: 3 })
    expect(ws.sent).toEqual([{ cmd: 'mine', block: 'diamond_ore', count: 3 }])
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('sendCmd("text") keeps the legacy text shape', async () => {
    const h = makeHarness()
    const ws = await h.openChannel()
    h.svc.sendCmd('text', { text: '%stop' })
    expect(ws.sent).toEqual([{ cmd: 'text', text: '%stop' }])
    ws.removeAllListeners()
    h.svc.disconnect()
  })

  it('commands before the channel is up fail softly with a log line', async () => {
    const h = makeHarness()
    const logs = h.watch('mc:log')
    expect(h.svc.sendCmd('mine', {})).toBe(false)
    expect(h.svc.sendRaw('%stop')).toBe(false)
    expect(logs.some((l) => l.line.includes('Not connected to bot WS'))).toBe(true)
    h.stopWatching()
  })
})

describe('minecraft lifecycle', () => {
  it('spawns node bot.js with flattened CLI args inside drone/', async () => {
    const h = makeHarness()
    const connectedEvents = h.watch('mc:connected')
    await h.openChannel()
    const child = h.child()
    expect(child.spawnArgs.args[0]).toBe('bot.js')
    expect(child.spawnArgs.opts.cwd).toBe(path.join(h.root, 'drone'))
    const flat = child.spawnArgs.args.join(' ')
    expect(flat).toContain('--host localhost')
    expect(flat).toContain('--port 25565')
    expect(flat).toContain('--username RavenBot')
    expect(flat).toContain('--version 1.21')
    expect(flat).toContain('--ws_port 8765')
    expect(flat).toContain('--auth offline')
    expect(h.svc.status()).toEqual({ enabled: true, connected: true, childRunning: true })
    expect(connectedEvents.length).toBe(1)
    wsCleanup(h)
  })

  it('pipes drone stdout/stderr lines to mc:log', async () => {
    const h = makeHarness()
    const logs = h.watch('mc:log')
    await h.openChannel()
    h.child().stdout.emit('data', '[BOT] Spawned ✓\n[BOT] second line\npar')
    h.child().stderr.emit('data', '[ERR] boom\n')
    h.child().stdout.emit('data', 'tial\n')
    const lines = logs.map((l) => l.line)
    expect(lines).toContain('[BOT] Spawned ✓')
    expect(lines).toContain('[BOT] second line')
    expect(lines).toContain('[ERR] boom')
    expect(lines).toContain('partial')
    wsCleanup(h)
  })

  it('emits mc:error without spawning when bot.js is missing', () => {
    const emptyRoot = makeRoot()
    fs.rmSync(path.join(emptyRoot, 'drone'), { recursive: true })
    const h = makeHarness({ rootOverride: emptyRoot })
    const errors = h.watch('mc:error')
    h.svc.connect()
    expect(errors[0].message).toMatch(/bot\.js not found/)
    expect(h.child()).toBeNull()
    expect(h.svc.status().enabled).toBe(false)
    h.stopWatching()
  })

  it('guards against double connect', async () => {
    const h = makeHarness()
    h.svc.connect()
    h.svc.connect()
    vi.advanceTimersByTime(1500)
    expect(FakeWS.instances.length).toBe(1)
    wsCleanup(h)
  })

  it('makes exactly ONE reconnect attempt after a dropped channel', async () => {
    const h = makeHarness()
    const dropped = h.watch('mc:disconnected')
    await h.openChannel() // instance 1
    FakeWS.instances[0].emit('close') // drop
    expect(dropped.length).toBe(1)
    vi.advanceTimersByTime(2999)
    expect(FakeWS.instances.length).toBe(1)
    vi.advanceTimersByTime(1)
    expect(FakeWS.instances.length).toBe(2) // reconnect fired
    FakeWS.instances[1].emit('close') // reconnect failed too
    vi.advanceTimersByTime(60000)
    expect(FakeWS.instances.length).toBe(2) // no further attempts
    h.stopWatching()
  })

  it('does not reschedule reconnect once the child exits uncleanly', async () => {
    const h = makeHarness()
    await h.openChannel()
    FakeWS.instances[0].emit('close') // consumes the single reconnect budget
    vi.advanceTimersByTime(3000)
    h.child().emit('exit', 1, null) // drone died afterwards
    vi.advanceTimersByTime(60000)
    expect(FakeWS.instances.length).toBe(2)
    h.stopWatching()
  })

  it('disconnect tears down child, socket, and timers', async () => {
    const h = makeHarness()
    const dropped = h.watch('mc:disconnected')
    const ws = await h.openChannel()
    h.svc.disconnect()
    expect(h.child().kill).toHaveBeenCalledWith('SIGTERM')
    expect(ws.closed).toBe(true)
    expect(h.svc.status()).toEqual({ enabled: false, connected: false, childRunning: false })
    expect(dropped.length).toBeGreaterThanOrEqual(1)
    // No zombie reconnect after teardown.
    const countBefore = FakeWS.instances.length
    vi.advanceTimersByTime(10000)
    expect(FakeWS.instances.length).toBe(countBefore)
    h.stopWatching()
  })

  it('child crash schedules one reconnect while enabled', async () => {
    const h = makeHarness()
    await h.openChannel()
    const countBefore = FakeWS.instances.length
    h.child().emit('exit', 1, null)
    vi.advanceTimersByTime(3000)
    expect(FakeWS.instances.length).toBe(countBefore + 1)
    h.stopWatching()
  })

  it('disconnect before any connection attempt leaves nothing running', () => {
    const h = makeHarness()
    h.svc.disconnect()
    expect(h.child()).toBeNull()
    expect(h.svc.status()).toEqual({ enabled: false, connected: false, childRunning: false })
    h.stopWatching()
  })
})

function wsCleanup(h) {
  for (const inst of FakeWS.instances) inst.removeAllListeners()
  h.svc.disconnect()
  h.stopWatching()
}
