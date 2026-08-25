// Animation-speed setting (Settings → General → Background): multiplies the
// per-frame progress of ambient motion. Particle sims scale dt; the aurora
// orbs read --ambient-speed from CSS (duration = base / speed). Pure module
// so the slider, the sim loop and tests share one contract.

export const ANIMATION_SPEED_MIN = 0.25
export const ANIMATION_SPEED_MAX = 3
export const ANIMATION_SPEED_STEP = 0.25
export const ANIMATION_SPEED_DEFAULT = 1

// Config files are user-editable JSON — never trust shape/range blindly.
// Non-finite garbage falls back to 1×; finite values clamp into range.
export function sanitizeAnimationSpeed(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ANIMATION_SPEED_DEFAULT
  return Math.min(ANIMATION_SPEED_MAX, Math.max(ANIMATION_SPEED_MIN, n))
}

// One clean multiplication point: AmbientBackground passes every sim tick's
// dt through this, so velocity AND progress scale together.
export function applySpeed(dt, speed) {
  const base = Number(dt)
  if (!Number.isFinite(base)) return base
  return base * sanitizeAnimationSpeed(speed)
}
