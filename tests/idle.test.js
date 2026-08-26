import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { IDLE_LINES } from '../src/main/data/personas.js'
import {
  randomIdleDelayMs,
  pickIdleLine,
  createIdleService,
  IDLE_MIN_MINUTES,
  IDLE_MAX_MINUTES,
  IDLE_BUSY_GRACE_MS
} from '../src/main/services/idle.service.js'
import { createConfigService } from '../src/main/services/config.service.js'
import { createMemoryService } from '../src/main/services/memory.service.js'
import { createCharactersService } from '../src/main/services/characters.service.js'
import { createBrain } from '../src/main/services/brain.service.js'

const MIN_MS = IDLE_MIN_MINUTES * 60 * 1000
const MAX_MS = IDLE_MAX_MINUTES * 60 * 1000

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-idle-'))
}

function makeHarness({ idleRand = () => 0 } = {}) {
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
    services: { config, memory, characters, brain },
    getWin: () => ({
      isDestroyed: () => false,
      webContents: { send: (channel, payload) => sent.push([channel, payload]) }
    }),
    idleRand
  })
  const handlers = new Map(ipcMain.handle.mock.calls.map(([ch, fn]) => ([ch, fn])))
  return {
    config,
    sent,
    call: (channel, payload) => handlers.get(channel)(null, payload),
    idleReplies: () =>
      sent.filter(([c, p]) => c === 'reply' && IDLE_LINES.some((l) => l.text === p.text))
  }
}

beforeEach(() => {
  ipcMain.handle.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('idle pure helpers', () => {
  it('randomIdleDelayMs stays inside the 8-14 minute window', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const ms = randomIdleDelayMs(() => r)
      expect(ms).toBeGreaterThanOrEqual(MIN_MS)
      expect(ms).toBeLessThanOrEqual(MAX_MS)
    }
    expect(randomIdleDelayMs(() => 0)).toBe(MIN_MS)
    expect(randomIdleDelayMs(() => 1)).toBe(MAX_MS)
    const fallback = randomIdleDelayMs()
    expect(fallback).toBeGreaterThanOrEqual(MIN_MS)
    expect(fallback).toBeLessThanOrEqual(MAX_MS)
  })

  it('pickIdleLine returns pool entries and honors injected rand', () => {
    expect(pickIdleLine(IDLE_LINES, () => 0)).toBe(IDLE_LINES[0])
    for (let i = 0; i < 50; i++) {
      expect(IDLE_LINES).toContain(pickIdleLine(IDLE_LINES))
    }
    expect(pickIdleLine([], Math.random)).toBe('')
  })

  it('createIdleService fires only when enabled and past the grace window', () => {
    let enabled = true
    let lastActivity = Date.now() - IDLE_BUSY_GRACE_MS * 10 // stale → not busy
    let fires = 0
    const svc = createIdleService({
      getEnabled: () => enabled,
      getLastActivity: () => lastActivity,
      fire: () => fires++,
      rand: () => 0
    })
    svc.schedule()

    // Disabled: never fires.
    enabled = false
    vi.advanceTimersByTime(MIN_MS * 2)
    expect(fires).toBe(0)

    // Enabled again with stale activity: next attempt fires cleanly.
    enabled = true
    svc.stop()
    svc.schedule()
    vi.advanceTimersByTime(MIN_MS - 1)
    expect(fires).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fires).toBe(1)

    // Recent activity inside the grace window suppresses the fire, but the
    // service reschedules instead of dropping out.
    lastActivity = Date.now()
    vi.advanceTimersByTime(MIN_MS - IDLE_BUSY_GRACE_MS / 2)
    lastActivity = Date.now()
    vi.advanceTimersByTime(IDLE_BUSY_GRACE_MS / 2 + 1000) // scheduled fire: busy
    expect(fires).toBe(1)
    vi.advanceTimersByTime(MIN_MS) // rescheduled attempt: activity now stale
    expect(fires).toBe(2)

    svc.stop()
    vi.advanceTimersByTime(MAX_MS * 3)
    expect(fires).toBe(2)
  })
})

describe('idle chatter wiring', () => {
  it('pushes an idle line after the randomized interval, repeatedly', async () => {
    const h = makeHarness({ idleRand: () => 0 }) // first fire at exactly MIN_MS
    await vi.advanceTimersByTimeAsync(MIN_MS - 1)
    expect(h.idleReplies()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.idleReplies()).toHaveLength(1)
    const reply = h.sent.find(([c]) => c === 'reply')[1]
    expect(reply.text).toBe(IDLE_LINES[0].text)
    expect(IDLE_LINES.some((l) => l.text.includes('[EMOTION:'))).toBe(false)

    await vi.advanceTimersByTimeAsync(MIN_MS)
    expect(h.idleReplies()).toHaveLength(2)
  })

  it('REGRESSION (bug A): the idle push carries the line’s own emotion, never null', async () => {
    // User report: "Bored. Bored. Bored." displayed with a HAPPY face because
    // idle pushes shipped emotion:null and the renderer kept its stale face.
    const h = makeHarness({ idleRand: () => 0 }) // IDLE_LINES[0] → thinking
    await vi.advanceTimersByTimeAsync(MIN_MS)
    const replies = h.sent.filter(([c]) => c === 'reply')
    for (const [, payload] of replies) {
      const entry = IDLE_LINES.find((l) => l.text === payload.text)
      expect(entry).toBeDefined()
      expect(payload.emotion).toBe(entry.emotion)
      expect(payload.emotion).not.toBeNull()
    }
    expect(replies[0][1].emotion).toBe(IDLE_LINES[0].emotion)
  })

  it('never fires when idle_chat is disabled', async () => {
    const h = makeHarness()
    h.config.patchConfig({ idle_chat: false })
    await vi.advanceTimersByTimeAsync(MAX_MS * 5)
    expect(h.sent.filter(([c]) => c === 'reply')).toHaveLength(0)
  })

  it('timer resets on msg:send so a fire cannot land right after chatting', async () => {
    const h = makeHarness({ idleRand: () => 0.5 }) // fire at midpoint (~11min)
    const midpoint = (MIN_MS + MAX_MS) / 2

    await vi.advanceTimersByTimeAsync(midpoint - 60_000)
    h.config.patchSave({ hearts_visible: true })
    h.call('msg:send', { text: 'showmehearts' }) // sync cheat, no LLM involved
    await vi.advanceTimersByTimeAsync(120_000)
    expect(h.idleReplies()).toHaveLength(0)

    // Countdown restarted at send time: full midpoint must elapse again.
    await vi.advanceTimersByTimeAsync(midpoint - 120_000)
    expect(h.idleReplies()).toHaveLength(1)
  })

  it('suppressed fire during the busy grace window reschedules instead of dropping', async () => {
    const h = makeHarness({ idleRand: () => 0 })
    // Activity recorded just before the scheduled fire → grace suppresses it.
    await vi.advanceTimersByTimeAsync(MIN_MS - IDLE_BUSY_GRACE_MS / 2)
    h.call('msg:send', { text: 'showmehearts' })
    await vi.advanceTimersByTimeAsync(MIN_MS + IDLE_BUSY_GRACE_MS)
    expect(h.idleReplies()).toHaveLength(1)
  })
})
