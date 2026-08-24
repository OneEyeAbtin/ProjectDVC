import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
}))

import { ipcMain } from 'electron'
import { registerIpc } from '../src/main/ipc.js'
import { INVOKE_CHANNELS } from '../src/preload/api.js'
import { createConfigService } from '../src/main/services/config.service.js'
import { createMemoryService } from '../src/main/services/memory.service.js'
import { createCharactersService } from '../src/main/services/characters.service.js'
import { createBrain } from '../src/main/services/brain.service.js'

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-memio-'))
}

function makeHarness(dialog) {
  const root = makeRoot()
  const config = createConfigService({ rootDir: root })
  const memory = createMemoryService({ rootDir: root })
  const characters = createCharactersService({
    outfitsDir: root,
    emotions: ['neutral', 'happy']
  })
  const brain = createBrain({
    config,
    memory,
    callLLM: async () => 'ok [EMOTION: happy]'
  })
  const sent = []
  registerIpc({
    services: { config, memory, characters, brain, dialog },
    getWin: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => sent.push([channel, payload]) }
    })
  })
  const handlers = new Map(ipcMain.handle.mock.calls.map(([ch, fn]) => [ch, fn]))
  return {
    root,
    config,
    memory,
    sent,
    call: (channel, payload) => handlers.get(channel)(null, payload)
  }
}

beforeEach(() => {
  ipcMain.handle.mockClear()
})

describe('memory:export', () => {
  it('writes all four sections and returns saved:true', async () => {
    const target = path.join(os.tmpdir(), 'dvc-memio-export.json')
    let sawOpts = null
    const h = makeHarness({
      showSaveDialog: async (opts) => {
        sawOpts = opts
        return { canceled: false, filePath: target }
      }
    })
    h.memory.setSessionTraits(['likes pineapple pizza'])
    h.memory.addPermanentFacts(["user's hobby: pottery"])
    h.config.patchSave({ session_summary: 'a cozy evening chat', setup_answers: { user_name: 'Abtin' } })

    const result = await h.call('memory:export')
    expect(result.saved).toBe(true)
    expect(sawOpts.defaultPath).toMatch(/^dvc-memories-\d{8}\.json$/)
    expect(sawOpts.filters).toContainEqual({ name: 'JSON', extensions: ['json'] })

    const data = JSON.parse(fs.readFileSync(result.path, 'utf8'))
    expect(data.traits).toEqual(['likes pineapple pizza'])
    expect(data.permanentFacts).toEqual(["user's hobby: pottery"])
    expect(data.sessionSummary).toBe('a cozy evening chat')
    expect(data.setupAnswers).toEqual({ user_name: 'Abtin' })
  })

  it('cancel returns saved:false without writing anything', async () => {
    const missingPath = path.join(makeRoot(), 'never.json')
    const h = makeHarness({ showSaveDialog: async () => ({ canceled: true }) })
    const result = await h.call('memory:export')
    expect(result).toEqual({ saved: false })
    expect(fs.existsSync(missingPath)).toBe(false)
  })
})

describe('memory:import', () => {
  function makeImportFile(root, data) {
    const file = path.join(root, 'memories.json')
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data))
    return { canceled: false, filePaths: [file] }
  }

  it('merges traits as dedup union, adds permanent facts, fills empty summary/answers, pushes refreshes', async () => {
    const h = makeHarness({
      showOpenDialog: async (opts) => {
        expect(opts.filters).toContainEqual({ name: 'JSON', extensions: ['json'] })
        return makeImportFile(h.root, {
          traits: ['went hiking today', "user's age: 30"],
          permanentFacts: ["user's age: 30", 'plays bass guitar'],
          sessionSummary: 'imported recap',
          setupAnswers: { user_name: 'Abtin', hobby: 'bass' }
        })
      }
    })
    h.memory.setSessionTraits(['went hiking today']) // duplicate → deduped
    h.memory.addPermanentFacts(["user's age: 25"]) // digit-distinct → both kept
    h.config.patchSave({ setup_answers: { user_name: 'Local' }, session_summary: '' })

    const result = await h.call('memory:import')
    expect(result.imported).toBe(true)
    expect(result.traits.filter((t) => t.includes('hiking'))).toHaveLength(1)
    expect(result.permanentFacts).toEqual(
      expect.arrayContaining(["user's age: 25", "user's age: 30", 'plays bass guitar'])
    )
    expect(result.sessionSummary).toBe('imported recap')

    const save = h.config.getSave()
    expect(save.setup_answers.user_name).toBe('Local') // local wins
    expect(save.setup_answers.hobby).toBe('bass') // missing locally → filled

    const channels = h.sent.map(([c]) => c)
    expect(channels).toContain('traits')
    expect(channels).toContain('profile')
  })

  it('does not overwrite an existing non-empty summary', async () => {
    const h = makeHarness({
      showOpenDialog: async () =>
        makeImportFile(h.root, {
          traits: [],
          permanentFacts: [],
          sessionSummary: 'imported recap',
          setupAnswers: {}
        })
    })
    h.config.patchSave({ session_summary: 'local recap' })
    const result = await h.call('memory:import')
    expect(result.imported).toBe(true)
    expect(h.config.getSave().session_summary).toBe('local recap')
  })

  it('invalid JSON throws a friendly error', async () => {
    const h = makeHarness({ showOpenDialog: async () => makeImportFile(h.root, '{not json') })
    await expect(h.call('memory:import')).rejects.toThrow(/not valid JSON/)
  })

  it('wrong shape throws instead of merging partial data', async () => {
    const h = makeHarness({
      showOpenDialog: async () =>
        makeImportFile(h.root, { traits: 'oops', permanentFacts: [], sessionSummary: '', setupAnswers: {} })
    })
    await expect(h.call('memory:import')).rejects.toThrow(/unexpected memory file shape/)
    expect(h.sent.filter(([c]) => c === 'traits')).toHaveLength(0)
  })

  it('cancel returns imported:false without touching state', async () => {
    const h = makeHarness({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) })
    expect(await h.call('memory:import')).toEqual({ imported: false })
    expect(h.memory.getSessionTraits()).toEqual([])
  })
})

describe('memory transfer allowlist + preload parity', () => {
  it('export/import channels are allowlisted and registered', () => {
    makeHarness({})
    const registered = new Set(ipcMain.handle.mock.calls.map(([ch]) => ch))
    expect(registered.has('memory:export')).toBe(true)
    expect(registered.has('memory:import')).toBe(true)
    expect(INVOKE_CHANNELS.has('memory:export')).toBe(true)
    expect(INVOKE_CHANNELS.has('memory:import')).toBe(true)
  })
})
