import { DEFAULTS } from '../data/defaults.js'
import { PERSISTENT_EMOTIONS } from '../data/emotions.js'
import {
  PERSONAS,
  DEAD_MSGS,
  DEEP_MAP,
  EMO_REMAP,
  OFFLINE_FALLBACKS
} from '../data/personas.js'
import { defaultCallLLM } from '../providers/llm.js'

const SUMMARY_TIMEOUT_MS = 15000
const CHAT_TIMEOUT_MS = 30000
const SUMMARY_HISTORY_LIMIT = 20
const SUMMARY_SNIPPET_CHARS = 120

function deepScan(text) {
  const lo = text.toLowerCase()
  for (const [emotion, triggers] of Object.entries(DEEP_MAP)) {
    if (triggers.some((trigger) => lo.includes(trigger))) return emotion
  }
  return 'neutral'
}

export function parseTags(text, { stats = {}, emotions = PERSISTENT_EMOTIONS } = {}) {
  const validEmotions = emotions && emotions.length ? emotions : PERSISTENT_EMOTIONS
  let clean = String(text ?? '')
  const statDeltas = []
  for (const match of clean.matchAll(/\[STAT:\s*(\w+)\s*([+-]\d+)\]/gi)) {
    const key = match[1].toLowerCase()
    const delta = parseInt(match[2], 10)
    if (key in stats) statDeltas.push({ key, delta })
    clean = clean.split(match[0]).join('')
  }
  const traits = []
  for (const match of clean.matchAll(/\[TRAIT:\s*(.+?)\]/gi)) {
    traits.push(match[1].trim())
    clean = clean.split(match[0]).join('')
  }
  let tagged = null
  for (const match of clean.matchAll(/\[EMOTION:\s*(\w+)\]/gi)) {
    tagged = match[1].toLowerCase()
    clean = clean.split(match[0]).join('')
  }
  clean = clean.trim()

  const rawEmotion = tagged ?? deepScan(clean)
  const remappedEmotion = EMO_REMAP[rawEmotion] ?? rawEmotion
  const emotion = validEmotions.includes(remappedEmotion) ? remappedEmotion : 'neutral'

  function applyTo(target) {
    const out = { ...target }
    for (const { key, delta } of statDeltas) {
      if (!(key in out)) continue
      out[key] = Math.max(0, Math.min(100, Number(out[key]) + delta))
    }
    return out
  }

  return { clean, emotion, remappedEmotion, statDeltas, traits, applyTo }
}

export function createBrain({
  config,
  memory,
  personaName,
  callLLM = defaultCallLLM,
  onSummary = () => {}
}) {
  const hist = []

  function save() {
    return config.getSave()
  }

  function cfg() {
    return config.getConfig?.() ?? {}
  }

  function maxHistory() {
    const value = Number(save().max_history ?? cfg().max_history ?? DEFAULTS.max_history)
    return Number.isFinite(value) && value > 0 ? value : DEFAULTS.max_history
  }

  function pushHist(role, content) {
    hist.push({ role, content })
    while (hist.length > maxHistory()) hist.shift()
  }

  function sysPrompt() {
    const sd = save()
    const persona = personaName || sd.persona || DEFAULTS.persona
    const pd = PERSONAS[persona] ?? PERSONAS.Gothic ?? ''
    const st = Object.entries(sd.stats ?? {})
      .map(([k, v]) => `${k}:${v}/100`)
      .join(', ')
    const memBlock = memory.buildMemoryPrompt(sd)
    return (
      `You are "${sd.pet_name}", a virtual companion. The user is "${sd.user_name}".\n` +
      `PERSONA: ${persona}\n${pd}\n` +
      `STATS: ${st}\n` +
      `STRICT RULES — breaking these is a failure:\n` +
      `1. Stay in character ALWAYS. Never break the fourth wall.\n` +
      `2. NO meta-commentary. Never say things like 'as an AI', 'as your companion', ` +
      `'I should mention', 'I want to note', or anything that sounds like a narrator ` +
      `or system message. You ARE ${sd.pet_name}. Speak only as her.\n` +
      `3. Keep replies concise: 2-4 sentences max. Use emotes and kaomoji naturally.\n` +
      `4. Include exactly ONE emotion tag: [EMOTION: <name>]. ` +
      `Valid emotions: ${DEFAULTS.emotions.join(', ')}. Vary them — never repeat the same emotion twice in a row.\n` +
      `5. Tag permanent facts with [TRAIT: <fact>] when you learn something important.\n` +
      `6. Tag stat changes with [STAT: <name> +X] or [STAT: <name> -X].\n` +
      `7. Use *asterisks* for physical actions only (not for inner thoughts or narration).\n` +
      `8. End with ONE emoji that fits the mood.\n` +
      `9. Never describe what you 'would' do or 'could' say. Just do it.\n` +
      `MEMORY:\n${memBlock}`
    )
  }

  function endpointFor(mode) {
    const c = cfg()
    if (mode === 'local') {
      return {
        url: c.local_api_url || DEFAULTS.local_api_url,
        key: c.local_api_key || '',
        model: c.local_api_model || 'local-model'
      }
    }
    return {
      url: c.online_api_url || '',
      key: c.online_api_key || '',
      model: c.online_api_model || ''
    }
  }

  function fallback(input) {
    const lo = String(input).toLowerCase()
    const n = save().user_name || DEFAULTS.user_name
    for (const rule of OFFLINE_FALLBACKS.rules) {
      if (new RegExp(rule.re).test(lo)) return rule.resp(n)
    }
    const pool = OFFLINE_FALLBACKS.pool
    return pool[Math.floor(Math.random() * pool.length)](n)
  }

  function payload(raw) {
    const parsed = parseTags(raw, { stats: save().stats ?? {}, emotions: PERSISTENT_EMOTIONS })
    return {
      raw,
      text: parsed.clean,
      emotion: parsed.emotion,
      remappedEmotion: parsed.remappedEmotion,
      statDeltas: parsed.statDeltas,
      traits: parsed.traits,
      applyTo: parsed.applyTo
    }
  }

  function compressPending() {
    const mode = save().brain_mode || DEFAULTS.brain_mode
    if (mode === 'offline') return
    const raw = memory.popPendingSummary()
    if (!raw || !callLLM) return
    const ep = endpointFor(mode)
    const sd = save()
    const lines = raw.slice(-SUMMARY_HISTORY_LIMIT).map((m) =>
      `${m.role === 'user' ? sd.user_name : sd.pet_name}: ${String(m.content).slice(0, SUMMARY_SNIPPET_CHARS)}`
    )
    const prompt =
      `Summarize this conversation between ${sd.user_name} and ${sd.pet_name} ` +
      `in 2-3 sentences. Focus on what they talked about, any emotional ` +
      `moments, and anything important that happened. Be concise.\n\n` +
      `CONVERSATION:\n${lines.join('\n')}\n\nSUMMARY:`
    void (async () => {
      try {
        const summary = await callLLM({
          url: ep.url,
          key: ep.key,
          model: ep.model,
          messages: [{ role: 'user', content: prompt }],
          timeoutMs: SUMMARY_TIMEOUT_MS,
          temperature: 0.4,
          maxTokens: 120
        })
        onSummary(String(summary).trim())
      } catch {
        memory.restorePendingSummary(raw)
      }
    })()
  }

  async function send(text) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return null
    compressPending()
    pushHist('user', trimmed)
    const mode = save().brain_mode || DEFAULTS.brain_mode

    if (mode === 'offline') {
      const reply = fallback(trimmed)
      pushHist('assistant', reply)
      return payload(reply)
    }
    const ep = endpointFor(mode)
    if (mode === 'online' && (!ep.key || ep.key === 'YOUR-API-KEY-HERE')) {
      return payload('*checks wallet* Set your API key in config.json! [EMOTION: confused] 🔑')
    }
    try {
      const messages = [{ role: 'system', content: sysPrompt() }, ...hist]
      const reply = await callLLM({
        url: ep.url,
        key: ep.key,
        model: ep.model,
        messages,
        timeoutMs: CHAT_TIMEOUT_MS
      })
      pushHist('assistant', reply)
      return payload(reply)
    } catch {
      const reply = mode === 'local'
        ? DEAD_MSGS[Math.floor(Math.random() * DEAD_MSGS.length)]
        : '*confused* Online API error... check your key/URL! [EMOTION: confused] 🔑'
      pushHist('assistant', reply)
      return payload(reply)
    }
  }

  async function regenerate() {
    const last = hist[hist.length - 1]
    if (!last || last.role !== 'assistant') return null
    let userIdx = -1
    for (let i = hist.length - 2; i >= 0; i--) {
      if (hist[i].role === 'user') {
        userIdx = i
        break
      }
    }
    if (userIdx === -1) return null
    const text = hist[userIdx].content
    hist.pop()
    hist.splice(userIdx, 1)
    return send(text)
  }

  function clearHistory() {
    hist.length = 0
  }

  return {
    send,
    regenerate,
    sysPrompt,
    clearHistory,
    compressPending,
    get history() {
      return hist.map((m) => ({ ...m }))
    }
  }
}
