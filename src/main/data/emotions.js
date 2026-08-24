import { DEFAULTS } from './defaults.js'

// Single source of truth for the emotion tiers. 'talking'/'fullbody' are
// render-only states (lip-sync / full-body art) — never persisted as
// last_emotion and never accepted as persistent LLM tags.
export const TRANSIENT_EMOTIONS = ['talking', 'fullbody']

export const PERSISTENT_EMOTIONS = DEFAULTS.emotions.filter(
  (e) => !TRANSIENT_EMOTIONS.includes(e)
)

// Cheat-code forceable set: every persistent emotion + the transient states.
export const FORCEABLE_EMOTIONS = [...new Set([...DEFAULTS.emotions, ...TRANSIENT_EMOTIONS])]
