import { useEffect } from 'react'
import { useStore } from '../../state/store.js'
import { createTtsLipSyncLoop } from './lipSyncLoop.js'

// Module-level singleton, created lazily: one <audio> element shared by every
// hook consumer (App mounts this hook exactly once in practice).
let audio = null

// voice.service emits absolute cache paths under <root>/data/tts-cache; the
// dvc-media protocol mounts that dir at `tts-cache`, so only the basename is
// needed (cache names are tts_<n>.mp3|.wav — encoding is belt-and-braces).
function mediaUrl(absolutePath) {
  const file = String(absolutePath).split(/[\\/]/).pop()
  return `dvc-media:///tts-cache/${encodeURIComponent(file)}`
}

export function useVoice() {
  useEffect(() => {
    if (!window.dvc || typeof Audio === 'undefined') return undefined
    if (!audio) audio = new Audio()
    const el = audio
    const loop = createTtsLipSyncLoop()

    // Shared end-state for natural end, load/play failure and unmount.
    function settle() {
      loop.stop()
      useStore.setState({ audioPlaying: false, transientEmotion: null })
    }

    function onEnded() {
      settle()
    }
    function onError() {
      settle()
    }
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)

    const unsubTts = window.dvc.on('tts', (payload) => {
      if (!payload) return
      if (payload.error) {
        // Synthesis failure says nothing about audio already playing; only
        // surface the chip when voice is enabled (never nag when disabled).
        const { config, setError } = useStore.getState()
        if (config?.tts_config?.enabled) {
          setError({ scope: 'voice', message: `Voice failed: ${payload.error}` })
        }
        return
      }
      if (payload.unsupported || !payload.path) return
      // A new push restarts playback and the lip-sync loop from scratch.
      loop.stop()
      el.src = mediaUrl(payload.path)
      useStore.setState({ audioPlaying: true })
      el.play()
        .then(() => loop.start())
        .catch(() => settle())
    })

    // New reply incoming → stale speech stops immediately. The fresh clip
    // arrives via its own tts push a moment later (autoSpeak fires after the
    // reply push), so no explicit voice:stop invoke is needed here.
    const unsubReply = window.dvc.on('reply', () => {
      el.pause()
      settle()
    })

    return () => {
      unsubTts()
      unsubReply()
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
      loop.stop()
      el.pause()
      useStore.setState({ audioPlaying: false, transientEmotion: null })
    }
  }, [])
}
