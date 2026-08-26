import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ANIMATION_SPEED_DEFAULT,
  ANIMATION_SPEED_MAX,
  ANIMATION_SPEED_MIN,
  applySpeed,
  sanitizeAnimationSpeed
} from '../src/renderer/src/features/ambient/animationSpeed.js'
import { PARTICLE_THEMES } from '../src/renderer/src/features/ambient/particleThemes.js'
import { DEFAULTS, SETTINGS_KEYS } from '../src/main/data/defaults.js'
import { AUTO_SAVE_KEYS } from '../src/renderer/src/features/settings/liveSettings.js'
import { buildSnapshot, diffPatch } from '../src/renderer/src/features/settings/settingsDraft.js'
import { createConfigService } from '../src/main/services/config.service.js'

describe('animation speed sanitizer', () => {
  it('keeps in-range values and clamps the extremes', () => {
    expect(sanitizeAnimationSpeed(1)).toBe(1)
    expect(sanitizeAnimationSpeed(2.5)).toBe(2.5)
    expect(sanitizeAnimationSpeed(0.1)).toBe(ANIMATION_SPEED_MIN)
    expect(sanitizeAnimationSpeed(99)).toBe(ANIMATION_SPEED_MAX)
    expect(ANIMATION_SPEED_MIN).toBe(0.25)
    expect(ANIMATION_SPEED_MAX).toBe(3)
  })

  it('garbage falls back to 1×', () => {
    expect(sanitizeAnimationSpeed('junk')).toBe(1)
    expect(sanitizeAnimationSpeed(NaN)).toBe(1)
    expect(sanitizeAnimationSpeed(undefined)).toBe(ANIMATION_SPEED_DEFAULT)
    expect(ANIMATION_SPEED_DEFAULT).toBe(1)
  })
})

describe('speed multiplier scales per-frame motion', () => {
  it('position delta scales linearly with the multiplier', () => {
    const a = PARTICLE_THEMES.stars.spawn(400, 600)
    const b = { ...a }
    const startY = a.y
    const dt = 1 / 60
    PARTICLE_THEMES.stars.step(a, applySpeed(dt, 1), 400, 600)
    PARTICLE_THEMES.stars.step(b, applySpeed(dt, 3), 400, 600)
    // b travelled exactly 3× as far as a.
    expect(startY - b.y).toBeCloseTo((startY - a.y) * 3, 9)
    expect(startY - a.y).toBeGreaterThan(0)
  })

  it('applySpeed is a pure multiplication with sanitization', () => {
    expect(applySpeed(0.5, 2)).toBe(1)
    expect(applySpeed(0.5, 'junk')).toBe(0.5) // garbage speed → 1×
    expect(applySpeed(1, 0.1)).toBe(0.25) // clamped to min
  })

  it('progress-type sims (fireworks age) scale too — same dt path', () => {
    const burst = PARTICLE_THEMES.fireworks.spawn(400, 600)
    burst.delay = 0 // skip the staggered dead-time
    PARTICLE_THEMES.fireworks.step(burst, applySpeed(0.4, 2), 400, 600)
    expect(burst.age).toBeCloseTo(0.8, 9) // aged 0.8s in 0.4 real seconds
  })

  // Regression (fixwave L): stars/embers/fireflies/sparkles used to compute
  // pulse/twinkle alpha from ABSOLUTE time in draw(), so the slider scaled
  // movement but never the pulsing. Every pulse phase must accumulate
  // through step()'s dt path so speed scales the whole visual.
  it('pulse phases accumulate via dt, not absolute draw time', () => {
    const cases = [
      ['stars', 'twPhase', 'twinkleSpeed'],
      ['embers', 'flickPhase', 'flickerSpeed'],
      ['fireflies', 'pulsePhase', 'pulseSpeed'],
      ['sparkles', 'twPhase', 'twinkleSpeed']
    ]
    for (const [id, phaseField, rateField] of cases) {
      const def = PARTICLE_THEMES[id]
      const a = def.spawn(400, 600)
      const b = { ...a }
      const before = a[phaseField]
      const dt = 0.5
      def.step(a, applySpeed(dt, 1), 400, 600)
      expect(a[phaseField], `${id} advances`).toBeCloseTo(before + a[rateField] * dt * Math.PI * 2, 9)

      const beforeB = b[phaseField]
      def.step(b, applySpeed(dt, 3), 400, 600)
      const slow = a[phaseField] - before
      const fast = b[phaseField] - beforeB
      expect(fast, `${id} 3× scaling`).toBeCloseTo(slow * 3, 9)
    }
  })
})

describe('setting persistence', () => {
  it('ships in DEFAULTS + SETTINGS_KEYS', () => {
    expect(DEFAULTS.animation_speed).toBe(1)
    expect(SETTINGS_KEYS).toContain('animation_speed')
  })

  it('round-trips through the config service and lands on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-anim-speed-'))
    const config = createConfigService({ rootDir: root })
    config.patchConfig({ animation_speed: 1.75 })
    expect(config.getConfig().animation_speed).toBe(1.75)
    const written = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'))
    expect(written.animation_speed).toBe(1.75)
  })
})

describe('auto-save integration', () => {
  it('animation_speed auto-saves (and never rides the Save-button draft)', () => {
    expect(AUTO_SAVE_KEYS).toContain('animation_speed')
    const snap = buildSnapshot({ config: { animation_speed: 2 } })
    expect('animation_speed' in snap).toBe(false)
    const staleDraft = { ...snap, animation_speed: 3 }
    expect(diffPatch(staleDraft, snap)).toEqual({})
  })
})
