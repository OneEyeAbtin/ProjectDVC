import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useStore } from '../src/renderer/src/state/store.js'

// Store reads window.dvc lazily inside actions, so a stub assigned here is
// enough; no boot()/subscribe needed for optimistic-switch tests.
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const invokes = []
globalThis.window = globalThis.window || {}
window.dvc = {
  invoke(channel, payload) {
    const d = deferred()
    invokes.push({ channel, payload, ...d })
    return d.promise
  },
  on() {
    return () => {}
  }
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('store optimistic switches guard against late rejections', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invokes.length = 0
    useStore.setState({ persona: 'P1', outfit: 'Base', theme: 'midnight-sakura', error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('late persona rejection does not clobber a newer committed persona', async () => {
    const { setPersona } = useStore.getState()
    setPersona('A')
    setPersona('B')
    expect(useStore.getState().persona).toBe('B')

    // Older request (A) fails after B was already applied optimistically.
    invokes[0].reject(new Error('boom'))
    await flush()
    expect(useStore.getState().persona).toBe('B')
    expect(useStore.getState().error?.scope).toBe('profile')
  })

  it('current persona rejection still rolls back to its own previous value', async () => {
    useStore.getState().setPersona('A')
    invokes[0].reject(new Error('boom'))
    await flush()
    expect(useStore.getState().persona).toBe('P1')
  })

  it('late outfit rejection does not clobber a newer committed outfit', async () => {
    const { switchOutfit } = useStore.getState()
    switchOutfit('Casual')
    switchOutfit('Formal')
    invokes[0].reject(new Error('boom'))
    await flush()
    expect(useStore.getState().outfit).toBe('Formal')
    expect(invokes.map((i) => i.channel)).toEqual(['outfit:switch', 'outfit:switch'])
  })

  it('late theme rejection does not clobber a newer committed theme', async () => {
    const { setTheme } = useStore.getState()
    setTheme('ocean-dusk')
    setTheme('neon-night')
    invokes[0].reject(new Error('boom'))
    await flush()
    expect(useStore.getState().theme).toBe('neon-night')
  })

  it('successful saves leave the optimistic value in place', async () => {
    useStore.getState().setPersona('A')
    useStore.getState().switchOutfit('Casual')
    useStore.getState().setTheme('ocean-dusk')
    for (const inv of [...invokes]) inv.resolve({})
    await flush()
    expect(useStore.getState().persona).toBe('A')
    expect(useStore.getState().outfit).toBe('Casual')
    expect(useStore.getState().theme).toBe('ocean-dusk')
  })
})
