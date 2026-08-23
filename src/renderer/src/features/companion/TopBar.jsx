import { useEffect, useRef, useState } from 'react'
import { Heart, Settings, X } from 'lucide-react'
import { useStore } from '../../state/store.js'

// Ported from legacy _upd_hearts color stages.
export function heartColors(affection) {
  return {
    fill:
      affection < 30 ? '#9575cd'
      : affection < 50 ? '#f48fb1'
      : affection < 70 ? '#ff6b9d'
      : affection < 90 ? '#ff4081'
      : '#ffd700',
    empty: affection < 30 ? '#2a1a3d' : '#3a2a50'
  }
}

function HeartUnit({ fraction, fill, empty }) {
  return (
    <span className="heart-unit" style={{ color: empty }}>
      <Heart size={13} strokeWidth={0} fill="currentColor" />
      {fraction > 0 && (
        <span className="heart-fill" style={{ width: fraction >= 1 ? '100%' : '55%', color: fill }}>
          <Heart size={13} strokeWidth={0} fill="currentColor" />
        </span>
      )}
    </span>
  )
}

export default function TopBar() {
  const petName = useStore((s) => s.petName)
  const stats = useStore((s) => s.stats)
  const heartsVisible = useStore((s) => s.heartsVisible)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const affection = Math.max(0, Math.min(100, Number(stats?.affection ?? 0)))
  const { fill, empty } = heartColors(affection)
  const full = Math.floor(affection / 10)
  const half = affection % 10 >= 5

  const prev = useRef(affection)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (prev.current !== affection) {
      prev.current = affection
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 320)
      return () => clearTimeout(t)
    }
    return undefined
  }, [affection])

  return (
    <header className="topbar">
      <div className={`hearts${pulse ? ' hearts-pulse' : ''}`} aria-label={`Affection ${affection}/100`}>
        {heartsVisible &&
          Array.from({ length: 10 }, (_, i) => (
            <HeartUnit
              key={i}
              fraction={i < full ? 1 : i === full && half ? 0.5 : 0}
              fill={fill}
              empty={empty}
            />
          ))}
      </div>
      <h1 className="pet-name">{petName}</h1>
      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Close"
          aria-label="Close"
          onClick={() => window.close()}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  )
}
