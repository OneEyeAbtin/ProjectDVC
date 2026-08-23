import { useEffect, useRef, useState } from 'react'
import { Check, Eye, EyeOff, X } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { THEME_META } from '../menu/menuData.js'
import './settings.css'

const TABS = ['General', 'AI/API', 'Voice', 'Memory']
const BRAIN_MODES = ['local', 'online', 'offline']

function buildSnapshot(state) {
  const cfg = state.config ?? {}
  return {
    user_name: state.userName ?? '',
    pet_name: state.petName ?? '',
    brain_mode: state.brainMode ?? 'online',
    hearts_visible: state.heartsVisible !== false,
    theme_id: state.theme ?? 'midnight-sakura',
    online_api_url: cfg.online_api_url ?? '',
    online_api_key: cfg.online_api_key ?? '',
    online_api_model: cfg.online_api_model ?? '',
    local_api_url: cfg.local_api_url ?? '',
    local_api_key: cfg.local_api_key ?? '',
    local_api_model: cfg.local_api_model ?? ''
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

export default function SettingsOverlay() {
  const open = useStore((s) => s.settingsOpen)
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
      // Cancel path: revert the live theme preview to whatever was last persisted.
      document.documentElement.dataset.theme = persistedTheme.current
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
          {tab === 'Memory' && <p className="tab-placeholder">Memory viewer arrives in Plan 3</p>}
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
