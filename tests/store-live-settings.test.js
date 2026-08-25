import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useStore } from '../src/renderer/src/state/store.js'
import { AUTO_SAVE_DEBOUNCE_MS } from '../src/renderer/src/features/settings/liveSettings.js'

// Live-setting auto-save machinery: per-key trailing debounce, optimistic
// apply, guarded rollback, flush-on-close semantics. Same stubbed-dvc +
// fake-timers setup as store-fixwave.test.js.
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

function invokesFor(channel) {
  return invokes.filter((i) => i.channel === channel)
}

function lastInvoke(channel) {
  const list = invokesFor(channel)
  expect(list.length).toBeGreaterThan(0)
  return list[list.length - 1]
}

function settleAll(channel, mode, value) {
  for (const entry of invokes) {
    if (entry.channel === channel && !entry.settled) {
      entry.settled = true
      if (mode === 'resolve') entry.resolve(value ?? {})
      else entry.reject(value ?? new Error('boom'))
    }
  }
}

// Settle helper + a microtask tick so the store's .then continuations run
// under fake timers.
async function settleAllAndFlush(channel, mode, value) {
  settleAll(channel, mode, value)
  await vi.advanceTimersByTimeAsync(0)
}

describe('live settings auto-save', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const key of Object.keys(handlers)) delete handlers[key]
    invokes = []
    stubDvc()
    useStore.setState({
      booted: true,
      theme: 'midnight-sakura',
      heartsVisible: true,
      fontScale: 1,
      config: { ui_sounds: true, particle_theme: 'stars' },
      error: null,
      liveSavedSeq: {},
      _unsubs: [],
      _errorTimer: null,
      _transientTimer: null,
      _mcConnectTimer: null
    })
    useStore.setState({ _liveTimers: {}, _livePayloads: {}, _liveOrigins: {} })
  })

  afterEach(() => {
    useStore.getState()._teardown()
    vi.useRealTimers()
  })

  it('applies the change optimistically before any save fires', () => {
    useStore.getState().saveLiveSetting('ui_sounds', false)
    // No debounce has elapsed yet…
    expect(invokesFor('profile:save')).toHaveLength(0)
    // …but the store (and every preview reading it) already shows the change.
    expect(useStore.getState().config.ui_sounds).toBe(false)
  })

  it('collapses rapid toggles into ONE trailing debounced save with the last value', async () => {
    const s = useStore.getState()
    s.saveLiveSetting('ui_sounds', false)
    await vi.advanceTimersByTimeAsync(100)
    s.saveLiveSetting('ui_sounds', true)
    await vi.advanceTimersByTimeAsync(100)
    s.saveLiveSetting('ui_sounds', false)
    expect(invokesFor('profile:save')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 150)
    expect(invokesFor('profile:save')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(200)
    const saves = invokesFor('profile:save')
    expect(saves).toHaveLength(1)
    expect(saves[0].payload).toEqual({ ui_sounds: false })
    expect(useStore.getState().config.ui_sounds).toBe(false)
  })

  it('debounces keys independently', async () => {
    const s = useStore.getState()
    s.saveLiveSetting('ui_sounds', false)
    await vi.advanceTimersByTimeAsync(250)
    s.saveLiveSetting('particle_theme', 'sakura')
    // Just past ui_sounds' deadline (t=400) but before particle_theme's (t=650).
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 250 + 1)

    const saves = invokesFor('profile:save')
    expect(saves).toHaveLength(1)
    expect(saves[0].payload).toEqual({ ui_sounds: false })

    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    expect(invokesFor('profile:save')).toHaveLength(2)
    expect(lastInvoke('profile:save').payload).toEqual({ particle_theme: 'sakura' })
  })

  it('maps top-level save fields onto their store slices', async () => {
    const s = useStore.getState()
    s.saveLiveSetting('theme_id', 'ember-night')
    s.saveLiveSetting('font_scale', 1.15)
    s.saveLiveSetting('hearts_visible', false)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)

    expect(useStore.getState().theme).toBe('ember-night')
    expect(useStore.getState().fontScale).toBe(1.15)
    expect(useStore.getState().heartsVisible).toBe(false)
    const payloads = invokesFor('profile:save').map((i) => i.payload)
    expect(payloads).toEqual([
      { theme_id: 'ember-night' },
      { font_scale: 1.15 },
      { hearts_visible: false }
    ])
  })

  it('ignores a no-op write (value identical to live state)', async () => {
    useStore.getState().saveLiveSetting('ui_sounds', true)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 50)
    expect(invokesFor('profile:save')).toHaveLength(0)
  })

  it('bumps the saved-flicker counter when the persist resolves', async () => {
    useStore.getState().saveLiveSetting('particle_theme', 'sakura')
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    await settleAllAndFlush('profile:save', 'resolve', {})

    expect(useStore.getState().liveSavedSeq.particle_theme).toBe(1)

    // A second save bumps again so the row flicker can replay.
    useStore.getState().saveLiveSetting('particle_theme', 'snow')
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    await settleAllAndFlush('profile:save', 'resolve', {})
    expect(useStore.getState().liveSavedSeq.particle_theme).toBe(2)
  })

  it('rolls back to the pre-burst origin when the save fails', async () => {
    const s = useStore.getState()
    // Burst: stars → sakura → snow. Origin captured on first write is stars.
    s.saveLiveSetting('particle_theme', 'sakura')
    await vi.advanceTimersByTimeAsync(50)
    s.saveLiveSetting('particle_theme', 'snow')
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)

    await settleAllAndFlush('profile:save', 'reject', new Error('disk full'))

    expect(useStore.getState().config.particle_theme).toBe('stars')
    expect(useStore.getState().error?.scope).toBe('profile')
    expect(useStore.getState().error?.message).toContain('disk full')
  })

  it('rollback is guarded: a newer edit supersedes the failed save', async () => {
    const s = useStore.getState()
    s.saveLiveSetting('ui_sounds', false)
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)

    const stale = lastInvoke('profile:save') // carries ui_sounds:false

    // A newer edit lands while the first save is still in flight.
    s.saveLiveSetting('ui_sounds', true)

    stale.settled = true
    stale.reject(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(0)

    // The failed payload is no longer the live value → keep the newer edit.
    expect(useStore.getState().config.ui_sounds).toBe(true)
    expect(useStore.getState().error?.scope).toBe('profile')
  })

  it('flush persists immediately, cancels the timer, and Cancel/close never reverts the key', async () => {
    useStore.getState().saveLiveSetting('tray_enabled', false)
    // Manual Save / overlay close path: flush BEFORE the debounce elapses.
    const flushed = useStore.getState().flushLiveSaves()
    expect(invokesFor('profile:save')).toHaveLength(1)
    settleAll('profile:save', 'resolve', {})
    await vi.advanceTimersByTimeAsync(0)
    await flushed

    // Waiting past the original deadline must NOT fire a second (double) save.
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2)
    expect(invokesFor('profile:save')).toHaveLength(1)

    // The auto-saved key stays live-and-persisted: closing settings (Cancel)
    // only flushes — nothing reverts values that are already applied.
    expect(useStore.getState().config.tray_enabled).toBe(false)
    expect(useStore.getState().liveSavedSeq.tray_enabled).toBe(1)
    expect(Object.keys(useStore.getState()._liveTimers)).toHaveLength(0)
  })

  it('teardown drops pending saves without firing them', async () => {
    useStore.getState().saveLiveSetting('idle_chat', false)
    useStore.getState()._teardown()
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2)
    expect(invokesFor('profile:save')).toHaveLength(0)
    expect(useStore.getState()._liveTimers).toEqual({})
  })
})
