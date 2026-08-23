import { useEffect } from 'react'
import { useStore, useBoot } from './state/store.js'

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
        <div />
      ) : (
        <div />
      )}
    </div>
  )
}
