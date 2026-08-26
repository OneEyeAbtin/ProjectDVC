// Live (auto-save) settings — the General-tab controls that persist
// IMMEDIATELY on change instead of waiting for the draft→Save round trip.
// Everything here is pure: the store owns timers/persistence, the overlay
// owns rendering; this module is the shared contract between them.

// Keys accepted by profile:save that auto-save. Keep in sync with the
// General tab wiring in SettingsOverlay.jsx — draft fields (names, brain
// mode, API keys/urls, MC/voice config, message limit, lip-sync toggles)
// deliberately stay on the Save-button path.
export const AUTO_SAVE_KEYS = [
  'theme_id',
  'ambient_effects',
  'animation_speed',
  'particle_theme',
  'custom_gradient',
  'gradient_style',
  'reduce_transparency',
  'ui_sounds',
  'always_on_top',
  'tray_enabled',
  'idle_chat',
  'font_scale',
  'hearts_visible'
]

export const AUTO_SAVE_DEBOUNCE_MS = 400

export function isAutoSaveKey(key) {
  return AUTO_SAVE_KEYS.includes(key)
}

// Auto-save keys live outside the settings draft: read them straight off the
// boot state shape (theme/fontScale/heartsVisible are top-level save fields,
// the rest ride the config object).
export function readLiveSetting(state, key) {
  switch (key) {
    case 'theme_id':
      return state.theme
    case 'hearts_visible':
      return state.heartsVisible
    case 'font_scale':
      return state.fontScale
    default:
      return state.config?.[key]
  }
}
