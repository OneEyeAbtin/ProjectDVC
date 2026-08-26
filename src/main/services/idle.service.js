import { IDLE_LINES } from '../data/personas.js'

export const IDLE_MIN_MINUTES = 8
export const IDLE_MAX_MINUTES = 14
// Covers the thinking/typing window: brain chat timeout is 30s, so any reply
// still in flight keeps lastActivity fresh enough to suppress a fire.
export const IDLE_BUSY_GRACE_MS = 45000

export function randomIdleDelayMs(rand) {
  const r = typeof rand === 'function' ? rand : Math.random
  const minutes = IDLE_MIN_MINUTES + r() * (IDLE_MAX_MINUTES - IDLE_MIN_MINUTES)
  return Math.round(minutes * 60 * 1000)
}

// Returns one entry from the pool (IDLE_LINES entries are {text, emotion});
// an empty pool yields '' so callers can no-op defensively.
export function pickIdleLine(lines = IDLE_LINES, rand) {
  if (!Array.isArray(lines) || lines.length === 0) return ''
  const r = typeof rand === 'function' ? rand : Math.random
  return lines[Math.floor(r() * lines.length)]
}

// Self-rescheduling idle timer. `fire` runs only when chatter is enabled and
// the companion has been inactive past the grace window; every user message
// calls reset(), which restarts the countdown.
export function createIdleService({ getEnabled, getLastActivity, fire, rand = Math.random }) {
  let timer = null

  function clear() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    clear()
    timer = setTimeout(() => {
      timer = null
      const activeMsAgo = Date.now() - (getLastActivity?.() ?? 0)
      if (!getEnabled?.() || activeMsAgo < IDLE_BUSY_GRACE_MS) {
        schedule()
        return
      }
      try {
        fire?.()
      } finally {
        schedule()
      }
    }, randomIdleDelayMs(rand))
  }

  return { schedule, reset: schedule, stop: clear }
}
