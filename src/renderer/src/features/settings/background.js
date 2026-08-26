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

// Gradient SHAPES (Settings → General → Background): linear presets carry a
// fixed angle; radial ignores angles entirely. Works for both theme-built-in
// gradients and the custom override. Fixwave M: 'diagonal-alt' removed — a
// stored legacy value sanitizes back to 'diagonal'.
export const GRADIENT_STYLE_OPTIONS = [
  { id: 'diagonal', label: 'Diagonal', angle: 135 },
  { id: 'vertical', label: 'Vertical', angle: 180 },
  { id: 'horizontal', label: 'Horizontal', angle: 90 },
  { id: 'radial', label: 'Radial' }
]

const GRADIENT_STYLE_IDS = GRADIENT_STYLE_OPTIONS.map((s) => s.id)

export function sanitizeGradientStyle(value) {
  return GRADIENT_STYLE_IDS.includes(value) ? value : 'diagonal'
}

// Style → CSS background image. Linear styles use `angle` (custom-gradient
// slider overrides it; theme gradients supply their own); radial is
// angle-free by definition, so any angle passed in is ignored there.
export function buildGradientCss({ from, to, angle, style } = {}) {
  if (sanitizeGradientStyle(style) === 'radial') {
    return `radial-gradient(circle at 50% 40%, ${from}, ${to})`
  }
  const opt = GRADIENT_STYLE_OPTIONS.find((s) => s.id === style)
  return `linear-gradient(${clampAngle(angle ?? opt?.angle ?? 135)}deg, ${from}, ${to})`
}

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
// while enabled, otherwise the selected theme's built-in colors. Unknown
// theme ids fall back to the default theme so the shell always has colors.
// The chosen STYLE owns the linear angle in both modes (radial is angle-free);
// a custom-gradient slider value still overrides it — that IS its angle field.
export function resolveBackground({ themeId, customGradient, gradientStyle } = {}) {
  const style = sanitizeGradientStyle(gradientStyle)
  const styleOpt = GRADIENT_STYLE_OPTIONS.find((s) => s.id === style)
  const custom = sanitizeGradient(customGradient)
  if (custom.enabled) return { ...custom, style }
  const theme = THEME_GRADIENTS[themeId] ?? THEME_GRADIENTS[DEFAULT_THEME_ID]
  return {
    enabled: true,
    from: theme.from,
    to: theme.to,
    angle: clampAngle(styleOpt?.angle ?? theme.angle),
    style
  }
}

// Writes the effective gradient onto <html>; the store re-runs this whenever
// theme / config.custom_gradient / config.gradient_style changes. The full
// image lands in --shell-grad-image; from/to/angle stay published as legacy
// fallback vars.
export function applyBackground(options) {
  const g = resolveBackground(options)
  const root = document.documentElement
  root.style.setProperty('--shell-grad-from', g.from)
  root.style.setProperty('--shell-grad-to', g.to)
  root.style.setProperty('--shell-grad-angle', `${g.angle}deg`)
  root.style.setProperty('--shell-grad-image', buildGradientCss(g))
}

// Fixwave L — style clicks must stay VISIBLE in custom-gradient mode. While
// the override is enabled, resolveBackground renders the slider's angle, so a
// previously-dragged value (e.g. 220°) masks every linear style and the
// selector looks dead. Selecting a linear style therefore re-owns its fixed
// angle INTO the custom gradient; radial is angle-free and touches nothing.
// Returns the full replacement gradient to persist, or null when only
// gradient_style needs saving (custom off, radial, or angle already synced).
export function styleGradientPatch(customGradient, styleId) {
  const opt = GRADIENT_STYLE_OPTIONS.find((s) => s.id === sanitizeGradientStyle(styleId))
  if (!opt || opt.angle === undefined) return null
  const g = sanitizeGradient(customGradient)
  if (!g.enabled || g.angle === opt.angle) return null
  return { ...g, angle: opt.angle }
}
