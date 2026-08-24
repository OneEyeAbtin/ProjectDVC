import { useStore } from '../../state/store.js'

export const LIP_SYNC_INTERVAL_MS = 150

// TTS lip-sync loop: flips transientEmotion between 'talking' and whatever the
// canonical emotion is at tick time (so a mid-speech emotion push changes the
// resting face). Each flip goes through setEmotion, which re-arms the store's
// 2s self-expiry timer — the 150ms interval always beats it, so expiry can
// never fire mid-speech; it remains only as a backstop if the loop dies
// without cleanup.
export function createTtsLipSyncLoop({ intervalMs = LIP_SYNC_INTERVAL_MS } = {}) {
  let timer = null

  function tick() {
    const s = useStore.getState()
    if (!s.lipSyncTts) {
      stop()
      return
    }
    const base = s.emotion || 'neutral'
    s.setEmotion(s.transientEmotion === 'talking' ? base : 'talking')
  }

  function start() {
    stop()
    timer = setInterval(tick, intervalMs)
  }

  function stop() {
    clearInterval(timer)
    timer = null
  }

  return { start, stop }
}
