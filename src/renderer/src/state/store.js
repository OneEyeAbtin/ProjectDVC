import { useEffect } from 'react'
import { create } from 'zustand'

const TRANSIENT_EMOTIONS = ['talking', 'fullbody']

// Fallback lines for tag-only replies (LLM returned only [EMOTION]/[STAT]
// tags, so `clean` is empty) — keeps the typewriter cycle alive instead of
// leaving the UI stuck on `typing` forever (audit #1).
const TAG_ONLY_LINES = ['*smiles*', '*nods*', 'Mhm~']

export const useStore = create((set, get) => ({
  // boot / identity
  booted: false,
  setupComplete: false,
  userName: '',
  petName: '',
  persona: '',
  outfit: 'Base',
  theme: 'midnight-sakura',

  // emotion state machine (spec §4.3)
  emotion: 'neutral',
  transientEmotion: null,
  pendingEmotion: null,
  bubble: null, // { text, muted }
  typing: false,
  thinking: false,

  // companion state
  stats: {},
  heartsVisible: true,
  traits: [],
  permanentFacts: [],
  outfits: [],
  personaGroups: {},
  greetings: {},
  themes: [],
  brainMode: 'online',
  config: {},
  fontScale: 1,
  historyCount: 0,
  maxHistory: 20,
  lastResponse: '',
  lastUserText: '',
  sessionSummary: '',

  // ui overlays
  settingsOpen: false,
  statsOpen: false,

  // setup + errors
  setupQuestions: [],
  error: null,

  _unsubs: [],
  _errorTimer: null,
  _transientTimer: null,

  async boot() {
    if (!get().booted) {
      let data
      try {
        data = await window.dvc.invoke('app:init')
      } catch (err) {
        console.error('[dvc] app:init failed', err)
        // No auto-dismiss here: the splash retry row must stay visible until
        // a retry succeeds.
        set({ error: { scope: 'boot', message: String(err?.message ?? err) } })
        return
      }
      const save = data.save ?? {}
      set({
        booted: true,
        setupComplete: Boolean(save.setup_complete),
        userName: save.user_name ?? '',
        petName: save.pet_name ?? '',
        persona: save.persona ?? '',
        outfit: save.outfit ?? 'Base',
        theme: save.theme_id ?? 'midnight-sakura',
        emotion: save.last_emotion ?? 'neutral',
        stats: save.stats ?? {},
        heartsVisible: save.hearts_visible !== false,
        traits: Array.isArray(data.traits) ? data.traits : [],
        permanentFacts: Array.isArray(data.permanentFacts) ? data.permanentFacts : [],
        outfits: Array.isArray(data.outfitManifest) ? data.outfitManifest : [],
        personaGroups: data.personaGroups && typeof data.personaGroups === 'object' ? data.personaGroups : {},
        greetings: data.greetings && typeof data.greetings === 'object' ? data.greetings : {},
        themes: Array.isArray(data.themes) ? data.themes : [],
        brainMode: save.brain_mode ?? 'online',
        config: data.config && typeof data.config === 'object' ? data.config : {},
        fontScale: Number(save.font_scale) || 1,
        maxHistory: Number(data.config?.max_history) || 20,
        setupQuestions: Array.isArray(data.setupQuestions) ? data.setupQuestions : [],
        lastResponse: typeof save.last_response === 'string' ? save.last_response : '',
        sessionSummary: typeof save.session_summary === 'string' ? save.session_summary : '',
        error: null
      })
      // QoL: seed the MEM counter with the real backlog size (fire-and-forget);
      // subsequent `reply` pushes keep it in sync.
      window.dvc
        .invoke('history:get')
        .then((res) => {
          const history = res?.history
          if (Array.isArray(history)) {
            set({ historyCount: Math.min(history.length, get().maxHistory) })
          }
        })
        .catch(() => {})
    }
    get()._subscribe()
  },

  _subscribe() {
    if (get()._unsubs.length || !window.dvc) return
    const dvc = window.dvc
    const unsubs = [
      dvc.on('reply', (p) => get()._onReply(p)),
      dvc.on('emotion', (name) => get().setEmotion(name)),
      dvc.on('stats', (stats) => set({ stats: stats ?? {} })),
      dvc.on('traits', (traits) => set({ traits: Array.isArray(traits) ? traits : [] })),
      dvc.on('memory', () => set({ historyCount: 0, lastUserText: '' })),
      dvc.on('profile', (p) => get()._applyProfile(p)),
      dvc.on('error', (e) => get().setError(e)),
      dvc.on('outfits', (list) => set({ outfits: Array.isArray(list) ? list : [] }))
    ]
    set({ _unsubs: unsubs })
  },

  _teardown() {
    for (const unsub of get()._unsubs) unsub()
    clearTimeout(get()._errorTimer)
    clearTimeout(get()._transientTimer)
    set({ _unsubs: [], _errorTimer: null, _transientTimer: null })
  },

  // ── speech ────────────────────────────────────────────────────────────────
  say(text, targetEmotion = null) {
    set({
      bubble: { text, muted: false },
      typing: true,
      thinking: false,
      pendingEmotion: targetEmotion
    })
  },

  showMuted(text) {
    set({ bubble: { text, muted: true }, typing: false, thinking: false, pendingEmotion: null })
  },

  completeType() {
    const { bubble, pendingEmotion, emotion } = get()
    const next =
      pendingEmotion && !TRANSIENT_EMOTIONS.includes(pendingEmotion) ? pendingEmotion : emotion
    // transientEmotion: null — any completed reply ends a forced render-only
    // state like `talking`, so the sprite/badge unfreeze (audit #4).
    clearTimeout(get()._transientTimer)
    set({
      typing: false,
      emotion: next,
      transientEmotion: null,
      pendingEmotion: null,
      lastResponse: bubble?.text ?? get().lastResponse
    })
  },

  _onReply(payload) {
    set({ thinking: false })
    const text = payload?.text ?? ''
    get().say(
      text || TAG_ONLY_LINES[Math.floor(Math.random() * TAG_ONLY_LINES.length)],
      payload?.emotion ?? null
    )
    set({ historyCount: Math.min(get().historyCount + 1, get().maxHistory) })
  },

  setEmotion(name) {
    if (!name || typeof name !== 'string') return
    clearTimeout(get()._transientTimer)
    if (TRANSIENT_EMOTIONS.includes(name)) {
      set({ transientEmotion: name })
      // QoL: render-only lip-sync states self-clear after 2s without another
      // toggle, so a stuck `talking` can never outlive its reply.
      get()._transientTimer = setTimeout(() => set({ transientEmotion: null }), 2000)
      return
    }
    set({ emotion: name, transientEmotion: null })
  },

  // ── actions ───────────────────────────────────────────────────────────────
  sendMsg(textRaw) {
    const text = String(textRaw ?? '').trim()
    const { thinking, typing } = get()
    if (!text || thinking || typing) return
    set({ thinking: true, bubble: null, typing: false, error: null, lastUserText: text })
    window.dvc.invoke('msg:send', { text }).catch((err) => {
      get().setError({ scope: 'ipc', message: String(err?.message ?? err) })
    })
  },

  regenerate() {
    const { thinking, typing, lastUserText } = get()
    if (thinking || typing || !lastUserText) return
    set({ thinking: true, bubble: null, error: null })
    window.dvc.invoke('msg:regenerate').catch((err) => {
      get().setError({ scope: 'brain', message: String(err?.message ?? err) })
    })
  },

  async redoSetup() {
    try {
      const save = await window.dvc.invoke('setup:redo')
      get()._applySave(save)
    } catch (err) {
      get().setError({ scope: 'setup', message: String(err?.message ?? err) })
    }
  },

  async completeSetup(answers) {
    try {
      const save = await window.dvc.invoke('setup:complete', answers)
      get()._applySave(save)
    } catch (err) {
      get().setError({ scope: 'setup', message: String(err?.message ?? err) })
    }
  },

  setSettingsOpen(open) {
    set({ settingsOpen: Boolean(open) })
  },

  setStatsOpen(open) {
    set({ statsOpen: Boolean(open) })
  },

  // Memory mutations; the `traits` push reconciles session traits, the
  // permanent-facts handlers have no push so their results are applied here.
  async deleteTrait(text) {
    try {
      const traits = await window.dvc.invoke('memory:delete-trait', { text })
      if (Array.isArray(traits)) set({ traits })
    } catch (err) {
      get().setError({ scope: 'memory', message: String(err?.message ?? err) })
    }
  },

  async wipeTraits() {
    try {
      const traits = await window.dvc.invoke('memory:wipe-traits')
      set({ traits: Array.isArray(traits) ? traits : [] })
    } catch (err) {
      get().setError({ scope: 'memory', message: String(err?.message ?? err) })
    }
  },

  async deletePermanentFact(text) {
    try {
      const facts = await window.dvc.invoke('memory:delete-permanent', { text })
      if (Array.isArray(facts)) set({ permanentFacts: facts })
    } catch (err) {
      get().setError({ scope: 'memory', message: String(err?.message ?? err) })
    }
  },

  async wipePermanentFacts() {
    try {
      const facts = await window.dvc.invoke('memory:wipe-permanent')
      set({ permanentFacts: Array.isArray(facts) ? facts : [] })
    } catch (err) {
      get().setError({ scope: 'memory', message: String(err?.message ?? err) })
    }
  },

  async clearSummary() {
    try {
      const save = await window.dvc.invoke('memory:clear-summary')
      if (save && typeof save.session_summary === 'string') set({ sessionSummary: save.session_summary })
    } catch (err) {
      get().setError({ scope: 'memory', message: String(err?.message ?? err) })
    }
  },

  // Optimistic profile switches; rolled back if the IPC round-trip fails.
  setTheme(themeId) {
    const next = String(themeId ?? '').trim()
    if (!next || next === get().theme) return
    const prev = get().theme
    set({ theme: next })
    window.dvc.invoke('profile:save', { theme_id: next }).catch((err) => {
      if (get().theme === next) set({ theme: prev })
      get().setError({ scope: 'profile', message: String(err?.message ?? err) })
    })
  },

  setPersona(name) {
    const next = String(name ?? '').trim()
    if (!next || next === get().persona) return
    const prev = get().persona
    set({ persona: next })
    window.dvc.invoke('profile:save', { persona: next }).catch((err) => {
      if (get().persona === next) set({ persona: prev })
      get().setError({ scope: 'profile', message: String(err?.message ?? err) })
    })
  },

  // Optimistic ±delta; the `stats` push from the main process reconciles.
  adjustStat(key, delta) {
    const stats = { ...get().stats }
    if (!(key in stats)) return
    const current = Number(stats[key]) || 0
    const next = Math.max(0, Math.min(100, current + Number(delta) || 0))
    if (next === current) return
    const prev = stats[key]
    stats[key] = next
    set({ stats })
    window.dvc.invoke('stats:adjust', { key, delta }).catch((err) => {
      if (get().stats?.[key] === next) set({ stats: { ...get().stats, [key]: prev } })
      get().setError({ scope: 'stats', message: String(err?.message ?? err) })
    })
  },

  switchOutfit(name) {
    const next = String(name ?? '').trim()
    if (!next || next === get().outfit) return
    const prev = get().outfit
    set({ outfit: next })
    window.dvc.invoke('outfit:switch', { name: next }).catch((err) => {
      if (get().outfit === next) set({ outfit: prev })
      get().setError({ scope: 'profile', message: String(err?.message ?? err) })
    })
  },

  // Re-scan the outfits directory; main pushes the refreshed manifest back on
  // `outfits`, and the invoke result reconciles it here too.
  async rescanOutfits() {
    try {
      const outfits = await window.dvc.invoke('characters:rescan')
      if (Array.isArray(outfits)) set({ outfits })
    } catch (err) {
      get().setError({ scope: 'profile', message: String(err?.message ?? err) })
    }
  },

  _applySave(save = {}) {
    set({
      setupComplete: Boolean(save.setup_complete),
      userName: save.user_name ?? get().userName,
      petName: save.pet_name ?? get().petName,
      persona: save.persona ?? get().persona,
      outfit: save.outfit ?? get().outfit,
      stats: save.stats ?? get().stats,
      heartsVisible: save.hearts_visible !== undefined ? save.hearts_visible !== false : get().heartsVisible,
      theme: save.theme_id ?? get().theme,
      brainMode: save.brain_mode ?? get().brainMode,
      fontScale: save.font_scale !== undefined ? Number(save.font_scale) || 1 : get().fontScale,
      emotion: save.last_emotion ?? get().emotion,
      sessionSummary:
        typeof save.session_summary === 'string' ? save.session_summary : get().sessionSummary
    })
  },

  _applyProfile(data) {
    if (!data) return
    if (data.save && typeof data.save === 'object') {
      get()._applySave(data.save)
      if (data.config && typeof data.config === 'object') set({ config: data.config })
      if (data.config?.max_history) set({ maxHistory: Number(data.config.max_history) || 20 })
      return
    }
    const patch = {}
    if ('hearts_visible' in data) patch.heartsVisible = data.hearts_visible !== false
    if ('persona' in data) patch.persona = String(data.persona)
    if ('outfit' in data) patch.outfit = String(data.outfit)
    if (Object.keys(patch).length) set(patch)
  },

  setError(err) {
    clearTimeout(get()._errorTimer)
    set({
      thinking: false,
      error: { scope: String(err?.scope ?? 'unknown'), message: String(err?.message ?? 'Unknown error') }
    })
    get()._errorTimer = setTimeout(() => set({ error: null }), 6000)
  },

  // QoL: manual dismissal via the error chip's ✕ button.
  dismissError() {
    clearTimeout(get()._errorTimer)
    set({ error: null })
  }
}))

export function useBoot() {
  useEffect(() => {
    useStore.getState().boot()
    return () => useStore.getState()._teardown()
  }, [])
}
