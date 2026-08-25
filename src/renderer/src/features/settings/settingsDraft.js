import { isAutoSaveKey } from './liveSettings.js'

export const TTS_ENGINES = ['elevenlabs', 'edge', 'piper']

export const EDGE_VOICE_SUGGESTIONS = [
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'ja-JP-NanamiNeural',
  'es-ES-ElviraNeural'
]

// The 18 persistent emotions (DEFAULTS.emotions minus the render-only
// talking/fullbody states) offered to "Test voice".
export const TEST_EMOTIONS = [
  'neutral', 'happy', 'sad', 'angry', 'blush', 'thinking', 'love', 'sleepy',
  'excited', 'confused', 'bored', 'annoyed', 'evil', 'eyeroll', 'mocking',
  'smirk', 'shocked', 'disgusted'
]

export const TEST_VOICE_LINE = 'Hey! This is how I sound~'

const DEFAULT_TTS_CONFIG = {
  enabled: false,
  engine: 'edge',
  edge_voice: 'en-US-AriaNeural',
  piper_voice: '',
  stt_engine: 'groq',
  stt_model: 'whisper-large-v3-turbo'
}

const DEFAULT_ELEVENLABS = { api_key: '', voice_id: '', model_id: 'eleven_flash_v2_5' }

// Mirrors DEFAULTS.minecraft_v2 in src/main/data/defaults.js — kept in sync
// manually so the renderer can render a complete form before app:init lands.
export const DEFAULT_MC_CONFIG = {
  host: 'localhost',
  port: 25565,
  username: 'RavenBot',
  version: '1.21',
  auth: 'offline',
  ws_port: 8765,
  brain_url: '',
  brain_key: '',
  brain_model: '',
  ai_features: { ai_hash_chat: true, ai_advancements: false, ai_task_done: false, ai_events: false }
}

function pick(source, defaults) {
  const src = source && typeof source === 'object' ? source : {}
  return { ...defaults, ...src }
}

// minecraft_v2 snapshot: shallow-merge like tts_config, then re-merge
// ai_features so a partially-saved toggle set still shows the defaults.
export function buildMcSnapshot(cfg = {}) {
  const mc = pick(cfg.minecraft_v2, DEFAULT_MC_CONFIG)
  return { ...mc, ai_features: pick(mc.ai_features, DEFAULT_MC_CONFIG.ai_features) }
}

// Draft snapshot = ONLY the fields that persist through the Save button.
// Live appearance/behavior keys (theme, particles, gradient, toggles, font
// scale — see liveSettings.js AUTO_SAVE_KEYS) are excluded: their controls
// read the store directly and persist immediately (debounced), so including
// them here would make Cancel/Save fight the already-live values.
export function buildSnapshot(state) {
  const cfg = state.config ?? {}
  return {
    user_name: state.userName ?? '',
    pet_name: state.petName ?? '',
    brain_mode: state.brainMode ?? 'online',
    max_history: Number(cfg.max_history) || 20,
    online_api_url: cfg.online_api_url ?? '',
    online_api_key: cfg.online_api_key ?? '',
    online_api_model: cfg.online_api_model ?? '',
    local_api_url: cfg.local_api_url ?? '',
    local_api_key: cfg.local_api_key ?? '',
    local_api_model: cfg.local_api_model ?? '',
    lip_sync_tts: state.lipSyncTts !== false,
    lip_sync_text: state.lipSyncText === true,
    tts_config: pick(cfg.tts_config, DEFAULT_TTS_CONFIG),
    elevenlabs: pick(cfg.elevenlabs, DEFAULT_ELEVENLABS),
    minecraft_v2: buildMcSnapshot(cfg)
  }
}

// Draft→Save diff. Nested objects (tts_config, elevenlabs) deliberately use
// WHOLE-OBJECT replacement: any subfield edit creates a new object reference,
// which this strict compare treats as changed and sends in full to
// profile:save; untouched objects keep their reference and are omitted.
// Deep-diffing was rejected as needless complexity for two small flat objects.
// Auto-save keys are skipped defensively: a stale draft that still carries
// them can never leak back into a manual save.
export function diffPatch(draft, snapshot) {
  const patch = {}
  for (const [key, value] of Object.entries(draft)) {
    if (isAutoSaveKey(key)) continue
    if (value !== snapshot[key]) patch[key] = value
  }
  return patch
}
