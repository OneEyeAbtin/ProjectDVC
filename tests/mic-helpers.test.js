import { describe, it, expect } from 'vitest'
import { pickMimeType, levelToSegments, MIME_CANDIDATES, SEGMENT_COUNT } from '../src/renderer/src/features/voice/micHelpers.js'

describe('pickMimeType', () => {
  it('prefers webm+opus, then webm, then mp4 (legacy recording chain)', () => {
    const all = new Set(MIME_CANDIDATES)
    expect(pickMimeType((m) => all.has(m))).toBe('audio/webm;codecs=opus')
    expect(pickMimeType((m) => m === 'audio/webm' || m === 'audio/mp4')).toBe('audio/webm')
    expect(pickMimeType((m) => m === 'audio/mp4')).toBe('audio/mp4')
  })

  it('returns empty string when nothing is supported (browser default)', () => {
    expect(pickMimeType(() => false)).toBe('')
  })
})

describe('levelToSegments (legacy VU bar mapping)', () => {
  it('maps silence to zero and loud input to full scale', () => {
    expect(levelToSegments(0)).toBe(0)
    expect(levelToSegments(-1)).toBe(0)
    expect(levelToSegments(NaN)).toBe(0)
    expect(levelToSegments(0.002)).toBeGreaterThanOrEqual(0)
    expect(levelToSegments(0.3)).toBe(SEGMENT_COUNT)
    expect(levelToSegments(5)).toBe(SEGMENT_COUNT)
  })

  it('shows about half the LEDs during quiet speech (legacy behavior)', () => {
    const quiet = levelToSegments(0.02)
    expect(quiet).toBeGreaterThanOrEqual(3)
    expect(quiet).toBeLessThanOrEqual(4)
  })

  it('is monotonic across the whole range and stays in bounds', () => {
    let prev = -1
    for (let v = 0.0005; v < 1; v *= 1.15) {
      const segs = levelToSegments(v)
      expect(segs).toBeGreaterThanOrEqual(0)
      expect(segs).toBeLessThanOrEqual(SEGMENT_COUNT)
      expect(segs).toBeGreaterThanOrEqual(prev)
      prev = segs
    }
  })
})
