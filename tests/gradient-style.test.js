import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  GRADIENT_STYLE_OPTIONS,
  buildGradientCss,
  sanitizeGradientStyle,
  applyBackground,
  resolveBackground,
  styleGradientPatch
} from '../src/renderer/src/features/settings/background.js'
import { DEFAULTS, SETTINGS_KEYS } from '../src/main/data/defaults.js'
import { AUTO_SAVE_KEYS } from '../src/renderer/src/features/settings/liveSettings.js'
import { buildSnapshot, diffPatch } from '../src/renderer/src/features/settings/settingsDraft.js'
import { createConfigService } from '../src/main/services/config.service.js'

describe('gradient style registry', () => {
  it('offers the five documented shapes with their fixed linear angles', () => {
    expect(GRADIENT_STYLE_OPTIONS.map((s) => s.id)).toEqual([
      'diagonal', 'vertical', 'horizontal', 'diagonal-alt', 'radial'
    ])
    const angles = Object.fromEntries(GRADIENT_STYLE_OPTIONS.map((s) => [s.id, s.angle]))
    expect(angles).toEqual({ diagonal: 135, vertical: 180, horizontal: 90, 'diagonal-alt': 45, radial: undefined })
    expect(DEFAULTS.gradient_style).toBe('diagonal')
    expect(SETTINGS_KEYS).toContain('gradient_style')
  })

  it('labels are plain text — no emoji, arrows or symbols (user request)', () => {
    for (const s of GRADIENT_STYLE_OPTIONS) {
      expect(s.label, s.id).toMatch(/^[\w ]+$/)
      expect(s.label, s.id).not.toMatch(/[\u2190-\u21FF\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u)
    }
    expect(GRADIENT_STYLE_OPTIONS.map((s) => s.label)).toEqual([
      'Diagonal', 'Vertical', 'Horizontal', 'Diagonal Alt', 'Radial'
    ])
  })

  it('sanitizes unknown styles back to diagonal', () => {
    expect(sanitizeGradientStyle('radial')).toBe('radial')
    expect(sanitizeGradientStyle('vertical')).toBe('vertical')
    expect(sanitizeGradientStyle('junk')).toBe('diagonal')
    expect(sanitizeGradientStyle(undefined)).toBe('diagonal')
  })
})

describe('style → CSS mapping', () => {
  const g = { from: '#112233', to: '#445566' }

  it('linear styles use ANGLEdeg with per-style defaults', () => {
    expect(buildGradientCss({ ...g, style: 'diagonal' })).toBe('linear-gradient(135deg, #112233, #445566)')
    expect(buildGradientCss({ ...g, style: 'vertical' })).toBe('linear-gradient(180deg, #112233, #445566)')
    expect(buildGradientCss({ ...g, style: 'horizontal' })).toBe('linear-gradient(90deg, #112233, #445566)')
    expect(buildGradientCss({ ...g, style: 'diagonal-alt' })).toBe('linear-gradient(45deg, #112233, #445566)')
  })

  it('custom angle overrides the style default for linear shapes', () => {
    expect(buildGradientCss({ ...g, angle: 200, style: 'diagonal' }))
      .toBe('linear-gradient(200deg, #112233, #445566)')
  })

  it('radial is angle-free — any angle passed in is ignored', () => {
    expect(buildGradientCss({ ...g, angle: 200, style: 'radial' }))
      .toBe('radial-gradient(circle at 50% 40%, #112233, #445566)')
    expect(buildGradientCss({ ...g, style: 'radial' }))
      .toBe('radial-gradient(circle at 50% 40%, #112233, #445566)')
  })

  it('resolveBackground threads the selected style through both sources', () => {
    expect(resolveBackground({ themeId: 'matrix', gradientStyle: 'radial' }).style).toBe('radial')
    expect(
      resolveBackground({
        themeId: 'matrix',
        gradientStyle: 'vertical',
        customGradient: { enabled: true, from: '#ffffff', to: '#000000', angle: 77 }
      })
    ).toEqual({ enabled: true, from: '#ffffff', to: '#000000', angle: 77, style: 'vertical' })
  })
})

describe('applyBackground publishes the full image var', () => {
  let cssVars

  beforeEach(() => {
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
  })

  afterEach(() => {
    delete globalThis.document
  })

  it('writes --shell-grad-image for radial and keeps legacy vars', () => {
    applyBackground({
      themeId: 'matrix',
      customGradient: { enabled: true, from: '#aabbcc', to: '#001122', angle: 45 },
      gradientStyle: 'radial'
    })
    expect(cssVars['--shell-grad-image']).toBe('radial-gradient(circle at 50% 40%, #aabbcc, #001122)')
    expect(cssVars['--shell-grad-from']).toBe('#aabbcc')
    expect(cssVars['--shell-grad-angle']).toBe('45deg')

    applyBackground({ themeId: 'matrix', gradientStyle: 'horizontal' })
    expect(cssVars['--shell-grad-image']).toMatch(/^linear-gradient\(90deg, /)
  })
})

describe('style click re-owns its angle in custom mode (fixwave L)', () => {
  // Regression: with a custom gradient enabled, resolveBackground renders the
  // slider angle, so a dragged value (e.g. 220°) made every linear style look
  // identical — the selector appeared broken. Clicking a linear style must
  // write that style's fixed angle INTO the custom gradient.
  it('returns a full replacement gradient carrying the style angle', () => {
    const custom = { enabled: true, from: '#ff2d55', to: '#160a0e', angle: 220 }
    expect(styleGradientPatch(custom, 'vertical')).toEqual({
      enabled: true, from: '#ff2d55', to: '#160a0e', angle: 180
    })
    expect(styleGradientPatch(custom, 'horizontal')?.angle).toBe(90)
    expect(styleGradientPatch(custom, 'diagonal-alt')?.angle).toBe(45)
  })

  it('returns null when nothing beyond gradient_style needs saving', () => {
    const custom = { enabled: true, from: '#ff2d55', to: '#160a0e', angle: 220 }
    expect(styleGradientPatch(custom, 'radial')).toBeNull() // radial is angle-free
    expect(styleGradientPatch(custom, 'diagonal')).toEqual({ ...custom, angle: 135 }) // 220 → 135
    expect(styleGradientPatch({ ...custom, angle: 135 }, 'diagonal')).toBeNull() // already synced
    // Custom OFF (theme mode): theme gradients already take the style angle.
    expect(styleGradientPatch({ ...custom, enabled: false }, 'vertical')).toBeNull()
    expect(styleGradientPatch(undefined, 'vertical')).toBeNull()
    expect(styleGradientPatch({}, 'junk-style')).toBeNull()
  })

  it('patch survives sanitization and renders through buildGradientCss', () => {
    const custom = { enabled: true, from: '#ff2d55', to: '#160a0e', angle: 220 }
    const patch = styleGradientPatch(custom, 'vertical')
    expect(buildGradientCss(patch)).toBe('linear-gradient(180deg, #ff2d55, #160a0e)')
  })
})

describe('gradient_style persistence + auto-save', () => {
  it('round-trips through the config service and lands on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-grad-style-'))
    const config = createConfigService({ rootDir: root })
    config.patchConfig({ gradient_style: 'radial' })
    expect(config.getConfig().gradient_style).toBe('radial')
    const written = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'))
    expect(written.gradient_style).toBe('radial')
  })

  it('auto-saves and never rides the Save-button draft', () => {
    expect(AUTO_SAVE_KEYS).toContain('gradient_style')
    const snap = buildSnapshot({ config: { gradient_style: 'radial' } })
    expect('gradient_style' in snap).toBe(false)
    const staleDraft = { ...snap, gradient_style: 'vertical' }
    expect(diffPatch(staleDraft, snap)).toEqual({})
  })
})
