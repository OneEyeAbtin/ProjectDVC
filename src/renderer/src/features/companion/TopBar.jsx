import { useEffect, useRef, useState } from 'react'
import { ArrowDownFromLine, BarChart3, Heart, Settings, X } from 'lucide-react'
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

let chipSeq = 0
const CHIP_LIFETIME = 900 // ms, matches the chip-float keyframe
const CHIP_CAP = 5

// Ephemeral "+N" / "-N" floaters spawned when a stats push changes values.
// Purely visual: the statUp/statDown sfx is wired once in lib/sfx.js — no
// sound here, so nothing can double-fire.
function StatChips({ stats }) {
  const [chips, setChips] = useState([])
  const prevRef = useRef(null)
  const timersRef = useRef(new Set())

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer)
    },
    []
  )

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = stats
    if (!prev || !stats || prev === stats) return undefined
    // Biggest 1-3 absolute deltas per push.
    const deltas = Object.keys(stats)
      .map((key) => ({ delta: (Number(stats[key]) || 0) - (Number(prev[key]) || 0) }))
      .filter((entry) => Number.isFinite(entry.delta) && entry.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3)
    if (!deltas.length) return undefined
    const spawned = deltas.map(({ delta }, i) => {
      const id = ++chipSeq
      const timer = setTimeout(() => {
        timersRef.current.delete(timer)
        setChips((list) => list.filter((chip) => chip.id !== id))
      }, CHIP_LIFETIME)
      timersRef.current.add(timer)
      return {
        id,
        text: `${delta > 0 ? '+' : ''}${delta}`,
        up: delta > 0,
        offset: i * 16 + Math.round(Math.random() * 10)
      }
    })
    setChips((list) => [...list, ...spawned].slice(-CHIP_CAP))
    return undefined
  }, [stats])

  return (
    <span className="stat-chips" aria-hidden="true">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className={`stat-chip ${chip.up ? 'up' : 'down'}`}
          style={{ marginLeft: `${chip.offset}px` }}
        >
          {chip.text}
        </span>
      ))}
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
        <StatChips stats={stats} />
      </div>
      <h1 className="pet-name">{petName}</h1>
      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          title="Stats"
          aria-label="Stats"
          onClick={() => useStore.getState().setStatsOpen(true)}
        >
          <BarChart3 size={15} />
        </button>
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
          title="Minimize to tray"
          aria-label="Minimize to tray"
          onClick={() => window.dvc.invoke('win:hide').catch(() => {})}
        >
          <ArrowDownFromLine size={15} />
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
