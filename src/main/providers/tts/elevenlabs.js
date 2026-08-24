import fs from 'node:fs'

// Emotion → VoiceSettings map, ported verbatim from
// legacy/audio/tts_elevenlabs.py::EMOTION_SETTINGS (18 emotions).
// stability    : 0.0 (very expressive/chaotic) → 1.0 (flat/consistent)
// similarity   : how closely to stick to the original voice clone
// style        : style exaggeration 0-1 (multilingual_v2 / turbo v2+ only)
// speaker_boost: extra clarity boost
export const EMOTION_SETTINGS = {
  neutral:   { stability: 0.5, similarity_boost: 0.75, style: 0.1, speaker_boost: true },
  happy:     { stability: 0.4, similarity_boost: 0.8, style: 0.4, speaker_boost: true },
  excited:   { stability: 0.2, similarity_boost: 0.85, style: 0.8, speaker_boost: true },
  love:      { stability: 0.55, similarity_boost: 0.8, style: 0.35, speaker_boost: true },
  blush:     { stability: 0.6, similarity_boost: 0.75, style: 0.25, speaker_boost: true },
  sad:       { stability: 0.75, similarity_boost: 0.7, style: 0.15, speaker_boost: false },
  angry:     { stability: 0.15, similarity_boost: 0.9, style: 0.9, speaker_boost: true },
  annoyed:   { stability: 0.3, similarity_boost: 0.85, style: 0.6, speaker_boost: true },
  shocked:   { stability: 0.1, similarity_boost: 0.9, style: 0.85, speaker_boost: true },
  thinking:  { stability: 0.65, similarity_boost: 0.7, style: 0.1, speaker_boost: false },
  confused:  { stability: 0.45, similarity_boost: 0.75, style: 0.2, speaker_boost: false },
  sleepy:    { stability: 0.85, similarity_boost: 0.65, style: 0.05, speaker_boost: false },
  bored:     { stability: 0.8, similarity_boost: 0.65, style: 0.05, speaker_boost: false },
  smirk:     { stability: 0.45, similarity_boost: 0.8, style: 0.45, speaker_boost: true },
  mocking:   { stability: 0.35, similarity_boost: 0.8, style: 0.55, speaker_boost: true },
  eyeroll:   { stability: 0.4, similarity_boost: 0.75, style: 0.4, speaker_boost: false },
  evil:      { stability: 0.25, similarity_boost: 0.85, style: 0.75, speaker_boost: true },
  disgusted: { stability: 0.3, similarity_boost: 0.8, style: 0.65, speaker_boost: true }
}

// Quota/auth/rate-limit failures are recoverable — the voice service falls
// back to the next engine in the chain instead of surfacing the error.
export class VoiceQuotaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VoiceQuotaError'
  }
}

const QUOTA_STATUSES = new Set([401, 402, 403, 429])
const NO_STYLE_MODELS = new Set(['eleven_monolingual_v1', 'eleven_multilingual_v1'])

export function isConfigured(cfg) {
  return Boolean(cfg?.api_key && cfg?.voice_id)
}

export async function synthesize({ text, emotion, outPath, cfg }) {
  const apiKey = cfg?.api_key
  const voiceId = cfg?.voice_id
  if (!apiKey || !voiceId) {
    throw new Error('ElevenLabs not configured — set api_key and voice_id in Settings.')
  }

  const emo =
    typeof emotion === 'string' && emotion.toLowerCase() in EMOTION_SETTINGS
      ? emotion.toLowerCase()
      : 'neutral'
  const settings = EMOTION_SETTINGS[emo]
  const modelId = cfg?.model_id || 'eleven_flash_v2_5'

  // v1 models predate the style parameter (legacy parity).
  const voiceSettings = {
    stability: settings.stability,
    similarity_boost: settings.similarity_boost,
    use_speaker_boost: settings.speaker_boost !== false
  }
  if (!NO_STYLE_MODELS.has(modelId)) voiceSettings.style = settings.style ?? 0

  let res
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings })
      }
    )
  } catch (err) {
    throw new Error(`ElevenLabs request failed: ${err.message}`)
  }

  if (!res.ok) {
    if (QUOTA_STATUSES.has(res.status)) {
      throw new VoiceQuotaError(
        `ElevenLabs HTTP ${res.status} — quota/auth/rate-limit hit (${res.statusText || 'no status text'}).`
      )
    }
    throw new Error(`ElevenLabs request failed (HTTP ${res.status} ${res.statusText}).`)
  }

  // Clips are short — buffering is simpler and just as fast as streaming.
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(outPath, buf)
  return outPath
}
