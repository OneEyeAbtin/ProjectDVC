// Pure mic helpers — kept free of browser APIs so vitest can pin them.

export const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

// First container the recorder actually supports ('' lets the browser pick).
export function pickMimeType(isSupported) {
  for (const mime of MIME_CANDIDATES) {
    if (isSupported(mime)) return mime
  }
  return ''
}

export const SEGMENT_COUNT = 8

// Log-scaled RMS → lit segments (0..8). Legacy VU bar showed ~half the LEDs
// during quiet speech; a log map keeps that visible without clipping on loud
// peaks. Floor 0.002 (silence), ceiling 0.3 (loud) spans ~7.3 octaves.
const RMS_FLOOR = 0.002
const RMS_CEILING = 0.3
const LOG_SPAN = Math.log2(RMS_CEILING / RMS_FLOOR)

export function levelToSegments(rms) {
  const v = Number(rms)
  if (!Number.isFinite(v) || v <= RMS_FLOOR) return 0
  if (v >= RMS_CEILING) return SEGMENT_COUNT
  return Math.max(0, Math.min(SEGMENT_COUNT, Math.round((Math.log2(v / RMS_FLOOR) / LOG_SPAN) * SEGMENT_COUNT)))
}
