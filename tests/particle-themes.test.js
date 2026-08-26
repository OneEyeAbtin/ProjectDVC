import { describe, it, expect } from 'vitest'
import {
  CONSTELLATION_LINK_DIST,
  CONSTELLATION_MAX_LINKS,
  collectLinks,
  countLinks,
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
  it('exposes the thirteen selectable themes plus None', () => {
    expect(PARTICLE_THEME_IDS).toEqual([
      'stars', 'embers', 'snow', 'bubbles', 'sakura', 'fireflies',
      'matrix', 'rain', 'hearts', 'fireworks', 'sparkles', 'confetti',
      'constellation',
      'none'
    ])
    expect(PARTICLE_THEME_META.map((t) => t.id)).toEqual(PARTICLE_THEME_IDS)
    // Every chip reads as emoji + label.
    for (const t of PARTICLE_THEME_META) {
      expect(t.label.length, t.id).toBeGreaterThan(1)
    }
    // 'none' is UI-only: it suppresses the loop, so no behavior entry exists.
    expect('none' in PARTICLE_THEMES).toBe(false)
    expect(Object.keys(PARTICLE_THEMES)).toHaveLength(13)
  })

  it('sanitize falls back to stars for unknown/garbage values', () => {
    expect(sanitizeParticleTheme('snow')).toBe('snow')
    expect(sanitizeParticleTheme('Sakura')).toBe('stars') // case-sensitive ids
    expect(sanitizeParticleTheme('matrix')).toBe('matrix')
    expect(sanitizeParticleTheme('confetti')).toBe('confetti')
    expect(sanitizeParticleTheme('junk-theme')).toBe('stars')
    expect(sanitizeParticleTheme(undefined)).toBe(DEFAULT_PARTICLE_THEME)
    expect(resolveParticleTheme('nope')).toBe(PARTICLE_THEMES.stars)
  })

  it('keeps every theme inside the spec particle budget of 28-40', () => {
    for (const [id, def] of Object.entries(PARTICLE_THEMES)) {
      if (id === 'fireworks') continue // exempt: count IS the burst cap
      expect(def.count, id).toBeGreaterThanOrEqual(28)
      expect(def.count, id).toBeLessThanOrEqual(40)
    }
  })

  it('fireworks: bursts capped at 3 concurrent with 20-26 sparks each', () => {
    expect(PARTICLE_THEMES.fireworks.count).toBe(3)
    const burst = PARTICLE_THEMES.fireworks.spawn(W, H)
    expect(burst.sparks.length).toBeGreaterThanOrEqual(20)
    expect(burst.sparks.length).toBeLessThanOrEqual(26)
    // Regenerated spark sets stay in the same band across many draws.
    for (let i = 0; i < 50; i++) {
      const sparks = PARTICLE_THEMES.fireworks.makeSparks()
      expect(sparks.length).toBeGreaterThanOrEqual(20)
      expect(sparks.length).toBeLessThanOrEqual(26)
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

    // Mid-canvas starts so a single large dt tick cannot hit an edge wrap.
    const glyphs = PARTICLE_THEMES.matrix.spawn(W, H)
    glyphs.y = H / 2
    const yGlyphs = glyphs.y
    PARTICLE_THEMES.matrix.step(glyphs, dt, W, H)
    expect(glyphs.y).toBeGreaterThan(yGlyphs) // matrix columns fall

    const drop = PARTICLE_THEMES.rain.spawn(W, H)
    drop.x = W / 2
    drop.y = H / 2
    const [xRain, yRain] = [drop.x, drop.y]
    PARTICLE_THEMES.rain.step(drop, dt, W, H)
    expect(drop.y).toBeGreaterThan(yRain) // rain falls…
    expect(drop.y - yRain).toBeGreaterThan(drop.x - xRain) // …much faster than the wind drifts

    const heart = PARTICLE_THEMES.hearts.spawn(W, H)
    heart.y = H / 2
    const yHeart = heart.y
    PARTICLE_THEMES.hearts.step(heart, dt, W, H)
    expect(heart.y).toBeLessThan(yHeart) // hearts rise

    const sparkle = PARTICLE_THEMES.sparkles.spawn(W, H)
    const [xSparkle, ySparkle, rotSparkle] = [sparkle.x, sparkle.y, sparkle.rot]
    PARTICLE_THEMES.sparkles.step(sparkle, dt, W, H)
    expect(sparkle.x).toBe(xSparkle) // sparkles twinkle IN PLACE…
    expect(sparkle.y).toBe(ySparkle)
    expect(sparkle.rot).not.toBe(rotSparkle) // …with only a tiny spin

    const piece = PARTICLE_THEMES.confetti.spawn(W, H)
    piece.y = H / 2
    const [yPiece, rotPiece] = [piece.y, piece.rot]
    PARTICLE_THEMES.confetti.step(piece, dt, W, H)
    expect(piece.y).toBeGreaterThan(yPiece) // confetti falls…
    expect(piece.rot).not.toBe(rotPiece) // …while tumbling

    const burst = PARTICLE_THEMES.fireworks.spawn(W, H)
    burst.delay = 0
    PARTICLE_THEMES.fireworks.step(burst, dt, W, H)
    expect(burst.age).toBeGreaterThan(0) // bursts burn through a life cycle
    const ageBeforeReset = burst.age
    burst.age = burst.duration
    PARTICLE_THEMES.fireworks.step(burst, dt, W, H)
    expect(burst.age).toBeLessThan(ageBeforeReset) // …then respawn at age 0

    const node = PARTICLE_THEMES.constellation.spawn(W, H)
    const [xNode, yNode] = [node.x, node.y]
    PARTICLE_THEMES.constellation.step(node, dt, W, H)
    // Dots drift (positions genuinely change)…
    expect(node.x).not.toBe(xNode)
    expect(node.y).not.toBe(yNode)
    // …slowly: max speed 6px/s per axis ⇒ a single 0.5s tick moves ≤ ~4.3px.
    expect(Math.hypot(node.x - xNode, node.y - yNode)).toBeLessThan(4.5)
  })
})

describe('constellation link counting', () => {
  it('counts only pairs within the threshold', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },   // within 90 of p0 → pair
      { x: 100, y: 0 },  // within 90 of p1, NOT of p0 → pair
      { x: 400, y: 400 } // far from everyone → no pairs
    ]
    expect(countLinks(points, CONSTELLATION_LINK_DIST)).toBe(2)
  })

  it('treats the threshold as inclusive and handles degenerate inputs', () => {
    const a = { x: 10, y: 10 }
    const b = { x: 10 + CONSTELLATION_LINK_DIST, y: 10 } // exactly 90 apart
    expect(countLinks([a, b], CONSTELLATION_LINK_DIST)).toBe(1)
    expect(countLinks([a], CONSTELLATION_LINK_DIST)).toBe(0)
    expect(countLinks([], 90)).toBe(0)
    expect(countLinks(undefined, 90)).toBe(0)
  })

  it('scales with density: clustered points form a complete graph', () => {
    const cluster = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 }
    ]
    expect(countLinks(cluster, CONSTELLATION_LINK_DIST)).toBe(6) // C(4,2)
    // Tightening the rope drops the two ~14px diagonals but keeps the four
    // 10px edges.
    expect(countLinks(cluster, 12)).toBe(4)
    expect(countLinks(cluster, 5)).toBe(0)
  })
})

describe('collectLinks (batched link pass)', () => {
  it('finds exactly the pairs countLinks finds — random clouds agree', () => {
    for (let trial = 0; trial < 20; trial++) {
      const pts = Array.from({ length: 40 }, () => ({
        x: Math.random() * 800,
        y: Math.random() * 600
      }))
      const segs = collectLinks(pts, CONSTELLATION_LINK_DIST)
      expect(segs, `trial ${trial}`).not.toBeNull()
      expect(segs.length).toBe(countLinks(pts, CONSTELLATION_LINK_DIST))
      for (const s of segs) {
        expect(s[4]).toBeLessThanOrEqual(CONSTELLATION_LINK_DIST)
      }
    }
  })

  it('x-sort early-out never misses Y-close but X-far pairs', () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 400, y: 102 }, // close in Y, far in X → NOT a link
      { x: 60, y: 100 }   // within 90 of p0 → link
    ]
    const segs = collectLinks(pts, CONSTELLATION_LINK_DIST)
    expect(segs.length).toBe(1)
    expect(segs[0].slice(0, 4)).toEqual([0, 100, 60, 100])
  })

  it('returns null once the pair count exceeds max (hairball bail-out)', () => {
    const cluster = Array.from({ length: 32 }, (_, i) => ({ x: i % 6 * 5, y: Math.floor(i / 6) * 5 }))
    expect(countLinks(cluster, CONSTELLATION_LINK_DIST)).toBeGreaterThan(CONSTELLATION_MAX_LINKS)
    expect(collectLinks(cluster, CONSTELLATION_LINK_DIST)).toBeNull()
    expect(collectLinks(cluster, CONSTELLATION_LINK_DIST, countLinks(cluster, CONSTELLATION_LINK_DIST)))
      .not.toBeNull()
  })

  it('handles degenerate inputs like countLinks', () => {
    expect(collectLinks([], CONSTELLATION_LINK_DIST)).toEqual([])
    expect(collectLinks([{ x: 5, y: 5 }], CONSTELLATION_LINK_DIST)).toEqual([])
    expect(collectLinks(undefined, CONSTELLATION_LINK_DIST)).toEqual([])
    expect(collectLinks([{ x: 0, y: 0 }, { x: 10, y: 0 }], -1)).toEqual([])
  })
})
