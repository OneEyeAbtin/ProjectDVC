import { ipcMain, dialog as electronDialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { on, emit } from './bus.js'
import { DEFAULTS, SETTINGS_KEYS, SAVE_KEYS } from './data/defaults.js'
import { PERSONA_GROUPS, GREETING_TEMPLATES, PERSONA_TRANSFORM, PERSONAS, IDLE_LINES } from './data/personas.js'
import { TRANSIENT_EMOTIONS, FORCEABLE_EMOTIONS } from './data/emotions.js'
import { THEME_LIST } from './data/themes.js'
import { parseTags } from './services/brain.service.js'
import { createConfigService } from './services/config.service.js'
import { createMemoryService } from './services/memory.service.js'
import { createBrain } from './services/brain.service.js'
import { createIdleService, pickIdleLine } from './services/idle.service.js'
import { atomicWrite, writeJsonAtomic } from './lib/atomic.js'

const BUS_TO_CHANNEL = {
  'emotion:set': 'emotion',
  'stats:changed': 'stats',
  'traits:changed': 'traits',
  'tts:ready': 'tts',
  'tts': 'tts'
}

function isPlainObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function registerIpc({ services, getWin, idleRand = Math.random }) {
  function push(channel, payload) {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    // Auto-speak: the single call site for spoken replies. Every reply push —
    // normal flow, cheat messages, idle chatter — routes through here
    // (legacy parity: everything the companion "says" gets spoken).
    if (channel === 'reply') autoSpeak(payload)
  }

  function autoSpeak(payload) {
    try {
      const voice = services.voice
      if (!voice) return
      const ttsConfig = services.config.getConfig().tts_config ?? {}
      if (!ttsConfig.enabled) return
      const text = typeof payload?.text === 'string' ? payload.text : ''
      void voice.speak({ text, emotion: payload?.emotion ?? null })
    } catch {
      // Speech must never break the reply flow.
    }
  }

  // Idle chatter: timestamp refreshed on every user message; the timer resets
  // on each send so a fire can never land inside an active conversation.
  let lastActivity = Date.now()
  const idleSvc = createIdleService({
    getEnabled: () => services.config.getConfig().idle_chat !== false,
    getLastActivity: () => lastActivity,
    fire: () => push('reply', { text: pickIdleLine(IDLE_LINES, idleRand), emotion: null }),
    rand: idleRand
  })
  idleSvc.schedule()

  function touchActivity() {
    lastActivity = Date.now()
    idleSvc.reset()
  }

  for (const [topic, channel] of Object.entries(BUS_TO_CHANNEL)) {
    on(topic, (payload) => push(channel, payload))
  }

  function displayCheatMessage(raw) {
    const parsed = parseTags(raw)
    services.config.patchSave({ last_emotion: parsed.emotion })
    push('reply', { text: parsed.clean, emotion: parsed.emotion })
    emit('emotion:set', parsed.emotion)
  }

  async function deliverReply(reply) {
    if (!reply) return
    const stats = reply.applyTo(services.config.getSave().stats ?? {})
    services.config.patchSave({ stats })
    for (const trait of reply.traits ?? []) {
      services.memory.addTrait(trait)
      services.memory.rotateAndSave()
    }
    push('reply', { text: reply.text ?? reply.clean ?? '', emotion: reply.emotion })
    push('stats', services.config.getSave().stats)
    push('traits', services.memory.getSessionTraits())
  }

  function runCheat(input) {
    const lo = String(input ?? '').toLowerCase().trim()
    if (!lo) return false

    const forced = lo.match(/^force(\w+)$/)
    if (forced) {
      const emo = forced[1]
      if (!FORCEABLE_EMOTIONS.includes(emo)) return false
      if (!TRANSIENT_EMOTIONS.includes(emo)) services.config.patchSave({ last_emotion: emo })
      emit('emotion:set', emo)
      // Reply push so the renderer clears its thinking state via the normal flow.
      push('reply', { text: '*strikes a pose*', emotion: emo })
      return true
    }

    if (lo === 'showmehearts') {
      const next = !services.config.getSave().hearts_visible
      services.config.patchSave({ hearts_visible: next })
      push('profile', { hearts_visible: next })
      push('reply', { text: next ? '*hearts everywhere!* 💞' : '*tucks the hearts away* 🙈', emotion: null })
      return true
    }

    if (lo === 'rosebud' || lo === 'motherlode') {
      const stats = { ...services.config.getSave().stats, affection: 100 }
      services.config.patchSave({ stats })
      displayCheatMessage('*sparkles* MAX LOVE~ [EMOTION: love] 💖')
      push('stats', stats)
      return true
    }

    if (lo === 'iddqd') {
      const stats = Object.fromEntries(
        Object.keys(services.config.getSave().stats ?? {}).map((k) => [k, 100])
      )
      services.config.patchSave({ stats })
      displayCheatMessage('*POWER OVERWHELMING* [EMOTION: excited] ⚡')
      push('stats', stats)
      return true
    }

    if (lo === 'upupdowndown') {
      services.config.patchSave({ persona: 'Girlfriend' })
      displayCheatMessage("*transforms* I'm your girlfriend now~ [EMOTION: love] 💕")
      push('profile', { persona: 'Girlfriend' })
      return true
    }

    if (lo === 'amnesia') {
      services.brain.clearHistory()
      displayCheatMessage('*blinks* Huh? What were we talking about? [EMOTION: confused] 😵')
      push('memory', { event: 'amnesia' })
      return true
    }

    return false
  }

  const handlers = {
    'app:init': () => ({
      config: services.config.getConfig(),
      save: services.config.getSave(),
      traits: services.memory.getSessionTraits(),
      permanentFacts: services.memory.getPermanent(),
      outfitManifest: services.characters.manifest(),
      setupQuestions: DEFAULTS.setup_questions,
      personaGroups: PERSONA_GROUPS,
      greetings: GREETING_TEMPLATES,
      personaTransforms: PERSONA_TRANSFORM,
      personaDescriptions: PERSONAS,
      themes: THEME_LIST,
      transientEmotions: TRANSIENT_EMOTIONS,
      piperVoices: services.voice ? services.voice.scanPiperVoices() : []
    }),

    'setup:complete': (payload) => {
      const raw = isPlainObj(payload) ? payload : {}
      const answers = {}
      for (const q of DEFAULTS.setup_questions) {
        const value = raw[q.key]
        if (value === undefined || value === null) continue
        const str = String(value).trim()
        if (!str || str.toLowerCase() === 'skip') continue
        answers[q.key] = str
      }
      const patch = { setup_answers: answers, setup_complete: true }
      if (answers.user_name) patch.user_name = answers.user_name
      if (answers.pet_name) patch.pet_name = answers.pet_name
      services.config.patchSave(patch)
      for (const [key, value] of Object.entries(answers)) {
        services.memory.addTrait(`user's ${key.replace(/_/g, ' ')}: ${value}`)
      }
      services.memory.rotateAndSave()
      emit('traits:changed', services.memory.getSessionTraits())
      return services.config.getSave()
    },

    'msg:send': (payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text
      touchActivity()
      if (runCheat(text)) return { cheated: true }
      void (async () => {
        try {
          await deliverReply(await services.brain.send(text))
        } catch (err) {
          push('error', { scope: 'brain', message: String(err?.message ?? err) })
        }
      })()
      return { queued: true }
    },

    'msg:regenerate': () => {
      touchActivity()
      void (async () => {
        try {
          const reply = await services.brain.regenerate()
          if (!reply) {
            push('error', { scope: 'brain', message: 'Nothing to regenerate' })
            return
          }
          await deliverReply(reply)
        } catch (err) {
          push('error', { scope: 'brain', message: String(err?.message ?? err) })
        }
      })()
      return { queued: true }
    },

    'stats:adjust': (payload) => {
      const key = payload?.key
      const stats = { ...services.config.getSave().stats }
      if (!key || !(key in stats)) throw new Error(`Unknown stat: ${key}`)
      const current = Number(stats[key]) || 0
      const delta = Number(payload?.delta) || 0
      stats[key] = Math.max(0, Math.min(100, current + delta))
      services.config.patchSave({ stats })
      push('stats', stats)
      return stats
    },

    'memory:delete-trait': (payload) => {
      const result = services.memory.removeSessionTrait(payload?.text)
      push('traits', result)
      return result
    },

    'memory:wipe-traits': () => {
      const result = services.memory.setSessionTraits([])
      push('traits', result)
      return result
    },

    'memory:delete-permanent': (payload) =>
      services.memory.deletePermanent(payload?.text),

    'memory:wipe-permanent': () => services.memory.wipePermanent(),

    'memory:clear-summary': () => services.config.patchSave({ session_summary: '' }),

    // Memory portability: export writes {traits, permanentFacts,
    // sessionSummary, setupAnswers} to a user-chosen JSON file; import
    // validates the same shape and merges without clobbering existing data.
    'memory:export': async () => {
      const dialog = services.dialog ?? electronDialog
      const save = services.config.getSave()
      const payload = {
        traits: services.memory.getSessionTraits(),
        permanentFacts: services.memory.getPermanent(),
        sessionSummary: typeof save.session_summary === 'string' ? save.session_summary : '',
        setupAnswers: isPlainObj(save.setup_answers) ? structuredClone(save.setup_answers) : {}
      }
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const res = await dialog.showSaveDialog({
        defaultPath: `dvc-memories-${stamp}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!res || res.canceled || !res.filePath) return { saved: false }
      writeJsonAtomic(res.filePath, payload)
      return { saved: true, path: res.filePath }
    },

    'memory:import': async () => {
      const dialog = services.dialog ?? electronDialog
      const res = await dialog.showOpenDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (!res || res.canceled || !Array.isArray(res.filePaths) || res.filePaths.length === 0) {
        return { imported: false }
      }
      let data
      try {
        data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'))
      } catch {
        throw new Error('Import failed: file is not valid JSON')
      }
      if (
        !isPlainObj(data) ||
        !Array.isArray(data.traits) ||
        !Array.isArray(data.permanentFacts) ||
        typeof data.sessionSummary !== 'string' ||
        !isPlainObj(data.setupAnswers)
      ) {
        throw new Error('Import failed: unexpected memory file shape')
      }

      const traits = services.memory.setSessionTraits([
        ...services.memory.getSessionTraits(),
        ...data.traits.filter((t) => typeof t === 'string')
      ])
      const permanentFacts = services.memory.addPermanentFacts(
        data.permanentFacts.filter((f) => typeof f === 'string')
      )

      const before = services.config.getSave()
      const patch = { setup_answers: { ...(isPlainObj(before.setup_answers) ? before.setup_answers : {}) } }
      if (!before.session_summary && data.sessionSummary.trim()) {
        patch.session_summary = data.sessionSummary
      }
      // Fill in answers that are missing/empty locally; local values always win.
      for (const [key, value] of Object.entries(data.setupAnswers)) {
        const current = patch.setup_answers[key]
        if (current === undefined || current === null || current === '') {
          patch.setup_answers[key] = value
        }
      }
      services.config.patchSave(patch)

      const save = services.config.getSave()
      push('traits', traits)
      push('profile', { config: services.config.getConfig(), save })
      return {
        imported: true,
        traits,
        permanentFacts,
        sessionSummary: typeof save.session_summary === 'string' ? save.session_summary : ''
      }
    },

    'history:get': () => ({ history: services.brain.history }),

    'history:clear': () => {
      services.brain.clearHistory()
      return {}
    },

    'setup:redo': () => {
      services.memory.setSessionTraits([])
      services.config.setSaveEntries({ setup_complete: false, setup_answers: {} })
      push('traits', services.memory.getSessionTraits())
      return services.config.getSave()
    },

    'profile:factory-reset': () => {
      const rootDir = services.config.rootDir
      const dataDir = path.join(rootDir, 'data')
      const memoryDir = path.join(dataDir, 'memory')
      for (const name of ['config.json', 'save.json']) {
        try {
          fs.rmSync(path.join(dataDir, name), { force: true })
        } catch {
          void 0
        }
      }
      for (const name of ['session-traits.json', 'permanent-facts.json', 'session-cache.json', '.migrated']) {
        try {
          fs.rmSync(path.join(memoryDir, name), { force: true })
        } catch {
          void 0
        }
      }
      // Re-instantiate in place so every handler reads/writes fresh state.
      // brain is recreated too because it captures config/memory references.
      services.config = createConfigService({ rootDir })
      services.memory = createMemoryService({ rootDir })
      services.brain = createBrain({
        config: services.config,
        memory: services.memory,
        onSummary: (summary) => {
          if (summary) services.config.patchSave({ session_summary: summary })
        }
      })
      // Rewrite the migration marker: the wipe above deleted it, and without a fresh
      // one the next boot would re-import legacy dvc_profile.json (resurrecting the
      // just-wiped API keys). Must NOT call migrateLegacyIfNeeded() here — that would
      // import the legacy profile immediately.
      try {
        atomicWrite(path.join(memoryDir, '.migrated'), new Date().toISOString())
      } catch {
        void 0
      }
      return services.config.getSave()
    },

    'profile:save': (patch) => {
      if (!isPlainObj(patch)) throw new Error('profile:save expects an object')
      const savePatch = {}
      const configPatch = {}
      for (const [key, value] of Object.entries(patch)) {
        if (SAVE_KEYS.includes(key)) savePatch[key] = value
        else if (SETTINGS_KEYS.includes(key)) configPatch[key] = value
      }
      if (Object.keys(configPatch).length) services.config.patchConfig(configPatch)
      if (Object.keys(savePatch).length) services.config.patchSave(savePatch)
      const touchesWindow =
        ('always_on_top' in configPatch || 'tray_enabled' in configPatch) && services.window
      if (touchesWindow) services.window.applySettings()
      const result = { config: services.config.getConfig(), save: services.config.getSave() }
      push('profile', result)
      return result
    },

    'outfit:switch': (payload) => {
      const name = typeof payload === 'string' ? payload : payload?.name
      const known = services.characters.manifest().some((o) => o.name === name || o.prefix === name)
      if (!known) throw new Error(`Unknown outfit: ${name}`)
      services.config.patchSave({ outfit: name })
      emit('emotion:set', services.config.getSave().last_emotion ?? 'neutral')
      return services.config.getSave()
    },

    // Legacy parity (legacy/core/main.py outfit|__rescan__): re-read the outfits
    // directory so sprites dropped in at runtime appear without an app restart.
    'characters:rescan': () => {
      services.characters.scan()
      const manifest = services.characters.manifest()
      push('outfits', manifest)
      return manifest
    },

    'cheat:try': (payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text
      return { cheated: runCheat(text) }
    },

    'voice:speak': (payload) => {
      const voice = services.voice
      if (!voice) {
        push('tts', { unsupported: true })
        return { unsupported: true }
      }
      void voice.speak({
        text: typeof payload === 'string' ? payload : payload?.text,
        emotion: payload?.emotion ?? null
      })
      return { queued: true }
    },

    'voice:stop': () => {
      services.voice?.stop?.()
      return { stopped: true }
    },

    // Tray-hide: hide the window; the tray icon (if enabled) restores it.
    // Deliberately separate from the close path — X always quits now.
    'win:hide': () => {
      const w = getWin()
      if (w && !w.isDestroyed() && typeof w.hide === 'function') w.hide()
      return { hidden: true }
    },

    // Mic STT: invoke ack carries the result directly ({text} or {error}) —
    // no push needed since only the requesting renderer cares.
    'voice:stt-transcribe': async (payload) => {
      try {
        if (!services.voice?.transcribe) {
          return { error: 'Voice service unavailable' }
        }
        const raw = payload?.buffer
        let bytes
        if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw)
        else if (ArrayBuffer.isView(raw)) {
          bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        } else bytes = new Uint8Array(0)
        const mime = typeof payload?.mime === 'string' ? payload.mime : ''
        const { text } = await services.voice.transcribe({ buffer: bytes, mime })
        return { text }
      } catch (err) {
        return { error: String(err?.message ?? err) }
      }
    }
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, payload) => handler(payload))
  }

  return { dispose: () => idleSvc.stop() }
}
