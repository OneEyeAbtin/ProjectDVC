import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createConfigService } from '../src/main/services/config.service.js'
import { createMemoryService } from '../src/main/services/memory.service.js'
import { createBrain } from '../src/main/services/brain.service.js'
import { createQuitFlush } from '../src/main/lib/session-cache.js'

let root
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-sesscache-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const cachePath = () => path.join(root, 'data', 'memory', 'session-cache.json')
const savePath = () => path.join(root, 'data', 'save.json')

// Mirrors the wiring in src/main/index.js: onSummary reads config through the
// mutable services bag so a factory-reset instance swap is always respected.
function bootApp({ onSummary } = {}) {
  const services = {
    config: createConfigService({ rootDir: root }),
    memory: createMemoryService({ rootDir: root })
  }
  const brain = createBrain({
    config: services.config,
    memory: services.memory,
    callLLM: async () => 'ok [EMOTION: happy]',
    ...(onSummary ? { onSummary } : {})
  })
  services.brain = brain
  return services
}

describe('session-cache quit flush pipeline', () => {
  it('flushed brain history lands in session-cache.json and popPendingSummary returns it', async () => {
    const services = bootApp()
    services.config.patchSave({ brain_mode: 'offline' })
    await services.brain.send('hello there')
    await services.brain.send('how are you')
    expect(services.brain.history).toHaveLength(4)

    const flush = createQuitFlush({ getServices: () => services })
    expect(flush()).toBe(true)
    expect(fs.existsSync(cachePath())).toBe(true)

    const popped = services.memory.popPendingSummary()
    expect(popped).toEqual(services.brain.history.slice(-20))
    expect(popped[0]).toEqual({ role: 'user', content: 'hello there' })
  })

  it('flusher is idempotent — before-quit after close-when-not-hiding never double-writes', async () => {
    const services = bootApp()
    services.config.patchSave({ brain_mode: 'offline' })
    await services.brain.send('first')

    // index.js wires ONE flusher instance to both quit paths.
    const flush = createQuitFlush({ getServices: () => services })
    expect(flush()).toBe(true) // close path fires first
    const firstWrite = fs.readFileSync(cachePath(), 'utf8')

    await services.brain.send('second')
    expect(flush()).toBe(false) // before-quit path is a guarded no-op

    const secondRead = fs.readFileSync(cachePath(), 'utf8')
    expect(JSON.parse(secondRead).messages).toHaveLength(2)
    expect(secondRead).toBe(firstWrite)
  })

  it('empty history writes nothing', () => {
    const services = bootApp()
    const flush = createQuitFlush({ getServices: () => services })
    expect(flush()).toBe(false)
    expect(fs.existsSync(cachePath())).toBe(false)
  })

  it('flusher reads services dynamically — uses post-reset memory/brain instances', async () => {
    const services = bootApp()
    services.config.patchSave({ brain_mode: 'offline' })
    const flush = createQuitFlush({ getServices: () => services })

    services.memory = createMemoryService({ rootDir: root })
    await services.brain.send('after swap')

    expect(flush()).toBe(true)
    const messages = JSON.parse(fs.readFileSync(cachePath(), 'utf8')).messages
    expect(messages[0]).toEqual({ role: 'user', content: 'after swap' })
  })
})

describe('onSummary dynamic lookup across factory reset', () => {
  it('late summary from pre-reset brain cannot resurrect wiped save keys', () => {
    // Exact index.js wiring: brain created with an onSummary that reads config
    // through the mutable services bag.
    const services = {
      config: createConfigService({ rootDir: root }),
      memory: createMemoryService({ rootDir: root })
    }
    const preResetBrain = createBrain({
      config: services.config,
      memory: services.memory,
      onSummary: (summary) => {
        if (summary) services.config.patchSave({ session_summary: summary })
      }
    })
    void preResetBrain

    services.config.patchSave({ persona: 'Gothic', user_name: 'PreReset' })

    // Factory reset (as ipc.js profile:factory-reset): wipe files, swap fresh
    // instances into the bag. The pre-reset brain's onSummary stays alive.
    for (const name of ['save.json', 'config.json']) {
      fs.rmSync(path.join(root, 'data', name), { force: true })
    }
    services.config = createConfigService({ rootDir: root })
    services.memory = createMemoryService({ rootDir: root })

    // In-flight summarize resolves AFTER the reset — same closure the old brain holds.
    const staleOnSummary = (summary) => {
      if (summary) services.config.patchSave({ session_summary: summary })
    }
    staleOnSummary('recap of pre-reset chat')

    const onDisk = JSON.parse(fs.readFileSync(savePath(), 'utf8'))
    expect(onDisk.session_summary).toBe('recap of pre-reset chat')
    // No resurrection of pre-reset values — back to defaults, not wiped data:
    expect(onDisk.persona).toBe('Friend')
    expect(onDisk.user_name).toBe('User')
  })

  it('boot-time compressPending consumes shutdown cache and writes session_summary', async () => {
    // Previous session ended with cached history.
    const prev = bootApp()
    prev.config.patchSave({ brain_mode: 'offline' })
    await prev.brain.send('tea time')
    createQuitFlush({ getServices: () => prev })()

    // Next boot: fresh instances; compressPending called once after services exist.
    const services = bootApp({
      onSummary: (summary) => {
        if (summary) services.config.patchSave({ session_summary: summary })
      }
    })
    services.brain = createBrain({
      config: services.config,
      memory: services.memory,
      callLLM: async ({ messages }) =>
        messages[0].content.startsWith('Summarize') ? 'They talked about tea.' : 'ok',
      onSummary: (s) => services.config.patchSave({ session_summary: s })
    })
    // Prev session persisted brain_mode: 'offline'; user has since configured online.
    services.config.patchSave({ brain_mode: 'online' })
    services.brain.compressPending()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(services.config.getSave().session_summary).toBe('They talked about tea.')
    expect(fs.existsSync(cachePath())).toBe(false)
  })
})
