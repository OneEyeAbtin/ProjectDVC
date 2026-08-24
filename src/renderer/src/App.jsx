import { useEffect } from 'react'
import { useStore, useBoot } from './state/store.js'
import { wireSfxEvents } from './lib/sfx.js'
import SetupWizard from './features/setup/SetupWizard.jsx'
import Companion from './features/companion/Companion.jsx'
import ContextMenu from './features/menu/ContextMenu.jsx'
import SettingsOverlay from './features/settings/SettingsOverlay.jsx'
import StatsDialog from './features/stats/StatsDialog.jsx'

export default function App() {
  useBoot()
  const booted = useStore((s) => s.booted)
  const setupComplete = useStore((s) => s.setupComplete)
  const theme = useStore((s) => s.theme)
  const fontScale = useStore((s) => s.fontScale)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale))
  }, [fontScale])

  // UI sound events (reply notify, stat up/down, error); unsubscribes on unmount.
  useEffect(() => wireSfxEvents(), [])

  // Ctrl+, toggles settings globally — even while typing in an input.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === ',') {
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
