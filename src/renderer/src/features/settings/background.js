// Custom shell background gradient — CSS-var bridge between the saved config
// and the .shell background rule in global.css:
//   linear-gradient(var(--shell-grad-angle,135deg),
//                   var(--shell-grad-from,var(--bg2)), var(--shell-grad-to,var(--bg1)))
// Applied live from the settings draft (Cancel re-applies the persisted
// values) and on boot/config-push by App.jsx. Mirrors DEFAULTS.custom_gradient
// in src/main/data/defaults.js.

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

export function applyGradient(gradient) {
  const root = document.documentElement
  const g = sanitizeGradient(gradient)
  if (!g.enabled) {
    root.style.removeProperty('--shell-grad-from')
    root.style.removeProperty('--shell-grad-to')
    root.style.removeProperty('--shell-grad-angle')
    return
  }
  root.style.setProperty('--shell-grad-from', g.from)
  root.style.setProperty('--shell-grad-to', g.to)
  root.style.setProperty('--shell-grad-angle', `${g.angle}deg`)
}
