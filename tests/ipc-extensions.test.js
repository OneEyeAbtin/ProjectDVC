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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-ipcx-'))
}

function makeOutfitsDir(root) {
  const dir = path.join(root, 'outfits')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'charlottehappy.png'), '')
  fs.writeFileSync(path.join(dir, 'neutral.png'), '')
  return dir
}

function makeHarness({ callLLM, seedSessionTraits } = {}) {
  const root = makeRoot()
  if (seedSessionTraits) {
    const memDir = path.join(root, 'data', 'memory')
    fs.mkdirSync(memDir, { recursive: true })
    fs.writeFileSync(
      path.join(memDir, 'session-traits.json'),
      JSON.stringify(seedSessionTraits)
    )
  }
  const config = createConfigService({ rootDir: root })
  const memory = createMemoryService({ rootDir: root })
  const characters = createCharactersService({
    outfitsDir: makeOutfitsDir(root),
    emotions: ['neutral', 'happy', 'sad', 'angry', 'love', 'confused', 'talking']
  })
  let llmCalls = 0
  const brain = createBrain({
    config,
    memory,
    callLLM:
      callLLM ??
      (async () => {
        llmCalls += 1
        return `reply number ${llmCalls} [EMOTION: happy]`
      })
  })
  const sent = []
  registerIpc({
    services: { config, memory, characters, brain },
    getWin: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => sent.push([channel, payload]) }
    })
  })
  const handlers = new Map(ipcMain.handle.mock.calls.map(([ch, fn]) => [ch, fn]))
  return {
    handlers,
    sent,
    root,
    config,
    memory,
    brain,
    llmCalls: () => llmCalls,
    call: (channel, payload) => handlers.get(channel)(null, payload),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  ipcMain.handle.mockClear()
})

describe('stats:adjust', () => {
  it('applies delta, clamps 0..100, patches save, pushes stats', () => {
    const h = makeHarness()
    h.config.patchSave({ stats: { ...h.config.getSave().stats, affection: 20 } })

    expect(h.call('stats:adjust', { key: 'affection', delta: 5 }).affection).toBe(25)
    expect(h.call('stats:adjust', { key: 'affection', delta: -999 }).affection).toBe(0)
    expect(h.call('stats:adjust', { key: 'affection', delta: 999 }).affection).toBe(100)
    expect(h.config.getSave().stats.affection).toBe(100)

    const statPushes = h.sent.filter(([c]) => c === 'stats')
    expect(statPushes).toHaveLength(3)
    expect(statPushes[2][1].affection).toBe(100)
  })

  it('rejects unknown stat keys without patching', () => {
    const h = makeHarness()
    expect(() => h.call('stats:adjust', { key: 'not_a_stat', delta: 5 })).toThrow(/Unknown stat/)
  })
})

describe('memory trait channels', () => {
  it('delete-trait removes only first match and persists', () => {
    const h = makeHarness({ seedSessionTraits: ['likes tea', 'likes cats', 'likes tea'] })
    const traits = h.call('memory:delete-trait', { text: 'likes tea' })
    expect(traits).toEqual(['likes cats', 'likes tea'])
    expect(h.memory.getSessionTraits()).toEqual(['likes cats', 'likes tea'])
    const stored = JSON.parse(
      fs.readFileSync(path.join(h.root, 'data', 'memory', 'session-traits.json'), 'utf8')
    )
    expect(stored).toEqual(['likes cats', 'likes tea'])
    expect(h.sent.some(([c, p]) => c === 'traits' && p[0] === 'likes cats')).toBe(true)
  })

  it('delete-trait with no match leaves traits untouched but still returns them', () => {
    const h = makeHarness()
    h.memory.setSessionTraits(['a'])
    expect(h.call('memory:delete-trait', { text: 'zzz' })).toEqual(['a'])
    expect(h.memory.getSessionTraits()).toEqual(['a'])
  })

  it('wipe-traits clears session traits only, permanent untouched', () => {
    const h = makeHarness()
    h.memory.addTrait("user's age: 30")
    h.memory.addTrait('went hiking today')
    expect(h.call('memory:wipe-traits')).toEqual([])
    expect(h.memory.getSessionTraits()).toEqual([])
    expect(h.memory.getPermanent()).toContain("user's age: 30")
  })

  it('delete-permanent removes first match; wipe-permanent clears all', () => {
    const h = makeHarness()
    h.memory.addTrait("user's age: 30")
    h.memory.addTrait("user's age: 31")
    expect(h.call('memory:delete-permanent', { text: "user's age: 30" })).toEqual(["user's age: 31"])
    expect(h.call('memory:wipe-permanent')).toEqual([])
    expect(h.memory.getPermanent()).toEqual([])
  })

  it('clear-summary empties session_summary in save', () => {
    const h = makeHarness()
    h.config.patchSave({ session_summary: 'old chat recap' })
    const save = h.call('memory:clear-summary')
    expect(save.session_summary).toBe('')
    expect(h.config.getSave().session_summary).toBe('')
  })
})

describe('history channels', () => {
  it('history:get returns role/content pairs; history:clear empties', async () => {
    const h = makeHarness()
    h.config.patchSave({ brain_mode: 'offline' })
    await h.brain.send('hello')
    const got = h.call('history:get')
    expect(got.history).toHaveLength(2)
    expect(got.history[0]).toEqual({ role: 'user', content: 'hello' })
    expect(got.history[1].role).toBe('assistant')

    expect(h.call('history:clear')).toEqual({})
    expect(h.brain.history).toHaveLength(0)
    expect(h.call('history:get').history).toEqual([])
  })
})

describe('msg:regenerate', () => {
  it('pops assistant entry and calls LLM again, delivering fresh reply', async () => {
    const h = makeHarness()
    h.config.patchConfig({ online_api_key: 'sk-test', online_api_url: 'http://x', online_api_model: 'm' })
    h.config.patchSave({ brain_mode: 'online' })

    h.call('msg:send', { text: 'hi there' })
    await flush()
    expect(h.llmCalls()).toBe(1)
    const firstReply = h.sent.filter(([c]) => c === 'reply').at(-1)[1]
    expect(firstReply.text).toContain('reply number 1')

    h.sent.length = 0
    expect(h.call('msg:regenerate')).toEqual({ queued: true })
    await flush()

    expect(h.llmCalls()).toBe(2)
    expect(h.brain.history).toHaveLength(2)
    expect(h.brain.history[0]).toEqual({ role: 'user', content: 'hi there' })
    expect(h.brain.history[1].content).toContain('reply number 2')

    const reply = h.sent.find(([c]) => c === 'reply')?.[1]
    expect(reply.text).toContain('reply number 2')
    expect(reply.emotion).toBe('happy')
    expect(h.sent.some(([c]) => c === 'stats')).toBe(true)
    expect(h.sent.some(([c]) => c === 'traits')).toBe(true)
  })

  it('acks queued and pushes error when nothing to regenerate', async () => {
    const h = makeHarness()
    expect(h.call('msg:regenerate')).toEqual({ queued: true })
    await flush()
    expect(h.sent.at(-1)).toEqual(['error', { scope: 'brain', message: 'Nothing to regenerate' }])
    expect(h.llmCalls()).toBe(0)
  })

  it('does not duplicate the user message when regenerating', async () => {
    const h = makeHarness()
    h.config.patchConfig({ online_api_key: 'sk-test', online_api_url: 'http://x', online_api_model: 'm' })
    h.config.patchSave({ brain_mode: 'online' })
    await h.brain.send('first')
    await h.brain.send('second')
    h.call('msg:regenerate')
    await flush()
    const userMsgs = h.brain.history.filter((m) => m.role === 'user' && m.content === 'second')
    expect(userMsgs).toHaveLength(1)
    expect(h.brain.history[h.brain.history.length - 1].role).toBe('assistant')
  })
})

describe('setup:redo', () => {
  it('clears setup state and session traits, keeps permanents (legacy parity)', () => {
    const h = makeHarness()
    h.call('setup:complete', { user_name: 'Abtin' })
    h.memory.addTrait('went hiking today')
    expect(h.config.getSave().setup_complete).toBe(true)

    const save = h.call('setup:redo')
    expect(save.setup_complete).toBe(false)
    expect(save.setup_answers).toEqual({})
    expect(h.memory.getSessionTraits()).toEqual([])
    expect(h.memory.getPermanent()).toContain("user's user name: Abtin")
  })
})

describe('profile:factory-reset', () => {
  it('deletes data files, recreates defaults, returns fresh save', async () => {
    const h = makeHarness()
    h.call('setup:complete', { user_name: 'Abtin' })
    h.memory.addTrait('went hiking today')
    h.config.patchSave({ session_summary: 'recap', persona: 'Gothic' })

    const save = h.call('profile:factory-reset')

    expect(save.setup_complete).toBe(false)
    expect(save.persona).toBe('Tsundere')
    expect(save.stats.affection).toBe(20)

    const dataDir = path.join(h.root, 'data')
    expect(fs.existsSync(path.join(dataDir, 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'save.json'))).toBe(true)
    const fresh = JSON.parse(fs.readFileSync(path.join(dataDir, 'save.json'), 'utf8'))
    expect(fresh.persona).toBe('Tsundere')
    expect(fresh.session_summary).toBeUndefined()
    expect(fresh.setup_answers).toEqual({})
  })

  it('wipes memory files and subsequent handlers use fresh services', async () => {
    const h = makeHarness()
    h.call('setup:complete', { user_name: 'Abtin' })
    h.memory.addTrait('went hiking today')
    h.config.patchSave({ persona: 'Gothic' })

    h.call('profile:factory-reset')

    const memDir = path.join(h.root, 'data', 'memory')
    for (const name of ['session-traits.json', 'permanent-facts.json', 'session-cache.json', '.migrated']) {
      expect(fs.existsSync(path.join(memDir, name))).toBe(false)
    }

    const boot = h.call('app:init')
    expect(boot.save.setup_complete).toBe(false)
    expect(boot.save.persona).toBe('Tsundere')
    expect(boot.traits).toEqual([])
    expect(boot.permanentFacts).toEqual([])

    h.call('profile:save', { brain_mode: 'offline' })
    h.call('msg:send', { text: 'still alive?' })
    await flush()
    const freshSave = JSON.parse(fs.readFileSync(path.join(h.root, 'data', 'save.json'), 'utf8'))
    expect(freshSave.setup_complete).toBe(false)
    expect(freshSave.brain_mode).toBe('offline')
    expect(h.sent.some(([c]) => c === 'reply')).toBe(true)
  })

  it('leaves legacy root files untouched', () => {
    const h = makeHarness()
    const legacyPath = path.join(h.root, 'dvc_profile.json')
    fs.writeFileSync(legacyPath, JSON.stringify({ user_name: 'LegacyUser' }))
    h.call('profile:factory-reset')
    expect(fs.existsSync(legacyPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(legacyPath, 'utf8')).user_name).toBe('LegacyUser')
  })
})

describe('preload allowlist extensions', () => {
  it('accepts each new invoke channel and still rejects unknown ones', async () => {
    const { ipcRenderer } = await import('electron')
    const api = contextBridge.exposeInMainWorld.mock.calls.at(-1)[1]
    const channels = [
      'stats:adjust',
      'memory:delete-trait',
      'memory:wipe-traits',
      'memory:delete-permanent',
      'memory:wipe-permanent',
      'memory:clear-summary',
      'history:get',
      'history:clear',
      'msg:regenerate',
      'setup:redo',
      'profile:factory-reset'
    ]
    for (const ch of channels) {
      ipcRenderer.invoke.mockResolvedValueOnce({ ok: true })
      await expect(api.invoke(ch)).resolves.toEqual({ ok: true })
    }
    await expect(api.invoke('evil:channel')).rejects.toThrow('Unknown channel')
  })
})
