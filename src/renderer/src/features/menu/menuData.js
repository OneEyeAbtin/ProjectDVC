// app:init does not carry the interact menu or interaction lines, so these are
// embedded here mirroring legacy core/constants.py _INTERACT_MENU and
// core/config.py "interactions" exactly (kept in sync by tests/menu-data.test.js).
export const INTERACT_MENU = [
  { id: 'pat', label: '🤚 Pat Head' },
  { id: 'hug', label: '🤗 Hug' },
  { id: 'poke', label: '👉 Poke' },
  { id: 'kiss', label: '💋 Kiss' },
  { id: 'tickle', label: '🤭 Tickle' },
  { id: 'gift', label: '🎁 Gift' },
  { id: 'boop', label: '👆 Boop Nose' },
  { id: 'headpat', label: '🥺 Head Pat' },
  { id: 'hold_hands', label: '🤝 Hold Hands' },
  { id: 'feed', label: '🍰 Feed Snack' },
  { id: 'whisper', label: '💬 Whisper' },
  { id: 'stare', label: '👀 Stare Contest' },
  { id: 'compliment', label: '💖 Compliment' },
  { id: 'dance', label: '💃 Dance Together' }
]

export const INTERACTIONS = {
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
}

// Display names + swatch colors mirror legacy THEMES_NAME_TO_ID / themes.css.
export const THEME_META = [
  { id: 'midnight-sakura', name: 'Midnight Sakura', dot: ['#ff6b9d', '#c084fc'] },
  { id: 'crimson-abyss', name: 'Crimson Abyss', dot: ['#ff2d55', '#ff6b35'] },
  { id: 'ocean-dream', name: 'Ocean Dream', dot: ['#00d4ff', '#0099ff'] },
  { id: 'forest-dusk', name: 'Forest Dusk', dot: ['#4ade80', '#86efac'] },
  { id: 'synthwave', name: 'Synthwave', dot: ['#f72585', '#7209b7'] },
  { id: 'arctic-ghost', name: 'Arctic Ghost', dot: ['#a8d8ff', '#6eb5ff'] },
  { id: 'darkwave', name: 'Darkwave', dot: ['#cc0033', '#880022'] },
  { id: 'matrix', name: 'Matrix', dot: ['#00ff41', '#008f11'] },
  { id: 'ethereal', name: 'Ethereal', dot: ['#fbbf24', '#93c5fd'] },
  { id: 'neon-city', name: 'Neon City', dot: ['#ff2ea6', '#00e5ff'] },
  { id: 'amber-terminal', name: 'Amber Terminal', dot: ['#ffb000', '#cc7a00'] },
  { id: 'gold', name: 'Gold', dot: ['#d4af37', '#8c6d1f'] }
]

// Direct-action rows rendered next to the Settings entry; openers are wired
// by id in ContextMenu.jsx.
export const UTILITY_ENTRIES = [{ id: 'stats', label: '📊 Stats' }]
