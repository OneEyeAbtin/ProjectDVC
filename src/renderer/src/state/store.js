import { useEffect } from 'react'
import { create } from 'zustand'

const TRANSIENT_EMOTIONS = ['talking', 'fullbody']

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
  historyCount: 0,
  maxHistory: 20,
  lastResponse: '',

  // setup + errors
  setupQuestions: [],
  error: null,

  _unsubs: [],
  _errorTimer: null,

  async boot() {
    if (!get().booted) {
      let data
      try {
        data = await window.dvc.invoke('app:init')
      } catch (err) {
        console.error('[dvc] app:init failed', err)
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
        maxHistory: Number(data.config?.max_history) || 20,
        setupQuestions: Array.isArray(data.setupQuestions) ? data.setupQuestions : [],
        lastResponse: typeof save.last_response === 'string' ? save.last_response : ''
      })
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
      dvc.on('memory', () => set({ historyCount: 0 })),
      dvc.on('profile', (p) => get()._applyProfile(p)),
      dvc.on('error', (e) => get().setError(e))
    ]
    set({ _unsubs: unsubs })
  },

  _teardown() {
    for (const unsub of get()._unsubs) unsub()
    clearTimeout(get()._errorTimer)
    set({ _unsubs: [], _errorTimer: null })
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
    set({
      typing: false,
      emotion: next,
      pendingEmotion: null,
      lastResponse: bubble?.text ?? get().lastResponse
    })
  },

  _onReply(payload) {
    set({ thinking: false })
    get().say(payload?.text ?? '', payload?.emotion ?? null)
    set({ historyCount: Math.min(get().historyCount + 1, get().maxHistory) })
  },

  setEmotion(name) {
    if (!name || typeof name !== 'string') return
    if (TRANSIENT_EMOTIONS.includes(name)) {
      set({ transientEmotion: name })
      return
    }
    set({ emotion: name, transientEmotion: null })
  },

  // ── actions ───────────────────────────────────────────────────────────────
  sendMsg(textRaw) {
    const text = String(textRaw ?? '').trim()
    const { thinking, typing } = get()
    if (!text || thinking || typing) return
    set({ thinking: true, bubble: null, typing: false, error: null })
    window.dvc.invoke('msg:send', { text }).catch((err) => {
      get().setError({ scope: 'ipc', message: String(err?.message ?? err) })
    })
  },

  async completeSetup(answers) {
    try {
      const save = await window.dvc.invoke('setup:complete', answers)
      get()._applySave(save)
    } catch (err) {
      get().setError({ scope: 'setup', message: String(err?.message ?? err) })
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
      emotion: save.last_emotion ?? get().emotion
    })
  },

  _applyProfile(data) {
    if (!data) return
    if (data.save && typeof data.save === 'object') {
      get()._applySave(data.save)
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
  }
}))

export function useBoot() {
  useEffect(() => {
    useStore.getState().boot()
    return () => useStore.getState()._teardown()
  }, [])
}
