// Minecraft renderer logic — pure helpers ported from legacy/core/main.py
// (_RadarWidget paintEvent, _mc_update_inv_panel ICONS, mcErrorLine mappings)
// so they stay unit-testable without canvas/IPC.

export const MC_CONSOLE_CAP = 400
export const MC_HISTORY_CAP = 20
export const RADAR_WORLD_RADIUS = 32
export const RADAR_MIN_INTERVAL_MS = 2000

// Console line classification → CSS tone class suffix ('' = default txt2).
// Order matters: error patterns win over success ones ("Connection refused").
export function classifyMcLine(line) {
  const text = String(line ?? '')
  if (/\[BOT ERROR\]|\berror\b|\bfail|refused|timed out|\breset\b|exited|not found|invalid/i.test(text)) return 'err'
  if (/✓|\bconnected\b|success|complete|\bdone\b|advancement|joined/i.test(text)) return 'ok'
  if (/reconnect|connecting|queue|wait|retry|spawn/i.test(text)) return 'warn'
  return ''
}

// Radar pushes arrive ~1/s while connected; the scope only needs ~2s freshness.
export function shouldAcceptRadar(lastAt, now, minIntervalMs = RADAR_MIN_INTERVAL_MS) {
  if (!Number.isFinite(now)) return false
  if (!Number.isFinite(lastAt) || lastAt <= 0) return true
  return now - lastAt >= minIntervalMs
}

// Legacy _RadarWidget blip geometry: world x/z (blocks, bot at origin) →
// screen coords inside a circle of `radius` px. Out-of-range blips are dropped,
// closer blips render larger (max(2, DOT_R - dist/10)).
export function projectBlips(entities, radiusPx, worldRadius = RADAR_WORLD_RADIUS) {
  const list = Array.isArray(entities) ? entities : []
  const scale = radiusPx / worldRadius
  const out = []
  for (const ent of list) {
    if (!ent || typeof ent !== 'object') continue
    const x = Number(ent.x) || 0
    const z = Number(ent.z) || 0
    const dist = Math.hypot(x, z)
    if (dist > worldRadius) continue
    out.push({
      x: x * scale,
      y: z * scale, // legacy parity: +z draws downward on screen
      dot: Math.max(2, 5 - Math.floor(dist / 10)),
      kind: ent.kind === 'player' ? 'player' : 'hostile',
      name: String(ent.name ?? '?')
    })
  }
  return out
}

// Inventory icon map — ported verbatim from _mc_update_inv_panel.
const INV_ICONS = [
  ['diamond', '💎'], ['netherite', '⚫'], ['gold', '🟡'], ['iron', '⚙️'],
  ['coal', '🪨'], ['sword', '⚔️'], ['pickaxe', '⛏'], ['axe', '🪓'],
  ['bow', '🏹'], ['arrow', '➡️'], ['torch', '🕯'], ['stone', '🪨'],
  ['log', '🪵'], ['plank', '🪵'], ['chest', '📦'], ['totem', '🏺'],
  ['helmet', '⛑️'], ['chestplate', '🛡'], ['leggings', '👖'], ['boots', '👟'],
  ['shield', '🛡'], ['armor', '🛡'], ['bread', '🍞'], ['apple', '🍎'],
  ['cooked', '🍗'], ['food', '🍖'], ['bucket', '🪣'], ['rod', '🎣']
]

export function itemIcon(name) {
  const lower = String(name ?? '').toLowerCase()
  for (const [keyword, icon] of INV_ICONS) {
    if (lower.includes(keyword)) return icon
  }
  return '▪️'
}

// Status strip under the Inv tab — XP intentionally omitted (legacy parity).
export function botStatusLine(data) {
  const d = data && typeof data === 'object' ? data : {}
  return `❤️ HP: ${d.hp ?? '?'}/20 · 🍖 ${d.food ?? '?'}/20 · 📍 ${d.x ?? '?'} ${d.y ?? '?'} ${d.z ?? '?'} · 🛡 ${d.held ?? 'empty'}`
}

// Friendly connect-failure copy for the error chip (ported from
// minecraft.service.js::mcErrorLine, minus the persona voice).
export function mapMcError(message) {
  const msg = String(message ?? '')
  if (msg.includes('ETIMEDOUT')) return 'Server timed out — is it running? ⏳'
  if (msg.includes('ECONNREFUSED')) return 'Connection refused — is the server on? 🔌'
  if (msg.includes('getaddrinfo')) return "Can't find that server — check the IP! 🌐"
  if (msg.includes('ECONNRESET')) return 'Connection was reset by the server~'
  if (msg.toLowerCase().includes('version')) return 'Version mismatch — check MC Version in Settings ⛏ MC ⚡'
  return msg.trim() || 'Minecraft connection failed'
}
