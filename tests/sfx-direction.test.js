import { describe, it, expect } from 'vitest'
import { statSoundDirection } from '../src/renderer/src/lib/sfx.js'

describe('statSoundDirection', () => {
  const base = { affection: 20, sass: 15, humor: 10 }

  it('returns null during boot when there is no previous snapshot', () => {
    expect(statSoundDirection(null, base)).toBeNull()
    expect(statSoundDirection(undefined, base)).toBeNull()
    expect(statSoundDirection(base, null)).toBeNull()
  })

  it('returns null when nothing numerically changed', () => {
    expect(statSoundDirection(base, { ...base })).toBeNull()
    // Identity change alone (same numbers) must not fire.
    expect(statSoundDirection(base, { affection: 20, sass: 15, humor: 10, extra: 'x' })).toBeNull()
  })

  it('plays statUp when any stat rose', () => {
    expect(statSoundDirection(base, { ...base, affection: 25 })).toBe('statUp')
  })

  it('plays statDown when stats only fell', () => {
    expect(statSoundDirection(base, { ...base, sass: 10, humor: 5 })).toBe('statDown')
  })

  it('prefers statUp for mixed movement', () => {
    expect(statSoundDirection(base, { ...base, sass: 0, humor: 12 })).toBe('statUp')
  })
})
