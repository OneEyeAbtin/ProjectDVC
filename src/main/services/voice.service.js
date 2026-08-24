import fs from 'node:fs'
import path from 'node:path'
import { emit } from '../bus.js'
import { VoiceQuotaError } from '../providers/tts/elevenlabs.js'
import * as elevenlabsProvider from '../providers/tts/elevenlabs.js'
import * as edgeProvider from '../providers/tts/edge.js'
import * as piperProvider from '../providers/tts/piper.js'

const CACHE_FILE_COUNT = 10

const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
// ~0.3s of webm/opus audio; anything smaller is a stray tap, not speech.
export const MIN_RECORDING_BYTES = 10000
export const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo'

// Pure guard so tests can pin the threshold without network.
export function isRecordingTooShort(byteLength) {
  return Number(byteLength ?? 0) < MIN_RECORDING_BYTES
}

// Legacy text cleaning (port of audio.py TTSWorker.run): strip *actions*,
// strip [...] tags, strip non-speech chars. Unicode-aware so accented
// letters survive, matching Python's \w semantics.
export function cleanSpeechText(text) {
  let clean = String(text ?? '')
  clean = clean.replace(/\*[^*]*\*/g, '')
  clean = clean.replace(/\[[^\]]*\]/g, '')
  clean = clean.replace(/[^\p{L}\p{N}\s.,!?'-]/gu, '')
  return clean.trim()
}

// Arbitration chain per plan Global Constraints:
//   engine 'edge'  → edge only.
//   engine 'piper' → piper only.
//   engine 'elevenlabs' → EL (when configured), then quota-fallback to
//   edge → piper → failed (legacy TTSWorker parity).
export function chainFor(engine, elevenlabsReady) {
  if (engine === 'edge') return ['edge']
  if (engine === 'piper') return ['piper']
  return elevenlabsReady ? ['elevenlabs', 'edge', 'piper'] : ['edge', 'piper']
}

/**
 * @param {{ rootDir: string, getConfig: () => object|null, providers?: object }} deps
 * getConfig is read at call time so a factory-reset config swap can never
 * strand this service with stale settings.
 */
export function createVoiceService({ rootDir, getConfig, providers }) {
  const cacheDir = path.join(rootDir, 'data', 'tts-cache')
  fs.mkdirSync(cacheDir, { recursive: true })

  const impl = providers ?? {
    elevenlabs: elevenlabsProvider,
    edge: edgeProvider,
    piper: piperProvider
  }
  // Round-robin over tts_0..tts_9 — the oldest file gets overwritten next.
  let rotation = 0

  function scanPiperVoices() {
    const voicesDir = path.join(rootDir, 'assets', 'tts', 'voices')
    try {
      return fs
        .readdirSync(voicesDir)
        .filter((f) => f.endsWith('.onnx'))
        .map((f) => f.slice(0, -'.onnx'.length))
        .sort()
    } catch {
      return []
    }
  }

  function isConfigured() {
    const cfg = safeGetConfig()
    return Boolean(cfg?.elevenlabs?.api_key && cfg?.elevenlabs?.voice_id)
  }

  function safeGetConfig() {
    try {
      return getConfig?.() ?? {}
    } catch {
      return {}
    }
  }

  function providerCfg(name, cfg) {
    if (name === 'elevenlabs') return cfg.elevenlabs ?? {}
    if (name === 'edge') return { edge_voice: cfg.tts_config?.edge_voice }
    return {
      voice: cfg.tts_config?.piper_voice,
      assets_tts_dir: path.join(rootDir, 'assets', 'tts')
    }
  }

  // Never throws to the caller. Returns {path, emotion} on success, null on
  // skip/total failure; emits bus topic `tts:ready` on success and `tts`
  // {error} when every engine in the chain failed.
  async function speak({ text, emotion }) {
    try {
      const clean = cleanSpeechText(text)
      if (!clean) return null

      const cfg = safeGetConfig()
      const engine = cfg.tts_config?.engine ?? 'edge'
      const chain = chainFor(engine, isConfigured())

      let lastError = null
      for (const name of chain) {
        // Piper writes wav; everything else mp3.
        const ext = name === 'piper' ? 'wav' : 'mp3'
        const outPath = path.join(cacheDir, `tts_${rotation % CACHE_FILE_COUNT}.${ext}`)
        rotation += 1
        try {
          await impl[name].synthesize({
            text: clean,
            emotion,
            outPath,
            cfg: providerCfg(name, cfg)
          })
          const result = { path: outPath, emotion: emotion ?? null }
          emit('tts:ready', result)
          return result
        } catch (err) {
          lastError = err
          // Only quota/auth failures cascade to the next engine (legacy:
          // non-quota errors re-raise straight to failed).
          if (!(err instanceof VoiceQuotaError)) break
        }
      }

      emit('tts', { error: String(lastError?.message ?? lastError ?? 'TTS failed.') })
      return null
    } catch (err) {
      try {
        emit('tts', { error: String(err?.message ?? err) })
      } catch {
        void 0
      }
      return null
    }
  }

  // Placeholder — the renderer owns playback (and thus stop).
  function stop() {}

  // Mic STT via Groq Whisper (legacy stt_groq.py parity). Throws plain Errors
  // with friendly messages; the ipc handler catches them into {error} acks.
  async function transcribe({ buffer, mime }) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer ?? 0)
    if (isRecordingTooShort(bytes.byteLength)) {
      throw new Error('Recording too short — hold the mic button while you speak.')
    }
    const cfg = safeGetConfig()
    const apiKey = cfg?.online_api_key
    if (!apiKey) throw new Error('Voice input needs an API key — add one in Settings → General.')

    const model = cfg.tts_config?.stt_model || DEFAULT_STT_MODEL
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), 'audio.webm')
    form.append('model', model)
    form.append('response_format', 'text')

    let res
    try {
      res = await fetch(GROQ_STT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
      })
    } catch (err) {
      throw new Error(`Speech-to-text request failed: ${String(err?.message ?? err)}`)
    }
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 200)
      } catch {
        void 0
      }
      throw new Error(`Speech-to-text failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
    }
    const text = String(await res.text() ?? '').trim()
    return { text }
  }

  return { speak, stop, transcribe, scanPiperVoices, isConfigured, cacheDir }
}
