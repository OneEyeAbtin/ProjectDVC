import { useEffect, useRef, useState } from 'react'
import { Check, Eye, EyeOff, Trash2, X } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { THEME_META } from '../menu/menuData.js'
import './settings.css'

const TABS = ['General', 'AI/API', 'Voice', 'Memory']
const BRAIN_MODES = ['local', 'online', 'offline']
const HISTORY_PAGE = 50
const FONT_MIN = 0.85
const FONT_MAX = 1.3

function buildSnapshot(state) {
  const cfg = state.config ?? {}
  return {
    user_name: state.userName ?? '',
    pet_name: state.petName ?? '',
    brain_mode: state.brainMode ?? 'online',
    hearts_visible: state.heartsVisible !== false,
    theme_id: state.theme ?? 'midnight-sakura',
    max_history: Number(cfg.max_history) || 20,
    online_api_url: cfg.online_api_url ?? '',
    online_api_key: cfg.online_api_key ?? '',
    online_api_model: cfg.online_api_model ?? '',
    local_api_url: cfg.local_api_url ?? '',
    local_api_key: cfg.local_api_key ?? '',
    local_api_model: cfg.local_api_model ?? '',
    always_on_top: cfg.always_on_top !== false,
    tray_enabled: cfg.tray_enabled !== false,
    ui_sounds: cfg.ui_sounds !== false,
    font_scale: Number(state.fontScale) || 1
  }
}

function TextField({ id, label, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function SecretField({ id, label, value, onChange }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="secret-field">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn reveal-btn"
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={revealed}
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  )
}

function useArmTimeout(ms = 3000) {
  const [armed, setArmed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  function press(onConfirm) {
    if (!armed) {
      setArmed(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setArmed(false), ms)
      return
    }
    clearTimeout(timer.current)
    setArmed(false)
    onConfirm()
  }
  return { armed, press }
}

// Destructive actions need two clicks: the first arms (red "Really?" label,
// auto-disarms after 3s), the second executes. Async actions disable the
// button until they settle so a slow IPC can't be double-fired.
function ConfirmButton({ className = '', confirmLabel = 'Really?', ariaLabel, onConfirm, children }) {
  const { armed, press } = useArmTimeout()
  const [pending, setPending] = useState(false)
  function handleClick() {
    if (pending) return
    press(() => {
      const result = onConfirm?.()
      if (result && typeof result.then === 'function') {
        setPending(true)
        result.then(
          () => setPending(false),
          () => setPending(false)
        )
      }
    })
  }
  return (
    <button
      type="button"
      className={armed ? `${className} confirm-armed` : className}
      aria-label={ariaLabel}
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={handleClick}
    >
      {armed ? confirmLabel : children}
    </button>
  )
}

function TraitList({ items, emptyText, deleteAriaPrefix, onDelete }) {
  if (!items.length) return <p className="mem-empty">{emptyText}</p>
  return (
    <ul className="mem-list">
      {items.map((text) => (
        <li className="mem-item" key={text}>
          <span className="mem-item-text">{text}</span>
          <ConfirmButton
            className="mem-del"
            ariaLabel={`${deleteAriaPrefix}: ${text}`}
            onConfirm={() => onDelete(text)}
          >
            <Trash2 size={13} />
          </ConfirmButton>
        </li>
      ))}
    </ul>
  )
}

function HistoryViewer() {
  const petName = useStore((s) => s.petName)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState([])

  async function toggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setLoading(true)
    try {
      const res = await window.dvc.invoke('history:get')
      setEntries(Array.isArray(res?.history) ? res.history : [])
      setExpanded(true)
    } catch (err) {
      useStore.getState().setError({ scope: 'history', message: String(err?.message ?? err) })
    } finally {
      setLoading(false)
    }
  }

  async function clear() {
    try {
      await window.dvc.invoke('history:clear')
      setEntries([])
      useStore.setState({ historyCount: 0 })
    } catch (err) {
      useStore.getState().setError({ scope: 'history', message: String(err?.message ?? err) })
    }
  }

  const shown = entries.slice(-HISTORY_PAGE)
  const hiddenCount = entries.length - shown.length

  return (
    <div className="history-viewer">
      <div className="hist-toggle-row">
        <button
          type="button"
          className="btn ghost small"
          aria-expanded={expanded}
          disabled={loading}
          onClick={toggle}
        >
          {loading ? 'Loading…' : expanded ? 'Hide history' : 'Show history'}
        </button>
        {expanded && (
          <ConfirmButton className="btn ghost small" ariaLabel="Clear chat history" onConfirm={clear}>
            Clear history
          </ConfirmButton>
        )}
      </div>
      {expanded &&
        (entries.length ? (
          <ul className="hist-lines">
            {hiddenCount > 0 && <li className="hist-note">…older hidden</li>}
            {shown.map((m, i) => (
              <li
                className={`hist-line ${m?.role === 'user' ? 'user' : 'assistant'}`}
                key={i}
              >
                <span className="hist-role">
                  {m?.role === 'user' ? 'You' : petName || 'Assistant'}:
                </span>
                <span className="hist-text">{String(m?.content ?? '')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mem-empty">(none yet)</p>
        ))}
    </div>
  )
}

export default function SettingsOverlay() {
  const open = useStore((s) => s.settingsOpen)
  const traits = useStore((s) => s.traits)
  const permanentFacts = useStore((s) => s.permanentFacts)
  const sessionSummary = useStore((s) => s.sessionSummary)
  const [tab, setTab] = useState('General')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const snapshot = useRef(null)
  const persistedTheme = useRef('')
  const restoreFocus = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    snapshot.current = buildSnapshot(useStore.getState())
    persistedTheme.current = snapshot.current.theme_id
    setDraft(snapshot.current)
    setTab('General')
    setSaving(false)
    restoreFocus.current = document.activeElement
    requestAnimationFrame(() => dialogRef.current?.focus())

    function onKeyDown(event) {
      if (event.key === 'Escape') useStore.getState().setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      // Cancel path: revert the live previews to whatever was last persisted.
      document.documentElement.dataset.theme = persistedTheme.current
      document.documentElement.style.setProperty(
        '--font-scale',
        String(useStore.getState().fontScale)
      )
      restoreFocus.current?.focus?.()
    }
  }, [open])

  if (!open || !draft) return null

  function setField(key, value) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function previewTheme(id) {
    setField('theme_id', id)
    document.documentElement.dataset.theme = id
  }

  // Live preview while the slider drags; persisted only on Save.
  function previewFontScale(value) {
    setField('font_scale', value)
    document.documentElement.style.setProperty('--font-scale', String(value))
  }

  function cancel() {
    useStore.getState().setSettingsOpen(false)
  }

  async function save() {
    if (!draft || !snapshot.current || saving) return
    const patch = {}
    for (const [key, value] of Object.entries(draft)) {
      if (value !== snapshot.current[key]) patch[key] = value
    }
    if (!Object.keys(patch).length) {
      cancel()
      return
    }
    setSaving(true)
    try {
      await window.dvc.invoke('profile:save', patch)
      if ('theme_id' in patch) persistedTheme.current = patch.theme_id
      useStore.getState().setSettingsOpen(false)
    } catch (err) {
      useStore.getState().setError({ scope: 'profile', message: String(err?.message ?? err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={dialogRef}>
      <div className="glass settings-panel">
        <header className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={cancel}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={`settings-tab${tab === name ? ' active' : ''}`}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="settings-body" role="tabpanel" aria-label={`${tab} settings`}>
          {tab === 'General' && (
            <>
              <TextField
                id="settings-user-name"
                label="Your name"
                value={draft.user_name}
                onChange={(v) => setField('user_name', v)}
              />
              <TextField
                id="settings-pet-name"
                label="Companion name"
                value={draft.pet_name}
                onChange={(v) => setField('pet_name', v)}
              />

              <div className="field">
                <span className="field-label" id="brain-mode-label">Brain mode</span>
                <div className="segmented" role="group" aria-labelledby="brain-mode-label">
                  {BRAIN_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`seg${draft.brain_mode === mode ? ' active' : ''}`}
                      aria-pressed={draft.brain_mode === mode}
                      onClick={() => setField('brain_mode', mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.hearts_visible}
                  onChange={(e) => setField('hearts_visible', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Show affection hearts</span>
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.always_on_top}
                  onChange={(e) => setField('always_on_top', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Always on top</span>
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.tray_enabled}
                  onChange={(e) => setField('tray_enabled', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Tray icon</span>
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.ui_sounds}
                  onChange={(e) => setField('ui_sounds', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">UI sounds</span>
              </label>

              <div className="field">
                <label htmlFor="font-scale-slider">Text size</label>
                <div className="limit-row">
                  <input
                    id="font-scale-slider"
                    type="range"
                    min={FONT_MIN}
                    max={FONT_MAX}
                    step={0.05}
                    value={draft.font_scale}
                    aria-valuetext={`${draft.font_scale.toFixed(2)} times`}
                    onChange={(e) => previewFontScale(Number(e.target.value))}
                  />
                  <output id="font-scale-value" className="limit-value" htmlFor="font-scale-slider">
                    {draft.font_scale.toFixed(2)}×
                  </output>
                </div>
              </div>

              <div className="field">
                <span className="field-label">Theme</span>
                <div className="theme-grid">
                  {THEME_META.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`swatch-cell${draft.theme_id === t.id ? ' active' : ''}`}
                      aria-pressed={draft.theme_id === t.id}
                      onClick={() => previewTheme(t.id)}
                    >
                      <span
                        className="swatch-dot"
                        style={{ background: `linear-gradient(135deg, ${t.dot[0]}, ${t.dot[1]})` }}
                        aria-hidden="true"
                      />
                      <span className="swatch-name">{t.name}</span>
                      {draft.theme_id === t.id && <Check size={12} className="ctx-check" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>

              <h3 className="section-title danger-title">Danger zone</h3>
              <div className="danger-zone">
                <ConfirmButton
                  className="btn ghost small danger-btn"
                  confirmLabel="Really redo setup?"
                  ariaLabel="Redo setup wizard"
                  onConfirm={async () => {
                    await useStore.getState().redoSetup()
                    useStore.getState().setSettingsOpen(false)
                  }}
                >
                  Redo setup wizard
                </ConfirmButton>
                <ConfirmButton
                  className="btn ghost small danger-btn"
                  confirmLabel="Really erase everything?"
                  ariaLabel="Factory reset"
                  onConfirm={async () => {
                    try {
                      await window.dvc.invoke('profile:factory-reset')
                      window.location.reload()
                    } catch (err) {
                      useStore.getState().setError({ scope: 'profile', message: String(err?.message ?? err) })
                    }
                  }}
                >
                  Factory reset
                </ConfirmButton>
                <p className="danger-note">
                  Redo restarts the setup wizard. Factory reset erases all data and reloads the app.
                  Neither can be undone.
                </p>
              </div>
            </>
          )}

          {tab === 'AI/API' && (
            <>
              <h3 className="section-title">Online API</h3>
              <TextField
                id="online-api-url"
                label="Base URL"
                value={draft.online_api_url}
                placeholder="https://api.openai.com/v1/chat/completions"
                onChange={(v) => setField('online_api_url', v)}
              />
              <SecretField
                id="online-api-key"
                label="API key"
                value={draft.online_api_key}
                onChange={(v) => setField('online_api_key', v)}
              />
              <TextField
                id="online-api-model"
                label="Model"
                value={draft.online_api_model}
                placeholder="gpt-4o-mini"
                onChange={(v) => setField('online_api_model', v)}
              />

              <h3 className="section-title">Local API</h3>
              <TextField
                id="local-api-url"
                label="Base URL"
                value={draft.local_api_url}
                placeholder="http://localhost:1234/v1/chat/completions"
                onChange={(v) => setField('local_api_url', v)}
              />
              <SecretField
                id="local-api-key"
                label="API key"
                value={draft.local_api_key}
                onChange={(v) => setField('local_api_key', v)}
              />
              <TextField
                id="local-api-model"
                label="Model"
                value={draft.local_api_model}
                placeholder="local-model"
                onChange={(v) => setField('local_api_model', v)}
              />
            </>
          )}

          {tab === 'Voice' && <p className="tab-placeholder">Voice arrives in Plan 2</p>}
          {tab === 'Memory' && (
            <>
              <h3 className="section-title">Session traits</h3>
              <TraitList
                items={traits}
                emptyText="(none yet)"
                deleteAriaPrefix="Delete trait"
                onDelete={(text) => useStore.getState().deleteTrait(text)}
              />
              <ConfirmButton
                className="btn ghost small"
                ariaLabel="Wipe all session traits"
                onConfirm={() => useStore.getState().wipeTraits()}
              >
                Wipe all
              </ConfirmButton>

              <h3 className="section-title">Permanent facts</h3>
              <TraitList
                items={permanentFacts}
                emptyText="(none yet)"
                deleteAriaPrefix="Delete fact"
                onDelete={(text) => useStore.getState().deletePermanentFact(text)}
              />
              <ConfirmButton
                className="btn ghost small"
                ariaLabel="Wipe all permanent facts"
                onConfirm={() => useStore.getState().wipePermanentFacts()}
              >
                Wipe all
              </ConfirmButton>

              <h3 className="section-title">Session summary</h3>
              <p className={`summary-text${sessionSummary ? '' : ' summary-empty'}`}>
                {sessionSummary || '(none yet)'}
              </p>
              <ConfirmButton
                className="btn ghost small"
                ariaLabel="Clear session summary"
                onConfirm={() => useStore.getState().clearSummary()}
              >
                Clear
              </ConfirmButton>

              <h3 className="section-title">Chat history</h3>
              <HistoryViewer />

              <div className="field">
                <label htmlFor="memory-limit-slider">Message limit</label>
                <div className="limit-row">
                  <input
                    id="memory-limit-slider"
                    type="range"
                    min={4}
                    max={50}
                    step={1}
                    value={draft.max_history}
                    onChange={(e) => setField('max_history', Number(e.target.value))}
                  />
                  <output id="memory-limit-value" className="limit-value" htmlFor="memory-limit-slider">
                    {draft.max_history}
                  </output>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="settings-foot">
          <button type="button" className="btn ghost" onClick={cancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}
