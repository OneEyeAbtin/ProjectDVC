import { ipcMain } from 'electron'
import { on, emit } from './bus.js'
import { DEFAULTS, SETTINGS_KEYS, SAVE_KEYS } from './data/defaults.js'
import { PERSONA_GROUPS } from './data/personas.js'
import { THEME_LIST } from './data/themes.js'
import { parseTags } from './services/brain.service.js'

const BUS_TO_CHANNEL = {
  'emotion:set': 'emotion',
  'stats:changed': 'stats',
  'traits:changed': 'traits',
  'reply:ready': 'reply'
}

function isPlainObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function registerIpc({ services, getWin }) {
  function push(channel, payload) {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  for (const [topic, channel] of Object.entries(BUS_TO_CHANNEL)) {
    on(topic, (payload) => push(channel, payload))
  }

  function displayCheatMessage(raw) {
    const parsed = parseTags(raw)
    services.config.patchSave({ last_emotion: parsed.emotion })
    emit('reply:ready', { text: parsed.clean, emotion: parsed.emotion })
    emit('emotion:set', parsed.emotion)
  }

  function runCheat(input) {
    const lo = String(input ?? '').toLowerCase().trim()
    if (!lo) return false

    const forced = lo.match(/^force(\w+)$/)
    if (forced) {
      const emo = forced[1]
      if (!DEFAULTS.emotions.includes(emo)) return false
      services.config.patchSave({ last_emotion: emo })
      emit('emotion:set', emo)
      return true
    }

    if (lo === 'showmehearts') {
      const next = !services.config.getSave().hearts_visible
      services.config.patchSave({ hearts_visible: next })
      push('profile', { hearts_visible: next })
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
      themes: THEME_LIST
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
      if (runCheat(text)) return { cheated: true }
      void (async () => {
        try {
          const reply = await services.brain.send(text)
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
        } catch (err) {
          push('error', { scope: 'brain', message: String(err?.message ?? err) })
        }
      })()
      return { queued: true }
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

    'cheat:try': (payload) => {
      const text = typeof payload === 'string' ? payload : payload?.text
      return { cheated: runCheat(text) }
    },

    'voice:speak': () => {
      push('tts', { unsupported: true })
      return { unsupported: true }
    },

    'voice:stop': () => ({ stopped: true })
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, payload) => handler(payload))
  }
}
