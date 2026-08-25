import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PARTICLE_THEME,
  PARTICLE_THEMES,
  PARTICLE_THEME_IDS,
  PARTICLE_THEME_META,
  resolveParticleTheme,
  sanitizeParticleTheme
} from '../src/renderer/src/features/ambient/particleThemes.js'

const W = 400
const H = 600
// Generous margin: wrapping respawns a few px outside an edge by design.
const EDGE_MARGIN = 12

describe('particle theme registry', () => {
  it('exposes the seven selectable themes including None', () => {
    expect(PARTICLE_THEME_IDS).toEqual([
      'stars', 'embers', 'snow', 'bubbles', 'sakura', 'fireflies', 'none'
    ])
    expect(PARTICLE_THEME_META.map((t) => t.id)).toEqual(PARTICLE_THEME_IDS)
    // 'none' is UI-only: it suppresses the loop, so no behavior entry exists.
    expect('none' in PARTICLE_THEMES).toBe(false)
  })

  it('sanitize falls back to stars for unknown/garbage values', () => {
    expect(sanitizeParticleTheme('snow')).toBe('snow')
    expect(sanitizeParticleTheme('Sakura')).toBe('stars') // case-sensitive ids
    expect(sanitizeParticleTheme('confetti')).toBe('stars')
    expect(sanitizeParticleTheme(undefined)).toBe(DEFAULT_PARTICLE_THEME)
    expect(resolveParticleTheme('junk')).toBe(PARTICLE_THEMES.stars)
  })

  it('keeps every theme inside the spec particle budget of 28-40', () => {
    for (const [id, def] of Object.entries(PARTICLE_THEMES)) {
      expect(def.count, id).toBeGreaterThanOrEqual(28)
      expect(def.count, id).toBeLessThanOrEqual(40)
    }
  })

  it('spawns particles fully inside the canvas', () => {
    for (const [id, def] of Object.entries(PARTICLE_THEMES)) {
      const p = def.spawn(W, H)
      expect(p.x, id).toBeGreaterThanOrEqual(0)
      expect(p.x, id).toBeLessThanOrEqual(W)
      expect(p.y, id).toBeGreaterThanOrEqual(0)
      expect(p.y, id).toBeLessThanOrEqual(H)
    }
  })

  it('step wraps particles back into frame instead of leaking them off-screen', () => {
    const dt = 1 / 60
    for (const [id, def] of Object.entries(PARTICLE_THEMES)) {
      const particles = Array.from({ length: def.count }, () => def.spawn(W, H))
      // Long enough that even the fastest particle crosses an edge several times.
      for (let tick = 0; tick < 60 * 120; tick++) {
        for (const p of particles) def.step(p, dt, W, H)
      }
      for (const p of particles) {
        expect(p.x, `${id} x`).toBeGreaterThanOrEqual(-EDGE_MARGIN)
        expect(p.x, `${id} x`).toBeLessThanOrEqual(W + EDGE_MARGIN)
        expect(p.y, `${id} y`).toBeGreaterThanOrEqual(-EDGE_MARGIN)
        expect(p.y, `${id} y`).toBeLessThanOrEqual(H + EDGE_MARGIN)
      }
    }
  })

  it('themes move in their signature directions (rise vs fall)', () => {
    const dt = 0.5
    const risen = PARTICLE_THEMES.stars.spawn(W, H)
    const yStars = risen.y
    PARTICLE_THEMES.stars.step(risen, dt, W, H)
    expect(risen.y).toBeLessThan(yStars) // stars rise

    const fallen = PARTICLE_THEMES.snow.spawn(W, H)
    const ySnow = fallen.y
    PARTICLE_THEMES.snow.step(fallen, dt, W, H)
    expect(fallen.y).toBeGreaterThan(ySnow) // snow falls

    const petal = PARTICLE_THEMES.sakura.spawn(W, H)
    petal.y = H / 2
    const rotBefore = petal.rot
    PARTICLE_THEMES.sakura.step(petal, 0.5, W, H)
    expect(petal.y).toBeGreaterThan(H / 2) // sakura falls
    expect(petal.rot).not.toBe(rotBefore) // …while rotating

    const fly = PARTICLE_THEMES.fireflies.spawn(W, H)
    fly.heading = Math.PI / 2 // straight down
    // One 60fps tick: the random-walk jitter is bounded per-tick, so the
    // heading may drift only slightly (max turnJitter · dt = 3/60 rad).
    PARTICLE_THEMES.fireflies.step(fly, 1 / 60, W, H)
    expect(Math.abs(fly.heading - Math.PI / 2)).toBeLessThan(0.1)
    // …but over a second of ticks it genuinely wanders.
    const startHeading = fly.heading
    for (let i = 0; i < 60; i++) PARTICLE_THEMES.fireflies.step(fly, 1 / 60, W, H)
    expect(fly.heading).not.toBeCloseTo(startHeading, 5)
  })
})
