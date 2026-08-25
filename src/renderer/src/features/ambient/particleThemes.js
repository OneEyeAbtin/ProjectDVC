// Ambient particle theme registry — one behavior definition per theme
// (spawn / step / draw) so AmbientBackground can run any of them through the
// same DPR-aware, pausable rAF loop. All functions are pure enough to unit
// test: spawn creates a particle, step mutates it one dt tick, draw paints.
// Spec contract per theme: 28–40 particles, DPR handled by the caller,
// reduced-motion paints a single static frame (draw with animate=false).

export const PARTICLE_THEME_IDS = ['stars', 'embers', 'snow', 'bubbles', 'sakura', 'fireflies', 'none']

// Chip-grid order shown in Settings → General → Background.
export const PARTICLE_THEME_META = [
  { id: 'stars', label: '✨ Stars' },
  { id: 'embers', label: '🔥 Embers' },
  { id: 'snow', label: '❄️ Snow' },
  { id: 'bubbles', label: '🫧 Bubbles' },
  { id: 'sakura', label: '🌸 Sakura' },
  { id: 'fireflies', label: '✨ Fireflies' },
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

export const PARTICLE_THEMES = {
  stars: STARS,
  embers: EMBERS,
  snow: SNOW,
  bubbles: BUBBLES,
  sakura: SAKURA,
  fireflies: FIREFLIES
}

export function resolveParticleTheme(id) {
  return PARTICLE_THEMES[sanitizeParticleTheme(id)] ?? STARS
}
