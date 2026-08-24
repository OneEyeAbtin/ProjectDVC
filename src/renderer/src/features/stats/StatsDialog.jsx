import { useEffect, useRef } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { useStore } from '../../state/store.js'
import './stats.css'

export function barColor(value) {
  if (value >= 70) return '#ffd700'
  if (value >= 30) return 'var(--acc1)'
  return 'var(--acc3)'
}

export default function StatsDialog() {
  const open = useStore((s) => s.statsOpen)
  const stats = useStore((s) => s.stats)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const restoreFocus = document.activeElement
    requestAnimationFrame(() => dialogRef.current?.focus())

    function onKeyDown(event) {
      if (event.key === 'Escape') useStore.getState().setStatsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreFocus?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="stats-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Stats"
      tabIndex={-1}
      ref={dialogRef}
    >
      <div className="glass stats-panel">
        <header className="stats-head">
          <h2>Stats</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close stats"
            onClick={() => useStore.getState().setStatsOpen(false)}
          >
            <X size={16} />
          </button>
        </header>

        <div className="stats-body">
          {Object.entries(stats).map(([key, raw]) => {
            const value = Math.max(0, Math.min(100, Number(raw) || 0))
            const name = String(key).replace(/_/g, ' ')
            const label = name.charAt(0).toUpperCase() + name.slice(1)
            return (
              <div className="stat-row" key={key}>
                <span className="stat-name" title={label}>{label}</span>
                <div className="stat-track" aria-hidden="true">
                  <div
                    className="stat-fill"
                    style={{ width: `${value}%`, background: barColor(value) }}
                  />
                </div>
                <span className="stat-value">{value}</span>
                <button
                  type="button"
                  className="stat-btn"
                  aria-label={`Decrease ${label} by 5`}
                  disabled={value <= 0}
                  onClick={() => useStore.getState().adjustStat(key, -5)}
                >
                  <Minus size={13} />
                </button>
                <button
                  type="button"
                  className="stat-btn"
                  aria-label={`Increase ${label} by 5`}
                  disabled={value >= 100}
                  onClick={() => useStore.getState().adjustStat(key, 5)}
                >
                  <Plus size={13} />
                </button>
              </div>
            )
          })}
          {!Object.keys(stats).length && <p className="stats-empty">No stats yet</p>}
        </div>
      </div>
    </div>
  )
}
