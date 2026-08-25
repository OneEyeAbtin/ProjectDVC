// Ambient particle theme registry — one behavior definition per theme
// (spawn / step / draw) so AmbientBackground can run any of them through the
// same DPR-aware, pausable rAF loop. All functions are pure enough to unit
// test: spawn creates a particle, step mutates it one dt tick, draw paints.
// Spec contract per theme: 28–40 particles (fireworks is exempt — its count
// IS the concurrent-burst cap of 3), DPR handled by the caller,
// reduced-motion paints a single static frame (draw with animate=false).

export const PARTICLE_THEME_IDS = [
  'stars', 'embers', 'snow', 'bubbles', 'sakura', 'fireflies',
  'matrix', 'rain', 'hearts', 'fireworks', 'sparkles', 'confetti',
  'constellation',
  'none'
]

// Chip-grid order shown in Settings → General → Background.
export const PARTICLE_THEME_META = [
  { id: 'stars', label: '✨ Stars' },
  { id: 'embers', label: '🔥 Embers' },
  { id: 'snow', label: '❄️ Snow' },
  { id: 'bubbles', label: '🫧 Bubbles' },
  { id: 'sakura', label: '🌸 Sakura' },
  { id: 'fireflies', label: '✨ Fireflies' },
  { id: 'matrix', label: '💻 Matrix' },
  { id: 'rain', label: '🌧️ Rain' },
  { id: 'hearts', label: '💗 Hearts' },
  { id: 'fireworks', label: '🎆 Fireworks' },
  { id: 'sparkles', label: '💫 Sparkles' },
  { id: 'confetti', label: '🎉 Confetti' },
  { id: 'constellation', label: '🕸️ Constellation' },
  { id: 'none', label: 'None' }
]

export const DEFAULT_PARTICLE_THEME = 'stars'

export function sanitizeParticleTheme(value) {
  return PARTICLE_THEME_IDS.includes(value) ? value : DEFAULT_PARTICLE_THEME
}

const rand = (min, max) => min + Math.random() * (max - min)
const TAU = Math.PI * 2

function pickColor(colors) {
  return colors[Math.floor(Math.random() * colors.length)]
}

// Shared respawn: keep the particle on canvas, wrapping across the edge its
// motion exits through.
function wrapUp(p, w, h) {
  if (p.y < -p.r - 2) {
    p.y = h + p.r + 2
    p.x = Math.random() * w
  }
}
function wrapDown(p, w, h) {
  if (p.y > h + p.r + 2) {
    p.y = -p.r - 2
    p.x = Math.random() * w
  }
}

function fillCircle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fill()
}

// ── stars ─ current behavior: slow rise, gentle wobble, twinkle, white/accent
export const STARS = {
  count: 28,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.5 + Math.random(),
      vy: rand(3, 10),
      swayAmp: rand(2, 8),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.4, 1.2),
      twinkleSpeed: rand(0.6, 2),
      twinklePhase: Math.random() * TAU
    }
  },
  step(p, dt, w, h) {
    p.y -= p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    wrapUp(p, w, h)
  },
  draw(ctx, p, t, animate, accent, isAccent) {
    ctx.globalAlpha = animate
      ? 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * p.twinkleSpeed * TAU + p.twinklePhase))
      : 0.55
    ctx.fillStyle = isAccent ? accent : '#ffffff'
    fillCircle(ctx, p.x + Math.sin(p.phase) * p.swayAmp, p.y, p.r)
  }
}

// ── embers ─ orange/red sparks, fast rise, flickering opacity, slight drift
export const EMBERS = {
  count: 34,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(1, 2.2),
      vy: rand(20, 45),
      swayAmp: rand(3, 8),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.6, 1.6),
      flickerSpeed: rand(1.5, 3.2),
      flickerPhase: Math.random() * TAU,
      color: pickColor(['#ff6b35', '#ffd60a'])
    }
  },
  step(p, dt, w, h) {
    p.y -= p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    wrapUp(p, w, h)
  },
  draw(ctx, p, t, animate) {
    const flicker = animate
      ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.flickerSpeed * TAU + p.flickerPhase))
      : 0.7
    ctx.globalAlpha = 0.85 * flicker
    ctx.fillStyle = p.color
    fillCircle(ctx, p.x + Math.sin(p.phase) * p.swayAmp, p.y, p.r)
  }
}

// ── snow ─ white, falls downward with sinusoidal sway, slow
export const SNOW = {
  count: 36,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(1, 2.5),
      vy: rand(8, 20),
      swayAmp: rand(8, 18),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.15, 0.4),
      alpha: rand(0.5, 0.9)
    }
  },
  step(p, dt, w, h) {
    p.y += p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    wrapDown(p, w, h)
  },
  draw(ctx, p, _t, animate) {
    ctx.globalAlpha = animate ? p.alpha : 0.7
    ctx.fillStyle = '#ffffff'
    fillCircle(ctx, p.x + Math.sin(p.phase) * p.swayAmp, p.y, p.r)
  }
}

// ── bubbles ─ cyan hollow circles rising with a wobble
export const BUBBLES = {
  count: 30,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(2, 5),
      vy: rand(12, 28),
      swayAmp: rand(6, 14),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.3, 0.9),
      alpha: rand(0.35, 0.7),
      lineWidth: rand(1, 1.5)
    }
  },
  step(p, dt, w, h) {
    p.y -= p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    wrapUp(p, w, h)
  },
  draw(ctx, p, _t, animate) {
    ctx.globalAlpha = animate ? p.alpha : 0.5
    ctx.strokeStyle = '#67e8f9'
    ctx.lineWidth = p.lineWidth
    ctx.beginPath()
    ctx.arc(p.x + Math.sin(p.phase) * p.swayAmp, p.y, p.r, 0, TAU)
    ctx.stroke()
  }
}

// ── sakura ─ pink petals falling with sway + rotation (rotated ellipses)
export const SAKURA = {
  count: 32,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(2.2, 4),
      vy: rand(10, 22),
      swayAmp: rand(10, 22),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.2, 0.5),
      rot: Math.random() * TAU,
      rotSpeed: rand(-1, 1),
      color: pickColor(['#ff6b9d', '#ffb3d1']),
      alpha: rand(0.6, 0.95)
    }
  },
  step(p, dt, w, h) {
    p.y += p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    p.rot += p.rotSpeed * dt
    wrapDown(p, w, h)
  },
  draw(ctx, p, _t, animate) {
    ctx.globalAlpha = animate ? p.alpha : 0.75
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.ellipse(
      p.x + Math.sin(p.phase) * p.swayAmp,
      p.y,
      p.r,
      p.r * 0.55,
      p.rot,
      0,
      TAU
    )
    ctx.fill()
  }
}

// ── fireflies ─ yellow-green dots, slow random-walk wander, pulsing glow
export const FIREFLIES = {
  count: 28,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(1.2, 2.2),
      speed: rand(4, 12),
      heading: Math.random() * TAU,
      turnJitter: rand(1.5, 3),
      pulseSpeed: rand(0.3, 0.8),
      pulsePhase: Math.random() * TAU
    }
  },
  step(p, dt, w, h) {
    p.heading += (Math.random() - 0.5) * 2 * p.turnJitter * dt
    p.x = (p.x + Math.cos(p.heading) * p.speed * dt + w) % w
    p.y = (p.y + Math.sin(p.heading) * p.speed * dt + h) % h
  },
  draw(ctx, p, t, animate) {
    const pulse = animate
      ? 0.5 + 0.5 * Math.sin(t * p.pulseSpeed * TAU + p.pulsePhase)
      : 0.5
    // Halo first (soft glow), then the bright core.
    ctx.globalAlpha = 0.08 + 0.3 * pulse
    ctx.fillStyle = '#d4ff5e'
    fillCircle(ctx, p.x, p.y, p.r * 3)
    ctx.globalAlpha = 0.35 + 0.6 * pulse
    fillCircle(ctx, p.x, p.y, p.r)
  }
}

// ── matrix ─ green glyph columns: thin vertical streaks of small rects
// falling at varying speeds; the head cell is brightest, the trail fades.
export const MATRIX = {
  count: 32,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vy: rand(30, 90),
      cells: Math.floor(rand(4, 10)),
      cellH: rand(5, 9),
      flickerSpeed: rand(1.5, 5),
      flickerPhase: Math.random() * TAU
    }
  },
  step(p, dt, w, h) {
    p.y += p.vy * dt
    p.flickerPhase += p.flickerSpeed * dt * TAU
    // Tight trigger + shallow reset keep the column head inside the ±12px
    // test margin even at max speed (90px/s ≈ 1.5px per 60fps tick).
    if (p.y > h + 4) {
      p.y = -4
      p.x = Math.random() * w
    }
  },
  draw(ctx, p, _t, animate) {
    const flicker = animate
      ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(p.flickerPhase))
      : 0.75
    ctx.fillStyle = '#00ff41'
    for (let i = 0; i < p.cells; i++) {
      const fade = 1 - i / p.cells
      ctx.globalAlpha = (i === 0 ? 0.95 : 0.15 + 0.65 * fade) * flicker
      ctx.fillRect(p.x, p.y - i * p.cellH, 2, p.cellH * 0.62)
    }
  }
}

// ── rain ─ pale blue fast streaks with slight wind; 1px diagonal lines
export const RAIN = {
  count: 38,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vy: rand(320, 520),
      wind: rand(40, 80),
      len: rand(8, 14),
      alpha: rand(0.35, 0.7)
    }
  },
  step(p, dt, w, h) {
    p.x += p.wind * dt
    p.y += p.vy * dt
    // Overshoot-safe wraps (max step ≈ 8.7px/tick): trigger early, respawn
    // shallow so particles never leave the ±12px test margin.
    if (p.y > h + 2) {
      p.y = -(p.len - 2)
      p.x = Math.random() * w
    }
    if (p.x > w + 2) p.x = -2
  },
  draw(ctx, p, _t, animate) {
    ctx.globalAlpha = animate ? p.alpha : 0.5
    ctx.strokeStyle = '#7dd3fc'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - (p.wind / p.vy) * p.len, p.y - p.len)
    ctx.stroke()
  }
}

// ── hearts ─ pink hearts rising slowly with sway (bezier heart, rotated)
function heartPath(ctx, s) {
  ctx.beginPath()
  ctx.moveTo(0, s)
  ctx.bezierCurveTo(-s * 1.2, s * 0.3, -s * 1.05, -s * 0.95, 0, -s * 0.35)
  ctx.bezierCurveTo(s * 1.05, -s * 0.95, s * 1.2, s * 0.3, 0, s)
  ctx.closePath()
}

export const HEARTS = {
  count: 28,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(2.5, 4.5),
      vy: rand(10, 22),
      swayAmp: rand(6, 16),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.2, 0.6),
      rot: rand(-0.35, 0.35),
      alpha: rand(0.55, 0.9)
    }
  },
  step(p, dt, w, h) {
    p.y -= p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    wrapUp(p, w, h)
  },
  draw(ctx, p, _t, animate) {
    ctx.save()
    ctx.translate(p.x + Math.sin(p.phase) * p.swayAmp, p.y)
    ctx.rotate(p.rot)
    ctx.globalAlpha = animate ? p.alpha : 0.7
    ctx.fillStyle = '#ff6b9d'
    heartPath(ctx, p.r)
    ctx.fill()
    ctx.restore()
  }
}

// ── fireworks ─ rare radial bursts with gravity + fade. Each "particle" IS
// one burst (20–26 precomputed sparks); count = concurrent-burst cap of 3.
// Cycles stagger via a dead-time delay so bursts land every ~2-4s.
const FIREWORK_COLORS = ['#ff6b9d', '#ffd60a', '#00d4ff', '#4ade80', '#c084fc']
const FIREWORK_GRAVITY = 60

function makeSparks() {
  return Array.from({ length: 20 + Math.floor(Math.random() * 7) }, () => ({
    ang: Math.random() * TAU,
    spd: rand(20, 70),
    size: rand(1, 2.2),
    color: pickColor(FIREWORK_COLORS)
  }))
}

function resetBurst(p, w, h) {
  p.x = rand(w * 0.15, w * 0.85)
  p.y = rand(h * 0.15, h * 0.6)
  p.age = 0
  p.duration = rand(1.1, 1.6)
  p.delay = rand(0.8, 2.2)
  p.sparks = makeSparks()
}

export const FIREWORKS = {
  count: 3, // concurrent bursts on screen at once (spec cap)
  makeSparks,
  spawn(w, h) {
    const burst = { sparks: [] }
    resetBurst(burst, w, h)
    return burst
  },
  step(p, dt, w, h) {
    if (p.delay > 0) {
      p.delay -= dt
      return
    }
    p.age += dt
    if (p.age >= p.duration) resetBurst(p, w, h)
  },
  draw(ctx, p, _t, animate) {
    // Static reduced-motion frame: every burst painted mid-flight so the
    // single frame is never empty.
    const age = animate ? p.age : p.duration * 0.4
    if (animate && (p.delay > 0 || age >= p.duration)) return
    const life = 1 - age / p.duration
    const drop = FIREWORK_GRAVITY * age * age
    for (const s of p.sparks) {
      ctx.globalAlpha = Math.max(0, life) * 0.9
      ctx.fillStyle = s.color
      fillCircle(
        ctx,
        p.x + Math.cos(s.ang) * s.spd * age,
        p.y + Math.sin(s.ang) * s.spd * age + drop,
        s.size * (0.5 + 0.5 * life)
      )
    }
  }
}

// ── sparkles ─ 4-point stars twinkling IN PLACE (opacity pulse, tiny spin)
export const SPARKLES = {
  count: 30,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(1.5, 3.2),
      twinkleSpeed: rand(0.8, 2.2),
      twinklePhase: Math.random() * TAU,
      rot: Math.random() * TAU,
      rotSpeed: rand(-0.5, 0.5)
    }
  },
  step(p, dt) {
    p.rot += p.rotSpeed * dt
  },
  draw(ctx, p, t, animate, accent, isAccent) {
    const pulse = animate
      ? 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * p.twinkleSpeed * TAU + p.twinklePhase))
      : 0.6
    ctx.globalAlpha = pulse
    ctx.fillStyle = isAccent ? accent : '#ffffff'
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.rot)
    const r = p.r
    ctx.beginPath()
    ctx.moveTo(0, -r * 2)
    ctx.lineTo(r * 0.35, -r * 0.35)
    ctx.lineTo(r * 2, 0)
    ctx.lineTo(r * 0.35, r * 0.35)
    ctx.lineTo(0, r * 2)
    ctx.lineTo(-r * 0.35, r * 0.35)
    ctx.lineTo(-r * 2, 0)
    ctx.lineTo(-r * 0.35, -r * 0.35)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

// ── confetti ─ multicolor small rects falling with tumbling rotation + sway
const CONFETTI_COLORS = ['#ff6b9d', '#ffd60a', '#00d4ff', '#4ade80', '#c084fc', '#ff8c42']

export const CONFETTI = {
  count: 36,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(1.6, 3),
      vy: rand(18, 40),
      swayAmp: rand(6, 16),
      phase: Math.random() * TAU,
      phaseSpeed: rand(0.2, 0.6),
      rot: Math.random() * TAU,
      rotSpeed: rand(-3, 3),
      tumbleSpeed: rand(2, 5),
      tumble: Math.random() * TAU,
      color: pickColor(CONFETTI_COLORS),
      alpha: rand(0.7, 0.95)
    }
  },
  step(p, dt, w, h) {
    p.y += p.vy * dt
    p.phase += p.phaseSpeed * dt * TAU
    p.rot += p.rotSpeed * dt
    p.tumble += p.tumbleSpeed * dt * TAU
    wrapDown(p, w, h)
  },
  draw(ctx, p, _t, animate) {
    ctx.save()
    ctx.translate(p.x + Math.sin(p.phase) * p.swayAmp, p.y)
    ctx.rotate(p.rot)
    // Squash on Y by cos(tumble): the rect flips over as it falls.
    ctx.scale(1, Math.cos(p.tumble))
    ctx.globalAlpha = animate ? p.alpha : 0.8
    ctx.fillStyle = p.color
    ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2)
    ctx.restore()
  }
}

// ── constellation ─ drifting dots joined by faint lines when close together
// (O(n²) pair check is fine at n ≤ 36). The optional `link` hook runs before
// the per-particle draw pass so lines sit under the dots.
export const CONSTELLATION_LINK_DIST = 90

// Pure pair counter: how many unordered pairs are within `threshold` px.
export function countLinks(points, threshold) {
  const pts = Array.isArray(points) ? points : []
  let count = 0
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x
      const dy = pts[i].y - pts[j].y
      if (dx * dx + dy * dy <= threshold * threshold) count++
    }
  }
  return count
}

export const CONSTELLATION = {
  count: 32,
  spawn(w, h) {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(1.5, 2),
      vx: rand(-6, 6),
      vy: rand(-6, 6)
    }
  },
  step(p, dt, w, h) {
    // Gentle drift with modulo wrap on BOTH edges — a star leaving the right
    // side re-enters from the left, keeping the web fully populated.
    p.x = (((p.x + p.vx * dt) % w) + w) % w
    p.y = (((p.y + p.vy * dt) % h) + h) % h
  },
  link(ctx, particles, _t, animate, accent) {
    if (!animate) return undefined
    ctx.lineWidth = 1
    ctx.strokeStyle = accent
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x
        const dy = particles[i].y - particles[j].y
        const d2 = dx * dx + dy * dy
        if (d2 > CONSTELLATION_LINK_DIST * CONSTELLATION_LINK_DIST) continue
        // Alpha fades with distance: tight pairs glow, far pairs vanish.
        ctx.globalAlpha = (1 - Math.sqrt(d2) / CONSTELLATION_LINK_DIST) * 0.4
        ctx.beginPath()
        ctx.moveTo(particles[i].x, particles[i].y)
        ctx.lineTo(particles[j].x, particles[j].y)
        ctx.stroke()
      }
    }
    return undefined
  },
  draw(ctx, p, _t, animate, accent, isAccent) {
    ctx.globalAlpha = animate ? 0.7 : 0.55
    ctx.fillStyle = isAccent ? accent : '#ffffff'
    fillCircle(ctx, p.x, p.y, p.r)
  }
}

export const PARTICLE_THEMES = {
  stars: STARS,
  embers: EMBERS,
  snow: SNOW,
  bubbles: BUBBLES,
  sakura: SAKURA,
  fireflies: FIREFLIES,
  matrix: MATRIX,
  rain: RAIN,
  hearts: HEARTS,
  fireworks: FIREWORKS,
  sparkles: SPARKLES,
  confetti: CONFETTI,
  constellation: CONSTELLATION
}

export function resolveParticleTheme(id) {
  return PARTICLE_THEMES[sanitizeParticleTheme(id)] ?? STARS
}
