import { useEffect } from 'react'
import { useStore, useBoot } from './state/store.js'
import { wireSfxEvents } from './lib/sfx.js'
import SetupWizard from './features/setup/SetupWizard.jsx'
import Companion from './features/companion/Companion.jsx'
import ContextMenu from './features/menu/ContextMenu.jsx'
import SettingsOverlay from './features/settings/SettingsOverlay.jsx'
import StatsDialog from './features/stats/StatsDialog.jsx'
import { useVoice } from './features/voice/useVoice.js'

export default function App() {
  useBoot()
  const booted = useStore((s) => s.booted)
  const setupComplete = useStore((s) => s.setupComplete)
  const theme = useStore((s) => s.theme)
  const fontScale = useStore((s) => s.fontScale)
  const bootError = useStore((s) => (s.error?.scope === 'boot' ? s.error : null))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale))
  }, [fontScale])

  // UI sound events (reply notify, stat up/down, error); unsubscribes on unmount.
  useEffect(() => wireSfxEvents(), [])

  // TTS push playback + lip-sync state machine; subscribes once for the app.
  useVoice()

  // Ctrl+, toggles settings globally — even while typing in an input.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key === ',') {
        event.preventDefault()
        const { settingsOpen, setSettingsOpen } = useStore.getState()
        setSettingsOpen(!settingsOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="shell">
      {!booted ? (
        <div className="boot-splash">
          <span className="boot-dot" />
          {bootError && (
            <div className="boot-error" role="alert">
              <p className="boot-error-msg">⚠ {bootError.message}</p>
              <button
                type="button"
                className="btn ghost small"
                aria-label="Retry boot"
                onClick={() => useStore.getState().boot()}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      ) : setupComplete ? (
        <Companion />
      ) : (
        <SetupWizard />
      )}
      <ContextMenu />
      <StatsDialog />
      <SettingsOverlay />
    </div>
  )
}
