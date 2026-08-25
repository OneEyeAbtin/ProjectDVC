import { useEffect, useRef, useState } from 'react'
import { Check, Download, Eye, EyeOff, Trash2, Upload, X } from 'lucide-react'
import { useStore } from '../../state/store.js'
import { THEME_META } from '../menu/menuData.js'
import {
  buildSnapshot,
  diffPatch,
  EDGE_VOICE_SUGGESTIONS,
  TEST_EMOTIONS,
  TEST_VOICE_LINE,
  TTS_ENGINES
} from './settingsDraft.js'
import './settings.css'
import { GRADIENT_PRESETS, sanitizeGradient } from './background.js'
import { PARTICLE_THEME_META, sanitizeParticleTheme } from '../ambient/particleThemes.js'
import {
  ANIMATION_SPEED_MAX,
  ANIMATION_SPEED_MIN,
  ANIMATION_SPEED_STEP,
  sanitizeAnimationSpeed
} from '../ambient/animationSpeed.js'

const TABS = ['General', 'AI/API', 'Voice', '⛏ MC', 'Memory']
const BRAIN_MODES = ['local', 'online', 'offline']
const MC_AUTH_MODES = ['offline', 'microsoft']
const MC_AI_FEATURES = [
  { key: 'ai_hash_chat', label: 'Brain replies to # chat' },
  { key: 'ai_advancements', label: 'Brain comments on advancements' },
  { key: 'ai_task_done', label: 'Brain comments on finished tasks' },
  { key: 'ai_events', label: 'Brain comments on events' }
]
const HISTORY_PAGE = 50
const FONT_MIN = 0.85
const FONT_MAX = 1.3

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
      {pending ? '…' : armed ? confirmLabel : children}
    </button>
  )
}

// Tiny "✓ saved" flicker for auto-saved rows: rendered once a save for the
// key has resolved; the internal key remounts the span on every bump so the
// CSS animation replays (no component-side timers).
function SavedFlash({ seq }) {
  if (!seq) return null
  return (
    <span key={seq} className="save-flash" aria-hidden="true">
      ✓ saved
    </span>
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
  const piperVoices = useStore((s) => s.piperVoices)
  // Live appearance/behavior values: auto-save controls render straight from
  // the store (never the draft) and persist immediately on change.
  const savedSeq = useStore((s) => s.liveSavedSeq)
  const liveTheme = useStore((s) => s.theme)
  const liveFontScale = useStore((s) => s.fontScale)
  const liveHeartsVisible = useStore((s) => s.heartsVisible !== false)
  const liveUiSounds = useStore((s) => s.config?.ui_sounds !== false)
  const liveAlwaysOnTop = useStore((s) => s.config?.always_on_top !== false)
  const liveTrayEnabled = useStore((s) => s.config?.tray_enabled !== false)
  const liveIdleChat = useStore((s) => s.config?.idle_chat !== false)
  const liveAmbientEffects = useStore((s) => s.config?.ambient_effects !== false)
  const liveAnimationSpeed = useStore((s) => sanitizeAnimationSpeed(s.config?.animation_speed))
  const liveParticleTheme = useStore((s) => sanitizeParticleTheme(s.config?.particle_theme))
  const liveGradientCfg = useStore((s) => s.config?.custom_gradient)
  const [tab, setTab] = useState('General')
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testEmotion, setTestEmotion] = useState('neutral')
  const [testing, setTesting] = useState(false)
  const snapshot = useRef(null)
  const restoreFocus = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    snapshot.current = buildSnapshot(useStore.getState())
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
      // Close path (Save, Cancel, ✕, Escape): settle any pending auto-saves
      // so an applied value is never stranded unpersisted. No preview revert
      // here — every live setting already IS the persisted store state.
      useStore.getState().flushLiveSaves()
      restoreFocus.current?.focus?.()
    }
  }, [open])

  if (!open || !draft) return null

  // Test voice uses the SAVED config; any unsaved draft edit means the sample
  // would not reflect what the user sees, so the button waits for a Save.
  // Auto-saved keys are excluded by diffPatch — they are already saved.
  const draftDirty = Object.keys(diffPatch(draft, snapshot.current)).length > 0

  // Normalized once per render: config may hold a partial gradient, but the
  // whole-object auto-save always sends a complete one.
  const gradient = sanitizeGradient(liveGradientCfg)

  function setField(key, value) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function saveLive(key, value) {
    useStore.getState().saveLiveSetting(key, value)
  }

  function saveGradient(patch) {
    saveLive('custom_gradient', { ...gradient, ...patch })
  }

  // Nested objects are replaced whole: any subfield edit produces a new
  // object reference so the snapshot diff sends it as one replacement.
  function setTtsField(key, value) {
    setDraft((d) => ({ ...d, tts_config: { ...d.tts_config, [key]: value } }))
  }

  function setElevenlabsField(key, value) {
    setDraft((d) => ({ ...d, elevenlabs: { ...d.elevenlabs, [key]: value } }))
  }

  // minecraft_v2 is replaced whole on Save, same as tts_config.
  function setMcField(key, value) {
    setDraft((d) => ({ ...d, minecraft_v2: { ...d.minecraft_v2, [key]: value } }))
  }

  function setMcAiFeature(key, value) {
    setDraft((d) => ({
      ...d,
      minecraft_v2: { ...d.minecraft_v2, ai_features: { ...d.minecraft_v2.ai_features, [key]: value } }
    }))
  }

  function cancel() {
    useStore.getState().setSettingsOpen(false)
  }

  async function testVoice() {
    if (testing || draftDirty) return
    setTesting(true)
    try {
      await window.dvc.invoke('voice:speak', { text: TEST_VOICE_LINE, emotion: testEmotion })
    } catch (err) {
      useStore.getState().setError({ scope: 'voice', message: String(err?.message ?? err) })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    if (!draft || !snapshot.current || saving) return
    setSaving(true)
    try {
      // Settle pending auto-saves first: the flush cancels their debounce
      // timers, so they can never double-fire after this manual Save closes
      // the overlay. Auto keys themselves are excluded from the diff below.
      await useStore.getState().flushLiveSaves()
      const patch = diffPatch(draft, snapshot.current)
      if (Object.keys(patch).length) {
        await window.dvc.invoke('profile:save', patch)
      }
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
                  checked={liveHeartsVisible}
                  onChange={(e) => saveLive('hearts_visible', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Show affection hearts</span>
                <SavedFlash seq={savedSeq.hearts_visible} />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={liveAlwaysOnTop}
                  onChange={(e) => saveLive('always_on_top', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Always on top</span>
                <SavedFlash seq={savedSeq.always_on_top} />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={liveTrayEnabled}
                  onChange={(e) => saveLive('tray_enabled', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Tray icon</span>
                <SavedFlash seq={savedSeq.tray_enabled} />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={liveUiSounds}
                  onChange={(e) => saveLive('ui_sounds', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">UI sounds</span>
                <SavedFlash seq={savedSeq.ui_sounds} />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={liveIdleChat}
                  onChange={(e) => saveLive('idle_chat', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Idle chatter</span>
                <SavedFlash seq={savedSeq.idle_chat} />
              </label>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={liveAmbientEffects}
                  onChange={(e) => saveLive('ambient_effects', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Ambient effects</span>
                <SavedFlash seq={savedSeq.ambient_effects} />
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
                    value={liveFontScale}
                    aria-valuetext={`${liveFontScale.toFixed(2)} times`}
                    onChange={(e) => saveLive('font_scale', Number(e.target.value))}
                  />
                  <output id="font-scale-value" className="limit-value" htmlFor="font-scale-slider">
                    {liveFontScale.toFixed(2)}×
                  </output>
                </div>
                <SavedFlash seq={savedSeq.font_scale} />
              </div>

              <div className="field">
                <span className="field-label">Theme</span>
                <div className="theme-grid">
                  {THEME_META.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`swatch-cell${liveTheme === t.id ? ' active' : ''}`}
                      aria-pressed={liveTheme === t.id}
                      onClick={() => saveLive('theme_id', t.id)}
                    >
                      <span
                        className="swatch-dot"
                        style={{ background: `linear-gradient(135deg, ${t.dot[0]}, ${t.dot[1]})` }}
                        aria-hidden="true"
                      />
                      <span className="swatch-name">{t.name}</span>
                      {liveTheme === t.id && <Check size={12} className="ctx-check" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                <SavedFlash seq={savedSeq.theme_id} />
              </div>

              <h3 className="section-title">Background</h3>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={gradient.enabled}
                  aria-label="Custom background gradient"
                  onChange={(e) => saveGradient({ enabled: e.target.checked })}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Custom background gradient</span>
                <SavedFlash seq={savedSeq.custom_gradient} />
              </label>
              {/* Live source readout: which gradient the shell is actually
                  wearing right now (theme-built-in vs custom override). */}
              <p className="gradient-src" role="note">
                {gradient.enabled
                  ? 'Custom override'
                  : `Following theme: ${
                      THEME_META.find((t) => t.id === liveTheme)?.name ?? liveTheme
                    }`}
              </p>

              <div className="gradient-row">
                <div className="field">
                  <label htmlFor="grad-from">From</label>
                  <input
                    id="grad-from"
                    type="color"
                    value={gradient.from}
                    aria-label="Gradient start color"
                    onChange={(e) => saveGradient({ from: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="grad-to">To</label>
                  <input
                    id="grad-to"
                    type="color"
                    value={gradient.to}
                    aria-label="Gradient end color"
                    onChange={(e) => saveGradient({ to: e.target.value })}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="grad-angle-slider">Angle</label>
                <div className="limit-row">
                  <input
                    id="grad-angle-slider"
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    value={gradient.angle}
                    aria-valuetext={`${gradient.angle} degrees`}
                    onChange={(e) => saveGradient({ angle: Number(e.target.value) })}
                  />
                  <output id="grad-angle-value" className="limit-value" htmlFor="grad-angle-slider">
                    {gradient.angle}°
                  </output>
                </div>
              </div>

              <div className="field">
                <span className="field-label">Presets</span>
                <div className="preset-grid" role="group" aria-label="Gradient presets">
                  {GRADIENT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className={
                        'preset-swatch' +
                        (gradient.from === preset.from && gradient.to === preset.to ? ' active' : '')
                      }
                      style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                      title={preset.name}
                      aria-label={`${preset.name} gradient preset`}
                      onClick={() =>
                        saveLive('custom_gradient', {
                          ...gradient,
                          enabled: true,
                          from: preset.from,
                          to: preset.to
                        })
                      }
                    />
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">Animation speed</span>
                <div className="limit-row">
                  <input
                    id="anim-speed-slider"
                    type="range"
                    min={ANIMATION_SPEED_MIN}
                    max={ANIMATION_SPEED_MAX}
                    step={ANIMATION_SPEED_STEP}
                    value={liveAnimationSpeed}
                    aria-valuetext={`${liveAnimationSpeed} times`}
                    aria-label="Ambient animation speed"
                    onChange={(e) => saveLive('animation_speed', Number(e.target.value))}
                  />
                  <output id="anim-speed-value" className="limit-value" htmlFor="anim-speed-slider">
                    {liveAnimationSpeed}×
                  </output>
                </div>
                <SavedFlash seq={savedSeq.animation_speed} />
              </div>

              <div className="field">
                <span className="field-label">Particle effect</span>
                <div className="particle-chip-grid" role="group" aria-labelledby="particle-theme-label">
                  {PARTICLE_THEME_META.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={'particle-chip' + (liveParticleTheme === theme.id ? ' active' : '')}
                      aria-pressed={liveParticleTheme === theme.id}
                      onClick={() => saveLive('particle_theme', theme.id)}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
                <SavedFlash seq={savedSeq.particle_theme} />
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

          {tab === 'Voice' && (
            <>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.tts_config.enabled}
                  aria-label="Speak replies aloud"
                  onChange={(e) => setTtsField('enabled', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Speak replies aloud</span>
              </label>

              <div className="field">
                <span className="field-label" id="tts-engine-label">Voice engine</span>
                <div className="segmented" role="group" aria-labelledby="tts-engine-label">
                  {TTS_ENGINES.map((engine) => (
                    <button
                      key={engine}
                      type="button"
                      className={`seg${draft.tts_config.engine === engine ? ' active' : ''}`}
                      aria-pressed={draft.tts_config.engine === engine}
                      onClick={() => setTtsField('engine', engine)}
                    >
                      {engine}
                    </button>
                  ))}
                </div>
              </div>

              {draft.tts_config.engine === 'elevenlabs' && (
                <>
                  <SecretField
                    id="elevenlabs-api-key"
                    label="ElevenLabs API key"
                    value={draft.elevenlabs.api_key}
                    onChange={(v) => setElevenlabsField('api_key', v)}
                  />
                  <TextField
                    id="elevenlabs-voice-id"
                    label="Voice ID"
                    value={draft.elevenlabs.voice_id}
                    onChange={(v) => setElevenlabsField('voice_id', v)}
                  />
                  <TextField
                    id="elevenlabs-model-id"
                    label="Model"
                    placeholder="eleven_flash_v2_5"
                    value={draft.elevenlabs.model_id}
                    onChange={(v) => setElevenlabsField('model_id', v)}
                  />
                </>
              )}

              {draft.tts_config.engine === 'edge' && (
                <div className="field">
                  <label htmlFor="edge-voice-input">Edge voice</label>
                  <input
                    id="edge-voice-input"
                    type="text"
                    list="edge-voice-suggestions"
                    value={draft.tts_config.edge_voice}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Edge voice name"
                    onChange={(e) => setTtsField('edge_voice', e.target.value)}
                  />
                  <datalist id="edge-voice-suggestions">
                    {EDGE_VOICE_SUGGESTIONS.map((voice) => (
                      <option key={voice} value={voice} />
                    ))}
                  </datalist>
                </div>
              )}

              {draft.tts_config.engine === 'piper' && (
                <div className="field">
                  <label htmlFor="piper-voice-select">Piper voice</label>
                  <select
                    id="piper-voice-select"
                    value={draft.tts_config.piper_voice}
                    aria-label="Piper voice model"
                    onChange={(e) => setTtsField('piper_voice', e.target.value)}
                  >
                    {!piperVoices.length && (
                      <option value="" disabled>
                        (none found)
                      </option>
                    )}
                    {piperVoices.map((voice) => (
                      <option key={voice} value={voice}>
                        {voice}
                      </option>
                    ))}
                    {draft.tts_config.piper_voice && !piperVoices.includes(draft.tts_config.piper_voice) && (
                      <option value={draft.tts_config.piper_voice}>
                        {draft.tts_config.piper_voice} (missing)
                      </option>
                    )}
                  </select>
                </div>
              )}

              <h3 className="section-title">Lip-sync</h3>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.lip_sync_tts}
                  aria-label="Animate mouth during spoken replies"
                  onChange={(e) => setField('lip_sync_tts', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Animate while speaking</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.lip_sync_text}
                  aria-label="Animate mouth while text types out"
                  onChange={(e) => setField('lip_sync_text', e.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Animate while typing</span>
              </label>

              <h3 className="section-title">Test voice</h3>
              <div className="field">
                <label htmlFor="test-voice-emotion">Emotion</label>
                <select
                  id="test-voice-emotion"
                  value={testEmotion}
                  onChange={(e) => setTestEmotion(e.target.value)}
                >
                  {TEST_EMOTIONS.map((emo) => (
                    <option key={emo} value={emo}>
                      {emo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="voice-test-row">
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Test voice with sample line, emotion ${testEmotion}`}
                  disabled={testing || draftDirty || !window.dvc}
                  onClick={() => testVoice()}
                >
                  {testing ? 'Speaking…' : 'Test voice'}
                </button>
                {draftDirty && <span className="voice-hint">Save first to test these changes</span>}
              </div>
            </>
          )}
          {tab === '⛏ MC' && (
            <>
              <p className="mc-settings-note">
                Drone runs from <code>drone/</code> automatically on connect.
              </p>

              <h3 className="section-title">Server</h3>
              <TextField
                id="mc-host"
                label="Host"
                value={draft.minecraft_v2.host}
                placeholder="localhost"
                onChange={(v) => setMcField('host', v)}
              />
              <div className="mc-field-pair">
                <TextField
                  id="mc-port"
                  label="Port"
                  value={String(draft.minecraft_v2.port ?? '')}
                  placeholder="25565"
                  onChange={(v) => setMcField('port', v)}
                />
                <TextField
                  id="mc-version"
                  label="MC version"
                  value={draft.minecraft_v2.version}
                  placeholder="1.21"
                  onChange={(v) => setMcField('version', v)}
                />
              </div>
              <TextField
                id="mc-username"
                label="Bot username"
                value={draft.minecraft_v2.username}
                placeholder="RavenBot"
                onChange={(v) => setMcField('username', v)}
              />
              <div className="field">
                <label htmlFor="mc-auth">Auth mode</label>
                <select
                  id="mc-auth"
                  value={draft.minecraft_v2.auth}
                  aria-label="Minecraft auth mode"
                  onChange={(e) => setMcField('auth', e.target.value)}
                >
                  {MC_AUTH_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </div>
              <TextField
                id="mc-ws-port"
                label="Drone WS port"
                value={String(draft.minecraft_v2.ws_port ?? '')}
                placeholder="8765"
                onChange={(v) => setMcField('ws_port', v)}
              />

              <h3 className="section-title">Brain</h3>
              <TextField
                id="mc-brain-url"
                label="Brain URL"
                value={draft.minecraft_v2.brain_url}
                placeholder="https://api.openai.com/v1/chat/completions"
                onChange={(v) => setMcField('brain_url', v)}
              />
              <SecretField
                id="mc-brain-key"
                label="Brain API key"
                value={draft.minecraft_v2.brain_key}
                onChange={(v) => setMcField('brain_key', v)}
              />
              <TextField
                id="mc-brain-model"
                label="Brain model"
                value={draft.minecraft_v2.brain_model}
                placeholder="(blank = main model)"
                onChange={(v) => setMcField('brain_model', v)}
              />

              <h3 className="section-title">AI features</h3>
              {MC_AI_FEATURES.map((feature) => (
                <label className="toggle-row" key={feature.key}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={Boolean(draft.minecraft_v2.ai_features?.[feature.key])}
                    aria-label={feature.label}
                    onChange={(e) => setMcAiFeature(feature.key, e.target.checked)}
                  />
                  <span className="toggle-track" aria-hidden="true">
                    <span className="toggle-thumb" />
                  </span>
                  <span className="toggle-text">{feature.label}</span>
                </label>
              ))}
            </>
          )}

          {tab === 'Memory' && (
            <>
              <div className="mem-io-row">
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label="Export memories to file"
                  onClick={() => useStore.getState().exportMemories()}
                >
                  <Download size={13} /> Export
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label="Import memories from file"
                  onClick={() => useStore.getState().importMemories()}
                >
                  <Upload size={13} /> Import
                </button>
              </div>

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
