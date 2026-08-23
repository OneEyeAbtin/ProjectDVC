import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
}))

import { ipcMain, contextBridge } from 'electron'
import { registerIpc } from '../src/main/ipc.js'
import '../src/preload/api.js'
import { createConfigService } from '../src/main/services/config.service.js'
import { createMemoryService } from '../src/main/services/memory.service.js'
import { createCharactersService } from '../src/main/services/characters.service.js'
import { createBrain } from '../src/main/services/brain.service.js'

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-ipc-'))
}

function makeOutfitsDir(root) {
  const dir = path.join(root, 'outfits')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'charlottehappy.png'), '')
  fs.writeFileSync(path.join(dir, 'neutral.png'), '')
  return dir
}

function makeHarness({ callLLM } = {}) {
  const root = makeRoot()
  const config = createConfigService({ rootDir: root })
  const memory = createMemoryService({ rootDir: root })
  const characters = createCharactersService({
    outfitsDir: makeOutfitsDir(root),
    emotions: ['neutral', 'happy', 'sad', 'angry', 'love', 'confused', 'talking']
  })
  const brain = createBrain({
    config,
    memory,
    callLLM: callLLM ?? (async () => 'ok [EMOTION: happy]')
  })
  const sent = []
  const getWin = () => ({
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push([channel, payload]) }
  })
  registerIpc({
    services: { config, memory, characters, brain },
    getWin
  })
  const handlers = new Map(ipcMain.handle.mock.calls.map(([ch, fn]) => [ch, fn]))
  return {
    handlers,
    sent,
    config,
    memory,
    brain,
    call: (channel, payload) => handlers.get(channel)(null, payload),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  ipcMain.handle.mockClear()
})

describe('ipc app:init', () => {
  it('returns full boot state', () => {
    const h = makeHarness()
    const boot = h.call('app:init')
    expect(boot.config).toEqual(h.config.getConfig())
    expect(boot.save).toEqual(h.config.getSave())
    expect(boot.traits).toEqual([])
    expect(boot.permanentFacts).toEqual([])
    expect(boot.outfitManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Base', prefix: '' }),
        expect.objectContaining({ name: 'Charlotte', prefix: 'charlotte' })
      ])
    )
    expect(boot.setupQuestions.length).toBeGreaterThan(0)
    expect(boot.personaGroups).toHaveProperty('💕 Dere Types')
    expect(boot.greetings.Tsundere).toContain('{name}')
    expect(boot.greetings.Tsundere).toContain('[EMOTION:')
    expect(boot.greetings.Gothic).toContain('[EMOTION: smirk]')
    expect(typeof boot.greetings.Vampire).toBe('string')
    expect(boot.themes).toContain('midnight-sakura')
  })

  it('getters in payload are defensive copies', () => {
    const h = makeHarness()
    const a = h.call('app:init')
    a.save.stats.affection = 999
    expect(h.config.getSave().stats.affection).not.toBe(999)
  })
})

describe('ipc setup:complete', () => {
  it('persists answers, derives names, adds trait lines, completes setup', () => {
    const h = makeHarness()
    const save = h.call('setup:complete', {
      user_name: 'Abtin',
      pet_name: 'Raven',
      age: '30',
      hobby: '',
      schedule: 'skip'
    })
    expect(save.setup_complete).toBe(true)
    expect(save.user_name).toBe('Abtin')
    expect(save.pet_name).toBe('Raven')
    expect(save.setup_answers).toEqual({ user_name: 'Abtin', pet_name: 'Raven', age: '30' })
    expect(h.memory.getPermanent()).toContain("user's user name: Abtin")
    expect(h.memory.getPermanent()).toContain("user's age: 30")
    expect(h.memory.getSessionTraits()).toHaveLength(0)
    expect(sentIncludes(h.sent, 'traits')).toBe(true)
  })

  it('accepts string answers and rejects nothing for non-objects', () => {
    const h = makeHarness()
    const save = h.call('setup:complete', null)
    expect(save.setup_complete).toBe(true)
  })

  function sentIncludes(sent, channel) {
    return sent.some(([ch]) => ch === 'traits')
  }
})

describe('ipc msg:send cheat codes', () => {
  it('rosebud maxes affection, acks cheated, pushes stats/reply/emotion', async () => {
    const h = makeHarness()
    const ack = h.call('msg:send', { text: 'rosebud' })
    await flush()
    expect(ack).toEqual({ cheated: true })
    expect(h.config.getSave().stats.affection).toBe(100)
    const channels = h.sent.map(([c]) => c)
    expect(channels).toContain('reply')
    expect(channels).toContain('stats')
    expect(channels).toContain('emotion')
    expect(h.config.getSave().last_emotion).toBe('love')
    expect(h.brain.history).toHaveLength(0)
  })

  it('motherlode aliases rosebud', () => {
    const h = makeHarness()
    expect(h.call('cheat:try', { text: 'motherlode' })).toEqual({ cheated: true })
    expect(h.config.getSave().stats.affection).toBe(100)
  })

  it('iddqd maxes all stats', () => {
    const h = makeHarness()
    h.call('cheat:try', { text: 'IDDQD' })
    const stats = h.config.getSave().stats
    expect(Object.values(stats).every((v) => v === 100)).toBe(true)
  })

  it('upupdowndown switches persona to Girlfriend', () => {
    const h = makeHarness()
    h.call('cheat:try', { text: 'upupdowndown' })
    expect(h.config.getSave().persona).toBe('Girlfriend')
  })

  it('showmehearts toggles hearts_visible', () => {
    const h = makeHarness()
    const before = h.config.getSave().hearts_visible
    expect(h.call('cheat:try', { text: 'showmehearts' }).cheated).toBe(true)
    expect(h.config.getSave().hearts_visible).toBe(!before)
    expect(h.call('cheat:try', { text: 'showmehearts' }).cheated).toBe(true)
    expect(h.config.getSave().hearts_visible).toBe(before)
    const profiles = h.sent.filter(([c]) => c === 'profile')
    expect(profiles.length).toBe(2)
  })

  it('forceEMOTION: transient talking is emit-only, never persisted; invalid falls through', async () => {
    const h = makeHarness()
    expect(h.call('msg:send', { text: 'forcetalking' })).toEqual({ cheated: true })
    expect(h.config.getSave().last_emotion).toBe('neutral')
    expect(h.sent.some(([c, p]) => c === 'emotion' && p === 'talking')).toBe(true)

    h.sent.length = 0
    expect(h.call('msg:send', { text: 'forcebanana' })).toEqual({ queued: true })
    await flush()
    expect(h.config.getSave().last_emotion).toBe('neutral')
    expect(h.brain.history.some((m) => m.role === 'user' && m.content === 'forcebanana')).toBe(true)
  })

  it('forceEMOTION: fullbody accepted as transient target; forcelove persists last_emotion', () => {
    const h = makeHarness()
    expect(h.call('cheat:try', { text: 'forcefullbody' })).toEqual({ cheated: true })
    expect(h.config.getSave().last_emotion).toBe('neutral')
    expect(h.sent.some(([c, p]) => c === 'emotion' && p === 'fullbody')).toBe(true)

    h.sent.length = 0
    expect(h.call('cheat:try', { text: 'forcelove' })).toEqual({ cheated: true })
    expect(h.config.getSave().last_emotion).toBe('love')
    expect(h.sent.some(([c, p]) => c === 'emotion' && p === 'love')).toBe(true)
  })

  it('amnesia clears brain history only', async () => {
    const h = makeHarness()
    h.config.patchSave({ brain_mode: 'offline' })
    await h.brain.send('hello')
    expect(h.brain.history).toHaveLength(2)
    const personaBefore = h.config.getSave().persona
    expect(h.call('msg:send', { text: 'amnesia' })).toEqual({ cheated: true })
    expect(h.brain.history).toHaveLength(0)
    expect(h.config.getSave().persona).toBe(personaBefore)
  })

  it('unknown cheat text returns false from cheat:try', () => {
    const h = makeHarness()
    expect(h.call('cheat:try', { text: 'hello world' })).toEqual({ cheated: false })
  })
})

describe('ipc msg:send normal flow', () => {
  it('acks queued then applies stats/traits and pushes reply/stats/traits', async () => {
    const h = makeHarness({
      callLLM: async () =>
        'Hello there! [EMOTION: happy] [STAT: affection +5] [TRAIT: went hiking today] 😊'
    })
    h.config.patchConfig({ online_api_key: 'sk-test', online_api_url: 'http://x', online_api_model: 'm' })
    h.config.patchSave({ brain_mode: 'online' })
    const ack = h.call('msg:send', { text: 'hi!' })
    expect(ack).toEqual({ queued: true })
    await flush()

    expect(h.config.getSave().stats.affection).toBe(25)
    expect(h.memory.getSessionTraits()).toContain('went hiking today')
    const reply = h.sent.find(([c]) => c === 'reply')?.[1]
    expect(reply.text).toContain('Hello there!')
    expect(reply.emotion).toBe('happy')
    expect(h.sent.find(([c]) => c === 'stats')[1].affection).toBe(25)
    expect(h.sent.find(([c]) => c === 'traits')[1]).toContain('went hiking today')
  })

  it('pushes error with scope brain when send throws', async () => {
    const root = makeRoot()
    const config = createConfigService({ rootDir: root })
    const memory = createMemoryService({ rootDir: root })
    const characters = createCharactersService({
      outfitsDir: makeOutfitsDir(root),
      emotions: ['neutral']
    })
    const brain = { send: async () => { throw new Error('boom') }, clearHistory() {}, history: [] }
    const sent = []
    registerIpc({
      services: { config, memory, characters, brain },
      getWin: () => ({
        isDestroyed: () => false,
        webContents: { send: (c, p) => sent.push([c, p]) }
      })
    })
    const handlers = new Map(ipcMain.handle.mock.calls.map(([ch, fn]) => [ch, fn]))
    handlers.get('msg:send')(null, { text: 'hi' })
    await flush()
    expect(sent[0][0]).toBe('error')
    expect(sent[0][1]).toEqual({ scope: 'brain', message: 'boom' })
  })
})

describe('ipc profile:save', () => {
  it('splits keys between save and config, deep merges, emits profile', () => {
    const h = makeHarness()
    const result = h.call('profile:save', {
      pet_name: 'Nova',
      stats: { sass: 50 },
      max_history: 5,
      not_a_real_key: 1
    })
    expect(result.save.pet_name).toBe('Nova')
    expect(result.save.stats.sass).toBe(50)
    expect(result.save.stats.affection).toBeDefined()
    expect(result.config.max_history).toBe(5)
    expect(result.save.not_a_real_key).toBeUndefined()
    expect(result.config.not_a_real_key).toBeUndefined()
    expect(h.sent.at(-1)[0]).toBe('profile')
  })

  it('throws on non-object patch', () => {
    const h = makeHarness()
    expect(() => h.call('profile:save', 'nope')).toThrow(/expects an object/)
  })
})

describe('ipc outfit:switch', () => {
  it('patches valid outfit by name or prefix and emits emotion', () => {
    const h = makeHarness()
    const save = h.call('outfit:switch', { name: 'Charlotte' })
    expect(save.outfit).toBe('Charlotte')
    h.call('outfit:switch', { name: '' })
    expect(h.config.getSave().outfit).toBe('')
    const emotions = h.sent.filter(([c]) => c === 'emotion')
    expect(emotions.length).toBe(2)
    expect(emotions[0][1]).toBe('neutral')
  })

  it('rejects unknown outfit without patching', () => {
    const h = makeHarness()
    expect(() => h.call('outfit:switch', { name: 'Tuxedo' })).toThrow(/Unknown outfit/)
    expect(h.config.getSave().outfit).toBe('Base')
  })
})

describe('ipc voice stubs', () => {
  it('voice:speak emits tts unsupported and voice:stop stops', () => {
    const h = makeHarness()
    expect(h.call('voice:speak', { text: 'hi', emotion: 'happy' })).toEqual({ unsupported: true })
    expect(h.sent.at(-1)).toEqual(['tts', { unsupported: true }])
    expect(h.call('voice:stop')).toEqual({ stopped: true })
  })
})

describe('preload allowlist', () => {
  it('exposes dvc api with channel allowlists', async () => {
    const { ipcRenderer } = await import('electron')
    const api = contextBridge.exposeInMainWorld.mock.calls.at(-1)[1]
    expect(api).toBeTruthy()

    ipcRenderer.invoke.mockResolvedValueOnce({ ok: true })
    await expect(api.invoke('app:init')).resolves.toEqual({ ok: true })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('app:init', undefined)

    await expect(api.invoke('evil:channel')).rejects.toThrow('Unknown channel')
    expect(() => api.on('evil:channel', () => {})).toThrow('Unknown channel')

    const off = api.on('reply', () => {})
    expect(ipcRenderer.on).toHaveBeenLastCalledWith('reply', expect.any(Function))
    expect(typeof off).toBe('function')
  })
})
