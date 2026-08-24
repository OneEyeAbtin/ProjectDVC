import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { INTERACT_MENU, INTERACTIONS, THEME_META, UTILITY_ENTRIES } from './menuData.js'
import './context-menu.css'

const EDGE_PAD = 8

function SectionRow({ label, open, onToggle }) {
  return (
    <button type="button" className="ctx-row ctx-section" aria-expanded={open} onClick={onToggle}>
      <span className="ctx-label">{label}</span>
      <ChevronRight size={13} className={`ctx-chev${open ? ' open' : ''}`} aria-hidden="true" />
    </button>
  )
}

function OptionRow({ label, active, onClick }) {
  return (
    <button type="button" className="ctx-row" onClick={onClick}>
      <span className="ctx-label">{label}</span>
      {active && <Check size={13} className="ctx-check" aria-hidden="true" />}
    </button>
  )
}

export default function ContextMenu() {
  const [pos, setPos] = useState(null)
  const [section, setSection] = useState(null)
  const [groupOpen, setGroupOpen] = useState(null)
  const panelRef = useRef(null)

  const outfits = useStore((s) => s.outfits)
  const personaGroups = useStore((s) => s.personaGroups)
  const currentOutfit = useStore((s) => s.outfit)
  const currentPersona = useStore((s) => s.persona)
  const currentTheme = useStore((s) => s.theme)

  // Keep the panel inside the window once its real size is known.
  useLayoutEffect(() => {
    if (!pos || !panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    const x = Math.min(Math.max(EDGE_PAD, pos.x), window.innerWidth - rect.width - EDGE_PAD)
    const y = Math.min(Math.max(EDGE_PAD, pos.y), window.innerHeight - rect.height - EDGE_PAD)
    if (x !== pos.x || y !== pos.y) setPos({ x, y })
  }, [pos])

  useEffect(() => {
    function onContextMenu(event) {
      if (useStore.getState().settingsOpen) return
      if (!event.target.closest?.('.shell')) return
      event.preventDefault()
      setSection(null)
      setGroupOpen(null)
      setPos({ x: event.clientX, y: event.clientY })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  useEffect(() => {
    if (!pos) return undefined
    function onPointerDown(event) {
      if (panelRef.current && !panelRef.current.contains(event.target)) setPos(null)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setPos(null)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [pos])

  if (!pos) return null

  function toggleSection(name) {
    setGroupOpen(null)
    setSection(section === name ? null : name)
  }

  function close() {
    setPos(null)
  }

  function pickOutfit(name) {
    close()
    useStore.getState().switchOutfit(name)
  }

  function pickPersona(name) {
    close()
    useStore.getState().setPersona(name)
  }

  function pickTheme(id) {
    useStore.getState().setTheme(id)
  }

  function pickInteraction(id) {
    close()
    const text = INTERACTIONS[id] ?? `*I ${String(id).replace(/_/g, ' ')} you.*`
    useStore.getState().sendMsg(text)
  }

  function openSettings() {
    close()
    useStore.getState().setSettingsOpen(true)
  }

  function openUtility(id) {
    close()
    if (id === 'stats') useStore.getState().setStatsOpen(true)
  }

  return (
    <div ref={panelRef} className="glass ctx-menu" role="menu" aria-label="Companion options" style={{ left: pos.x, top: pos.y }}>
      <SectionRow label="👗 Outfits" open={section === 'outfits'} onToggle={() => toggleSection('outfits')} />
      {section === 'outfits' &&
        outfits.map((o) => (
          <OptionRow key={o.prefix || o.name} label={o.name} active={o.name === currentOutfit} onClick={() => pickOutfit(o.name)} />
        ))}

      <div className="ctx-sep" />

      <SectionRow label="🎭 Personas" open={section === 'personas'} onToggle={() => toggleSection('personas')} />
      {section === 'personas' &&
        Object.entries(personaGroups).map(([group, names]) => (
          <div key={group}>
            <button
              type="button"
              className="ctx-row ctx-group-row"
              aria-expanded={groupOpen === group}
              onClick={() => setGroupOpen(groupOpen === group ? null : group)}
            >
              <ChevronRight size={11} className={`ctx-chev${groupOpen === group ? ' open' : ''}`} aria-hidden="true" />
              <span className="ctx-label">{group}</span>
            </button>
            {groupOpen === group &&
              names.map((name) => (
                <div className="ctx-sub" key={name}>
                  <OptionRow label={name} active={name === currentPersona} onClick={() => pickPersona(name)} />
                </div>
              ))}
          </div>
        ))}

      <div className="ctx-sep" />

      <SectionRow label="🎨 Themes" open={section === 'themes'} onToggle={() => toggleSection('themes')} />
      {section === 'themes' && (
        <div className="ctx-theme-grid">
          {THEME_META.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`swatch-cell${t.id === currentTheme ? ' active' : ''}`}
              aria-pressed={t.id === currentTheme}
              title={t.name}
              onClick={() => pickTheme(t.id)}
            >
              <span
                className="swatch-dot"
                style={{ background: `linear-gradient(135deg, ${t.dot[0]}, ${t.dot[1]})` }}
                aria-hidden="true"
              />
              <span className="swatch-name">{t.name}</span>
              {t.id === currentTheme && <Check size={12} className="ctx-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      <div className="ctx-sep" />

      <button type="button" className="ctx-row ctx-section" onClick={openSettings}>
        <span className="ctx-label">⚙ Settings</span>
      </button>

      {UTILITY_ENTRIES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="ctx-row ctx-section"
          onClick={() => openUtility(entry.id)}
        >
          <span className="ctx-label">{entry.label}</span>
        </button>
      ))}

      <SectionRow label="✨ Interact" open={section === 'interact'} onToggle={() => toggleSection('interact')} />
      {section === 'interact' &&
        INTERACT_MENU.map((item) => <OptionRow key={item.id} label={item.label} onClick={() => pickInteraction(item.id)} />)}
    </div>
  )
}
