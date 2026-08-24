import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useStore } from '../src/renderer/src/state/store.js'

// Store reads window.dvc lazily inside actions; this stub captures push
// handlers so tests can fire bus-driven events (reply/memory/emotion).
globalThis.window = globalThis.window || {}

const handlers = {}
let invokes = []

function stubDvc() {
  window.dvc = {
    invoke(channel, payload) {
      return new Promise((resolve, reject) => {
        invokes.push({ channel, payload, resolve, reject, settled: false })
      })
    },
    on(channel, fn) {
      handlers[channel] = fn
      return () => delete handlers[channel]
    }
  }
}

function pendingInvoke(channel) {
  for (let i = invokes.length - 1; i >= 0; i--) {
    if (invokes[i].channel === channel && !invokes[i].settled) return invokes[i]
  }
  return undefined
}

function settleInvoke(channel, mode, value) {
  const entry = pendingInvoke(channel)
  entry.settled = true
  if (mode === 'resolve') entry.resolve(value)
  else entry.reject(value)
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('fixwave B renderer fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const key of Object.keys(handlers)) delete handlers[key]
    invokes = []
    stubDvc()
    useStore.setState({
      booted: false,
      setupComplete: true,
      thinking: false,
      typing: false,
      bubble: null,
      error: null,
      historyCount: 0,
      maxHistory: 20,
      lastUserText: '',
      emotion: 'neutral',
      transientEmotion: null,
      pendingEmotion: null,
      lastResponse: '',
      _unsubs: [],
      _errorTimer: null,
      _transientTimer: null
    })
  })

  afterEach(() => {
    useStore.getState()._teardown()
    vi.useRealTimers()
  })

  describe('audit #1: tag-only replies', () => {
    it('falls back to a canned line instead of bricking the input', () => {
      useStore.setState({ thinking: true })
      useStore.getState()._onReply({ text: '', emotion: null })

      const s = useStore.getState()
      expect(s.thinking).toBe(false)
      expect(s.typing).toBe(true)
      expect(typeof s.bubble?.text).toBe('string')
      expect(s.bubble.text.length).toBeGreaterThan(0)
      expect(s.historyCount).toBe(1)

      // The canned line completes like any other reply.
      s.completeType()
      expect(useStore.getState().typing).toBe(false)
    })

    it('passes non-empty reply text through untouched', () => {
      useStore.getState()._onReply({ text: 'Hello!', emotion: 'happy' })
      const s = useStore.getState()
      expect(s.bubble.text).toBe('Hello!')
      expect(s.pendingEmotion).toBe('happy')
      expect(s.historyCount).toBe(1)
    })
  })

  describe('audit #4: forced transient emotion', () => {
    it('completeType clears the transient render state', () => {
      // "forcetalking": bus pushes emotion:set talking…
      useStore.getState().setEmotion('talking')
      expect(useStore.getState().transientEmotion).toBe('talking')

      // …then the cheat's reply push finishes typing.
      useStore.getState()._onReply({ text: '*strikes a pose*', emotion: 'talking' })
      useStore.getState().completeType()

      const s = useStore.getState()
      expect(s.transientEmotion).toBe(null)
      expect(s.emotion).toBe('neutral') // canonical emotion untouched
      expect(s.typing).toBe(false)
    })
  })

  describe('audit #7: amnesia clears regenerate target', () => {
    it('the memory push clears lastUserText along with historyCount', async () => {
      const bootPromise = useStore.getState().boot()
      settleInvoke('app:init', 'resolve', {})
      await bootPromise

      expect(handlers.memory).toBeTypeOf('function')
      useStore.setState({ lastUserText: 'remember this', historyCount: 7 })

      handlers.memory({ event: 'amnesia' })
      const s = useStore.getState()
      expect(s.lastUserText).toBe('')
      expect(s.historyCount).toBe(0)
    })
  })

  describe('audit #8: boot failure surfaces a retryable error', () => {
    it('app:init rejection sets scope:"boot" without booting', async () => {
      const bootPromise = useStore.getState().boot()
      settleInvoke('app:init', 'reject', new Error('main exploded'))
      await bootPromise

      const s = useStore.getState()
      expect(s.booted).toBe(false)
      expect(s.error.scope).toBe('boot')
      expect(s.error.message).toContain('main exploded')
    })

    it('retry after failure boots and clears the error', async () => {
      void useStore.getState().boot()
      settleInvoke('app:init', 'reject', new Error('boom'))
      await flush()

      void useStore.getState().boot()
      settleInvoke('app:init', 'resolve', { save: { setup_complete: true } })
      await flush()

      const s = useStore.getState()
      expect(s.booted).toBe(true)
      expect(s.error).toBe(null)
    })
  })
})
