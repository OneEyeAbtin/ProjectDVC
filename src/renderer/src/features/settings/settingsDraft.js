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

function pick(source, defaults) {
  const src = source && typeof source === 'object' ? source : {}
  return { ...defaults, ...src }
}

export function buildSnapshot(state) {
  const cfg = state.config ?? {}
  return {
    user_name: state.userName ?? '',
    pet_name: state.petName ?? '',
    brain_mode: state.brainMode ?? 'online',
    hearts_visible: state.heartsVisible !== false,
    theme_id: state.theme ?? 'midnight-sakura',
    max_history: Number(cfg.max_history) || 20,
    online_api_url: cfg.online_api_url ?? '',
    online_api_key: cfg.online_api_key ?? '',
    online_api_model: cfg.online_api_model ?? '',
    local_api_url: cfg.local_api_url ?? '',
    local_api_key: cfg.local_api_key ?? '',
    local_api_model: cfg.local_api_model ?? '',
    always_on_top: cfg.always_on_top !== false,
    tray_enabled: cfg.tray_enabled !== false,
    ui_sounds: cfg.ui_sounds !== false,
    idle_chat: cfg.idle_chat !== false,
    font_scale: Number(state.fontScale) || 1,
    lip_sync_tts: state.lipSyncTts !== false,
    lip_sync_text: state.lipSyncText === true,
    tts_config: pick(cfg.tts_config, DEFAULT_TTS_CONFIG),
    elevenlabs: pick(cfg.elevenlabs, DEFAULT_ELEVENLABS)
  }
}

// Draft→Save diff. Nested objects (tts_config, elevenlabs) deliberately use
// WHOLE-OBJECT replacement: any subfield edit creates a new object reference,
// which this strict compare treats as changed and sends in full to
// profile:save; untouched objects keep their reference and are omitted.
// Deep-diffing was rejected as needless complexity for two small flat objects.
export function diffPatch(draft, snapshot) {
  const patch = {}
  for (const [key, value] of Object.entries(draft)) {
    if (value !== snapshot[key]) patch[key] = value
  }
  return patch
}
