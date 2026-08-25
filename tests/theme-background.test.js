import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DEFAULT_THEME_ID, THEME_GRADIENTS, THEME_LIST } from '../src/main/data/themes.js'
import {
  applyBackground,
  resolveBackground
} from '../src/renderer/src/features/settings/background.js'
import { useStore } from '../src/renderer/src/state/store.js'

// Theme ↔ background unification: every preset theme owns a built-in shell
// gradient; a custom override wins only while enabled. DOM is stubbed with a
// recording style object — no jsdom needed.

let cssVars

function stubDocument() {
  cssVars = {}
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (key, value) => {
          cssVars[key] = value
        },
        removeProperty: (key) => {
          delete cssVars[key]
        }
      }
    }
  }
}

describe('THEME_GRADIENTS coverage', () => {
  it('covers exactly the THEME_LIST ids', () => {
    expect(Object.keys(THEME_GRADIENTS).sort()).toEqual([...THEME_LIST].sort())
  })

  it('every entry has valid hex pairs and an angle in range', () => {
    for (const id of THEME_LIST) {
      const g = THEME_GRADIENTS[id]
      expect(g, `gradient missing for ${id}`).toBeTruthy()
      expect(g.from).toMatch(/^#[0-9a-f]{6}$/i)
      expect(g.to).toMatch(/^#[0-9a-f]{6}$/i)
      expect(g.from.toLowerCase()).not.toBe(g.to.toLowerCase())
      expect(Number.isFinite(g.angle)).toBe(true)
      expect(g.angle).toBeGreaterThanOrEqual(120)
      expect(g.angle).toBeLessThanOrEqual(170)
    }
  })
})

describe('resolveBackground precedence', () => {
  const CUSTOM = { enabled: true, from: '#112233', to: '#445566', angle: 200 }

  it('custom enabled → custom values win', () => {
    const resolved = resolveBackground({ themeId: 'matrix', customGradient: CUSTOM })
    expect(resolved).toEqual({ enabled: true, from: '#112233', to: '#445566', angle: 200 })
  })

  it('custom off → the selected theme gradient applies', () => {
    const resolved = resolveBackground({
      themeId: 'matrix',
      customGradient: { ...CUSTOM, enabled: false }
    })
    expect(resolved).toEqual({ enabled: true, ...THEME_GRADIENTS.matrix })
  })

  it('unknown theme → midnight-sakura fallback', () => {
    expect(resolveBackground({ themeId: 'nope' })).toEqual({
      enabled: true,
      ...THEME_GRADIENTS[DEFAULT_THEME_ID]
    })
    expect(DEFAULT_THEME_ID).toBe('midnight-sakura')
  })

  it('missing options still resolve to the default theme', () => {
    expect(resolveBackground()).toEqual({ enabled: true, ...THEME_GRADIENTS[DEFAULT_THEME_ID] })
  })
})

describe('applyBackground writes shell vars', () => {
  beforeEach(stubDocument)

  afterEach(() => {
    delete globalThis.document
  })

  it('applies the theme gradient when custom is off', () => {
    applyBackground({ themeId: 'amber-terminal', customGradient: { enabled: false } })
    const t = THEME_GRADIENTS['amber-terminal']
    expect(cssVars['--shell-grad-from']).toBe(t.from)
    expect(cssVars['--shell-grad-to']).toBe(t.to)
    expect(cssVars['--shell-grad-angle']).toBe(`${t.angle}deg`)
  })

  it('applies custom values when enabled', () => {
    applyBackground({
      themeId: 'matrix',
      customGradient: { enabled: true, from: '#aabbcc', to: '#001122', angle: 45 }
    })
    expect(cssVars['--shell-grad-from']).toBe('#aabbcc')
    expect(cssVars['--shell-grad-to']).toBe('#001122')
    expect(cssVars['--shell-grad-angle']).toBe('45deg')
  })
})

describe('store integration: background follows both fields', () => {
  beforeEach(() => {
    stubDocument()
    useStore.setState({
      booted: true,
      theme: 'midnight-sakura',
      config: {},
      error: null,
      _unsubs: [],
      _bgUnsub: null,
      _errorTimer: null,
      _transientTimer: null,
      _mcConnectTimer: null,
      _liveTimers: {},
      _livePayloads: {},
      _liveOrigins: {}
    })
  })

  afterEach(() => {
    useStore.getState()._teardown()
    delete globalThis.document
  })

  it('applies immediately when armed and re-applies on theme change', () => {
    useStore.getState()._watchBackground()
    expect(cssVars['--shell-grad-from']).toBe(THEME_GRADIENTS['midnight-sakura'].from)

    useStore.setState({ theme: 'matrix' })
    expect(cssVars['--shell-grad-from']).toBe(THEME_GRADIENTS.matrix.from)
    expect(cssVars['--shell-grad-angle']).toBe(`${THEME_GRADIENTS.matrix.angle}deg`)
  })

  it('re-applies when custom_gradient toggles on and returns to theme when off', () => {
    useStore.getState()._watchBackground()
    useStore.setState({
      config: { custom_gradient: { enabled: true, from: '#112233', to: '#445566', angle: 200 } }
    })
    expect(cssVars['--shell-grad-from']).toBe('#112233')
    expect(cssVars['--shell-grad-angle']).toBe('200deg')

    // Turning custom off hands control back to the theme's own gradient.
    useStore.setState({ config: { custom_gradient: { enabled: false } } })
    expect(cssVars['--shell-grad-from']).toBe(THEME_GRADIENTS['midnight-sakura'].from)
  })

  it('ignores unrelated state churn', () => {
    useStore.getState()._watchBackground()
    const before = { ...cssVars }
    useStore.setState({ stats: { happiness: 42 }, typing: true })
    expect(cssVars).toEqual(before)
  })

  it('live settings path drives it end-to-end (theme_id + custom_gradient)', async () => {
    globalThis.window = globalThis.window || {}
    window.dvc = { invoke: () => Promise.resolve({}), on: () => () => {} }
    useStore.getState()._watchBackground()

    useStore.getState().saveLiveSetting('theme_id', 'gold')
    expect(cssVars['--shell-grad-from']).toBe(THEME_GRADIENTS.gold.from)

    useStore.getState().saveLiveSetting('custom_gradient', {
      enabled: true,
      from: '#ff0000',
      to: '#0000ff',
      angle: 90
    })
    expect(cssVars['--shell-grad-from']).toBe('#ff0000')
  })
})
