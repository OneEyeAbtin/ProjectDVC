export const DEFAULTS = {
  local_api_url: 'http://localhost:1234/v1/chat/completions',
  local_api_key: '',
  local_api_model: '',

  online_api_url: '',
  online_api_key: '',
  online_api_model: '',

  max_history: 20,
  tts_config: {
    enabled: false,
    engine: 'edge',
    edge_voice: 'en-US-AriaNeural',
    piper_voice: '',
    stt_engine: 'groq',
    stt_model: 'whisper-large-v3-turbo'
  },
  elevenlabs: { api_key: '', voice_id: '', model_id: 'eleven_flash_v2_5' },
  stt: { engine: 'groq', groq_model: '', local_model: 'base', mic_gain: 4.0 },

  minecraft_v2: {
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
  },

  setup_questions: [
    { q: 'What should I call you?', key: 'user_name', emoji: '👋' },
    { q: "What's MY name going to be?", key: 'pet_name', emoji: '🌸' },
    { q: 'How old are you?', key: 'age', emoji: '🎂' },
    { q: 'What are your pronouns?', key: 'pronouns', emoji: '✨' },
    { q: 'What kind of music are you into?', key: 'music_taste', emoji: '🎵' },
    { q: 'Are you a night owl or early bird?', key: 'schedule', emoji: '🌙' },
    { q: "What's your main hobby or passion?", key: 'hobby', emoji: '🎮' },
    { q: "What's your love language? (words, touch, gifts, time, acts)", key: 'love_language', emoji: '💖' },
    { q: "What's your humor style? (dark, silly, sarcastic, dry, absurd)", key: 'humor_style', emoji: '😂' },
    { q: 'Are you more introvert, extrovert, or ambivert?', key: 'social_type', emoji: '👥' },
    { q: "What's your biggest pet peeve?", key: 'pet_peeve', emoji: '😤' },
    { q: "What's your comfort show, game, or movie?", key: 'comfort_media', emoji: '🎬' },
    { q: "What's something you wish people understood about you?", key: 'deep_wish', emoji: '💭' },
    { q: "What's your biggest fear?", key: 'fear', emoji: '😨' },
    { q: 'If you could have any superpower, what would it be?', key: 'dream_superpower', emoji: '⚡' },
    { q: "When you're upset, do you want comfort, space, or distraction?", key: 'emotional_response', emoji: '🤗' },
    { q: "What do you value most in a friendship or relationship?", key: 'friendship_value', emoji: '💞' },
    { q: "What's your guilty pleasure?", key: 'guilty_pleasure', emoji: '😈' },
    { q: "What's your life motto or personal philosophy?", key: 'life_motto', emoji: '💪' },
    { q: 'What do you want me to be? (girlfriend, friend, maid, goth, chaos agent...)', key: 'desired_role', emoji: '🎭' }
  ],

  interactions: {
    pat: '*I gently pat your head.*',
    hug: '*I wrap my arms around you in a warm hug.*',
    poke: '*I poke your cheek playfully.*',
    kiss: '*I lean in and kiss your cheek softly.*',
    tickle: '*I tickle your sides mercilessly!*',
    gift: '*I hand you a small wrapped gift with a bow.*',
    boop: '*I boop your nose with my finger.*',
    headpat: '*I gently and slowly pat your head, running my fingers through your hair.*',
    hold_hands: '*I reach out and gently hold your hand, interlacing our fingers.*',
    feed: '*I hold up a small cake to your lips.* Say ahh~',
    whisper: '*I lean in close and whisper a secret in your ear.*',
    stare: '*I stare into your eyes without blinking, challenging you to a stare contest.*',
    compliment: '*I look at you admiringly.* You look really nice today.',
    dance: '*I take your hand and start dancing with you to imaginary music.*'
  },

  emotions: [
    'neutral', 'happy', 'sad', 'angry', 'blush', 'thinking', 'love', 'sleepy',
    'excited', 'confused', 'bored', 'annoyed', 'evil', 'eyeroll', 'mocking',
    'smirk', 'shocked', 'disgusted', 'talking'
  ],

  cheat_codes: {
    showmehearts: 'Toggle hearts visibility',
    rosebud: 'Max affection',
    motherlode: 'Max affection (alias)',
    iddqd: 'Max all stats',
    upupdowndown: 'Switch to Girlfriend persona',
    amnesia: 'Wipe short-term memory',
    forceEMOTION: 'Force any emotion (e.g. forceevil, forcehappy)'
  },

  default_persona: 'Gothic',
  outfits: { Base: 'charlotte' },

  user_name: 'User',
  pet_name: 'Companion',
  persona: 'Tsundere',
  outfit: 'Base',
  brain_mode: 'online',

  stats: {
    affection: 20, rizz: 5, nerdiness: 10, sass: 15, chaos: 5,
    loyalty: 10, creativity: 10, wisdom: 5, humor: 10, romance: 5
  },

  tts_enabled: false,
  tts_engine: 'online',
  lip_sync_tts: true,
  lip_sync_text: false,
  selected_offline_voice: '',
  hearts_visible: true,
  hint_brain_shown: false,
  setup_complete: false,
  setup_answers: {},
  last_emotion: 'neutral',
  theme_id: 'midnight-sakura',

  always_on_top: true,
  tray_enabled: true,
  ui_sounds: true,
  idle_chat: true,
  ambient_effects: true,
  custom_gradient: { enabled: false, from: '#1a1025', to: '#0d0816', angle: 135 },
  particle_theme: 'stars',
  hide_to_tray: true,
  win_x: -1,
  win_y: -1,
  font_scale: 1.0
}

export const SETTINGS_KEYS = Object.keys(DEFAULTS)

export const SAVE_KEYS = ['user_name', 'pet_name', 'persona', 'outfit', 'brain_mode', 'stats', 'tts_enabled', 'tts_engine', 'lip_sync_tts', 'lip_sync_text', 'selected_offline_voice', 'hearts_visible', 'hint_brain_shown', 'setup_complete', 'setup_answers', 'last_emotion', 'theme_id', 'win_x', 'win_y', 'font_scale']
