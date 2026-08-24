import { useStore } from '../state/store.js'

// Envelope specs ported from legacy/audio/audio.py::gen_sounds
// (sine sweep from→to over `dur` seconds with a decaying gain envelope).
const SFX = {
  blip: { from: 600, to: 600, dur: 0.04, vol: 0.2 },
  notify: { from: 880, to: 440, dur: 0.15, vol: 0.25 },
  statUp: { from: 523, to: 1047, dur: 0.2, vol: 0.25 },
  statDown: { from: 1047, to: 262, dur: 0.2, vol: 0.25 },
  error: { from: 150, to: 150, dur: 0.3, vol: 0.3 }
}

let ctx = null

function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// Master gate read live from the store so toggling the setting needs no rewire.
export function soundsEnabled() {
  return useStore.getState().config?.ui_sounds !== false
}

export function playSfx(name) {
  const spec = SFX[name]
  if (!spec || !soundsEnabled()) return
  try {
    const ac = audioContext()
    if (!ac) return
    const t = ac.currentTime
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(spec.from, t)
    if (spec.to !== spec.from) osc.frequency.linearRampToValueAtTime(spec.to, t + spec.dur)
    gain.gain.setValueAtTime(spec.vol, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur)
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(t)
    osc.stop(t + spec.dur)
  } catch {
    // Audio unavailable (permissions, disposed context) — stay silent.
  }
}

// 'statUp' when any stat rose, else 'statDown'; null when nothing numerically changed.
export function statSoundDirection(prev, next) {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return null
  let up = false
  let changed = false
  for (const key of Object.keys(next)) {
    const before = Number(prev[key])
    const after = Number(next[key])
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) continue
    changed = true
    if (after > before) up = true
  }
  return changed ? (up ? 'statUp' : 'statDown') : null
}

// Store-side event wiring: reply start = notify, error chip = buzz, stats push =
// up/down by delta sign. Returns an unsubscribe fn. The boot guard is implicit:
// lastStats starts null and a null prev yields no direction.
export function wireSfxEvents() {
  let lastStats = null
  return useStore.subscribe((state, prev) => {
    if (state.bubble && state.bubble !== prev.bubble && state.typing) playSfx('notify')
    if (state.error && state.error !== prev.error) playSfx('error')
    if (state.stats !== lastStats) {
      const dir = statSoundDirection(lastStats, state.stats)
      if (dir) playSfx(dir)
      lastStats = state.stats
    }
  })
}
