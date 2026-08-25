// Shell background authority — CSS-var bridge between store state and the
// .shell background rule in global.css:
//   linear-gradient(var(--shell-grad-angle,135deg),
//                   var(--shell-grad-from,var(--bg2)), var(--shell-grad-to,var(--bg1)))
// Each preset theme owns a built-in gradient (THEME_GRADIENTS in
// src/main/data/themes.js): selecting a theme applies it. A custom gradient
// (Settings → General → Background) overrides while enabled; turning it off
// returns to the theme's gradient. Mirrors DEFAULTS.custom_gradient in
// src/main/data/defaults.js.

import { DEFAULT_THEME_ID, THEME_GRADIENTS } from '../../../../main/data/themes.js'

export const DEFAULT_GRADIENT = { enabled: false, from: '#1a1025', to: '#0d0816', angle: 135 }

// One-click presets shown in Settings → General → Background. Applying one
// also enables the gradient so the click gives instant feedback.
export const GRADIENT_PRESETS = [
  { name: 'Midnight Purple', from: '#2d1f3d', to: '#0d0816' },
  { name: 'Sunset', from: '#ff6b9d', to: '#3d2a54' },
  { name: 'Ocean', from: '#00d4ff', to: '#0a1628' },
  { name: 'Ember', from: '#ff2d55', to: '#160a0e' },
  { name: 'Forest', from: '#4ade80', to: '#0e1a10' },
  { name: 'Gold', from: '#ffd700', to: '#2d1f3d' }
]

function clampAngle(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_GRADIENT.angle
  return Math.min(360, Math.max(0, Math.round(n)))
}

// Config files are user-editable JSON — never trust shape/colors blindly.
export function sanitizeGradient(value) {
  const g = value && typeof value === 'object' ? value : {}
  const hex = (v, fallback) =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : fallback
  return {
    enabled: g.enabled === true,
    from: hex(g.from, DEFAULT_GRADIENT.from),
    to: hex(g.to, DEFAULT_GRADIENT.to),
    angle: clampAngle(g.angle)
  }
}

// Effective gradient for the current shell state: the custom override wins
// while enabled, otherwise the selected theme's built-in gradient. Unknown
// theme ids fall back to the default theme so the shell always has colors.
export function resolveBackground({ themeId, customGradient } = {}) {
  const custom = sanitizeGradient(customGradient)
  if (custom.enabled) return custom
  const theme = THEME_GRADIENTS[themeId] ?? THEME_GRADIENTS[DEFAULT_THEME_ID]
  return { enabled: true, from: theme.from, to: theme.to, angle: clampAngle(theme.angle) }
}

// Writes the effective gradient onto <html>; the store re-runs this whenever
// theme or config.custom_gradient changes.
export function applyBackground(options) {
  const g = resolveBackground(options)
  const root = document.documentElement
  root.style.setProperty('--shell-grad-from', g.from)
  root.style.setProperty('--shell-grad-to', g.to)
  root.style.setProperty('--shell-grad-angle', `${g.angle}deg`)
}
