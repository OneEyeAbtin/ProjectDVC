import { useEffect } from 'react'
import { useStore, useBoot } from './state/store.js'
import SetupWizard from './features/setup/SetupWizard.jsx'
import Companion from './features/companion/Companion.jsx'
import ContextMenu from './features/menu/ContextMenu.jsx'

export default function App() {
  useBoot()
  const booted = useStore((s) => s.booted)
  const setupComplete = useStore((s) => s.setupComplete)
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

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
    </div>
  )
}
