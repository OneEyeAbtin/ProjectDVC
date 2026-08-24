import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useStore } from '../src/renderer/src/state/store.js'
import { createTtsLipSyncLoop, LIP_SYNC_INTERVAL_MS } from '../src/renderer/src/features/voice/lipSyncLoop.js'

globalThis.window = globalThis.window || {}

describe('tts lip-sync loop (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.setState({ lipSyncTts: true, emotion: 'happy', transientEmotion: null })
  })
  afterEach(() => vi.useRealTimers())

  it('alternates transient talking with the current canonical emotion', () => {
    const loop = createTtsLipSyncLoop()
    loop.start()
    try {
      vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
      expect(useStore.getState().transientEmotion).toBe('talking')
      vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
      // Rest phase reads the canonical emotion at tick time; 'happy' is
      // persistent so setEmotion keeps it canonical and clears the override.
      expect(useStore.getState().transientEmotion).toBeNull()
      expect(useStore.getState().emotion).toBe('happy')
      vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
      expect(useStore.getState().transientEmotion).toBe('talking')
    } finally {
      loop.stop()
    }
  })

  it('reads the resting face at tick time when a mid-speech push lands', () => {
    const loop = createTtsLipSyncLoop()
    loop.start()
    try {
      vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
      useStore.setState({ emotion: 'sad' })
      vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
      expect(useStore.getState().emotion).toBe('sad')
      expect(useStore.getState().transientEmotion).toBeNull()
    } finally {
      loop.stop()
    }
  })

  it('the store expiry never fires mid-speech because ticks re-arm it', () => {
    const loop = createTtsLipSyncLoop()
    loop.start()
    try {
      // Well past the 2s self-expiry of any single setEmotion call.
      for (let i = 0; i < 20; i += 1) {
        vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
        const t = useStore.getState().transientEmotion
        expect(t === 'talking' || t === null).toBe(true)
        if (i % 2 === 0) expect(t).toBe('talking')
      }
    } finally {
      loop.stop()
    }
  })

  it('stop clears the interval — no toggles after the stop signal', () => {
    const loop = createTtsLipSyncLoop()
    loop.start()
    vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS * 2) // land on a rest-phase tick
    expect(useStore.getState().transientEmotion).toBeNull()
    loop.stop()
    vi.advanceTimersByTime(5000)
    // Stopped: no further talking toggles (and no pending expiry either —
    // persistent-emotion ticks don't arm one).
    expect(useStore.getState().transientEmotion).toBeNull()
  })

  it('disabling lip_sync_tts mid-loop halts toggling; expiry backstop cleans up', () => {
    const loop = createTtsLipSyncLoop()
    loop.start()
    vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
    expect(useStore.getState().transientEmotion).toBe('talking')
    useStore.setState({ lipSyncTts: false })
    // Ticks stop immediately; the store's 2s self-expiry is the backstop
    // that clears a lingering 'talking' when no clean ended-event arrives.
    vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS * 4)
    expect(useStore.getState().transientEmotion).toBe('talking')
    vi.advanceTimersByTime(2500)
    expect(useStore.getState().transientEmotion).toBeNull()
  })

  it('restart via start() replaces any previous interval', () => {
    const loop = createTtsLipSyncLoop()
    loop.start()
    loop.start()
    vi.advanceTimersByTime(LIP_SYNC_INTERVAL_MS)
    expect(useStore.getState().transientEmotion).toBe('talking')
    loop.stop()
    vi.advanceTimersByTime(5000)
    expect(useStore.getState().transientEmotion).toBeNull()
  })
})

describe('text lip-sync coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.setState({ lipSyncText: true, audioPlaying: false, emotion: 'happy' })
  })
  afterEach(() => vi.useRealTimers())

  it('word toggle flips render-only talking↔neutral without touching emotion', () => {
    const { textLipSync } = useStore.getState()
    textLipSync(true)
    expect(useStore.getState().transientEmotion).toBe('talking')
    textLipSync(false)
    expect(useStore.getState().transientEmotion).toBe('neutral')
    textLipSync(true)
    expect(useStore.getState().transientEmotion).toBe('talking')
    expect(useStore.getState().emotion).toBe('happy')
  })

  it('skips while TTS audio is playing — the audio loop wins', () => {
    useStore.setState({ audioPlaying: true, transientEmotion: 'talking' })
    useStore.getState().textLipSync(false)
    expect(useStore.getState().transientEmotion).toBe('talking')
    // Playback ends → flag drops → word toggles work again.
    useStore.setState({ audioPlaying: false })
    useStore.getState().textLipSync(false)
    expect(useStore.getState().transientEmotion).toBe('neutral')
  })

  it('skips entirely when lip_sync_text is off', () => {
    useStore.setState({ lipSyncText: false, transientEmotion: null })
    useStore.getState().textLipSync(true)
    expect(useStore.getState().transientEmotion).toBeNull()
  })

  it('completeType clears a lingering word-lip-sync state', () => {
    useStore.getState().textLipSync(true)
    expect(useStore.getState().transientEmotion).toBe('talking')
    useStore.setState({
      bubble: { text: 'done', muted: false },
      typing: true,
      pendingEmotion: null,
      _transientTimer: null
    })
    useStore.getState().completeType()
    expect(useStore.getState().transientEmotion).toBeNull()
    expect(useStore.getState().typing).toBe(false)
  })
})
