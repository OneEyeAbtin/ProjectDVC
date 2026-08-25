export const THEME_LIST = ['midnight-sakura', 'crimson-abyss', 'ocean-dream', 'forest-dusk', 'synthwave', 'arctic-ghost', 'darkwave', 'matrix', 'ethereal', 'neon-city', 'amber-terminal', 'gold']

export const THEMES_NAME_TO_ID = {
  'Midnight Sakura': 'midnight-sakura',
  'Crimson Abyss': 'crimson-abyss',
  'Ocean Dream': 'ocean-dream',
  'Forest Dusk': 'forest-dusk',
  'Synthwave': 'synthwave',
  'Arctic Ghost': 'arctic-ghost',
  'Darkwave': 'darkwave',
  'Matrix': 'matrix',
  'Ethereal': 'ethereal',
  'Neon City': 'neon-city',
  'Amber Terminal': 'amber-terminal',
  'Gold': 'gold'
}

export const DEFAULT_THEME_ID = 'midnight-sakura'

// Built-in shell background gradient per theme — applied automatically when
// the theme is selected (see renderer features/settings/background.js).
// Values derive from each theme's palette in themes.css: `from` sits in the
// bg4/bg3 family (the lighter surface tone), `to` lands near bg1 (deepest
// tone), angles vary 120–170 so each theme keeps its own personality.
// Ethereal is inverted on purpose: it is the one light theme, so `to` is its
// lightest tone (near-white lavender).
export const THEME_GRADIENTS = {
  'midnight-sakura': { from: '#2d1f3d', to: '#0d0816', angle: 160 },
  'crimson-abyss': { from: '#361820', to: '#0a0608', angle: 145 },
  'ocean-dream': { from: '#162c4a', to: '#060d14', angle: 135 },
  'forest-dusk': { from: '#1f3824', to: '#070c08', angle: 140 },
  synthwave: { from: '#2a1545', to: '#08060f', angle: 165 },
  'arctic-ghost': { from: '#1e2c40', to: '#070a0f', angle: 130 },
  darkwave: { from: '#30001a', to: '#0a0005', angle: 155 },
  matrix: { from: '#0a1f0a', to: '#000800', angle: 150 },
  ethereal: { from: '#c7d4ff', to: '#f0f4ff', angle: 120 },
  'neon-city': { from: '#251a4a', to: '#06040f', angle: 170 },
  'amber-terminal': { from: '#3d2a10', to: '#120c02', angle: 155 },
  gold: { from: '#332818', to: '#0b0906', angle: 125 }
}
