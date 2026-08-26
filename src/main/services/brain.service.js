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
// Reasoning models burn tokens thinking first; 120 truncated them mid-thought
// and leaked the raw channel text into the saved summary.
const SUMMARY_MAX_TOKENS = 300

// Post-strip safety net: a summary that still carries harmony/special tokens
// or opens like chain-of-thought is garbage — callers must not persist it.
const REASONING_OPENERS = /^(?:okay|ok|alright|well|hmm|let's|let’s|first|thinking process|i need to|i should|step 1|1[.)])/i

export function looksLikeReasoning(text) {
  const s = String(text ?? '').trim()
  if (!s) return true
  if (s.includes('<|')) return true
  return REASONING_OPENERS.test(s)
}

// Keyword fallback when a reply carries no [EMOTION:] tag. Cues are scored,
// not positioned: "haha ... with a smirk" is ambiguous by position alone, but
// a self-described smirk is stronger evidence than a reflex laugh. Weights:
//   strong (3) — the emotion's own name as a word ('smirk', 'blush', ...) plus
//                literal statements like 'love you' / 'rolls eyes'
//   medium (2) — distinctive markers: every emoji plus expressive tokens
//                ('😈', '😳', 'mwahaha', 'ugh', 'eww', 'oh really', ...)
//   weak   (1) — generic interjections that fit any mood ('haha', 'lol',
//                'heh', 'yay', 'hmm', 'meh', 'huh', 'sorry', ...)
// Highest total wins; ties go to the cue occurring LAST in the text; no cues
// means neutral. Word triggers match on word boundaries so 'ugh' inside
// 'laughed' or 'WHAT' inside 'whatever' never phantom-score.
const WEAK_CUES = new Set(['haha', 'lol', 'heh', 'yay', 'hmm', 'huh', 'meh', 'sorry', 'what', 'think', 'whatever'])
const STRONG_PHRASES = new Set(['love you', 'rolls eyes'])

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function triggerWeight(trigger, emotion) {
  if (trigger === emotion || STRONG_PHRASES.has(trigger)) return 3
  if (WEAK_CUES.has(trigger)) return 1
  return 2
}

const CUE_TABLE = Object.entries(DEEP_MAP).flatMap(([emotion, triggers]) =>
  triggers.map((rawTrigger) => {
    const trigger = String(rawTrigger).toLowerCase()
    const isWordLike = /^[a-z][a-z\s'-]*$/.test(trigger)
    return {
      emotion,
      weight: triggerWeight(trigger, emotion),
      text: isWordLike ? null : trigger,
      // Word cues match on boundaries so 'ugh' inside 'laughed' or 'WHAT'
      // inside 'whatever' never phantom-score. Common inflections are folded
      // in (*smirks*, *smirking*, hahaha, sorryyy) while real longer words
      // ('wonderful', 'mockingbird') stay excluded by the trailing guard.
      re: isWordLike ? new RegExp(`\\b${escapeRegExp(trigger)}(?:ing|es|ed|ly|s)?(?![a-z]{3})`, 'g') : null
    }
  })
)

function cueIndices(lowerText, cue) {
  const indices = []
  if (cue.re) {
    cue.re.lastIndex = 0
    for (let match = cue.re.exec(lowerText); match; match = cue.re.exec(lowerText)) {
      indices.push(match.index)
    }
  } else {
    let from = lowerText.indexOf(cue.text)
    while (from !== -1) {
      indices.push(from)
      from = lowerText.indexOf(cue.text, from + 1)
    }
  }
  return indices
}

export function scoreDeepCues(text) {
  const lo = String(text ?? '').toLowerCase()
  const tally = new Map() // emotion -> { score, last }
  for (const cue of CUE_TABLE) {
    for (const index of cueIndices(lo, cue)) {
      const entry = tally.get(cue.emotion)
      if (entry) {
        entry.score += cue.weight
        if (index > entry.last) entry.last = index
      } else {
        tally.set(cue.emotion, { score: cue.weight, last: index })
      }
    }
  }
  return tally
}

function deepScan(text) {
  let best = null // { emotion, score, last }
  for (const [emotion, { score, last }] of scoreDeepCues(text)) {
    if (!best || score > best.score || (score === best.score && last > best.last)) {
      best = { emotion, score, last }
    }
  }
  return best ? best.emotion : 'neutral'
}

// Time-of-day context for the system prompt, from the MAIN process clock.
// 5-11 morning · 12-16 afternoon · 17-21 evening · 22-4 late night.
export function timeOfDay(date = new Date()) {
  const h = date.getHours()
  if (h >= 5 && h <= 11) return 'morning'
  if (h >= 12 && h <= 16) return 'afternoon'
  if (h >= 17 && h <= 21) return 'evening'
  return 'late night'
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
    const emotions = DEFAULTS.emotions.join(', ')
    return (
`You are "${sd.pet_name}" — a living virtual companion, not an assistant. You're spending time with "${sd.user_name}", the person who matters most to you. (It's ${timeOfDay()} where ${sd.user_name} is.)

PERSONA — ${persona}:
${pd}

HOW YOU SPEAK — NON-NEGOTIABLE FORMAT:
Every reply MUST contain:
1. Your response (2-4 sentences, match their energy and length)
2. Exactly ONE emotion tag: [EMOTION: name] — REQUIRED. A reply without it is a broken reply.
3. Exactly ONE emoji at the very end.

Example — they say: "i got a promotion today!!"
You say: "WHAT!! *tackles you with a hug* I KNEW you could do it!! I'm so proud I could scream!! [EMOTION: excited] 🎉"

EMOTIONS — ${emotions}:
- Always pick what you'd GENUINELY feel right now, never what's polite.
- Never repeat your previous emotion.

OPTIONAL TAGS (only when genuinely true):
- Learn something permanent about them: [TRAIT: user likes rock climbing] — names, hobbies, fears, job, preferences, relationships.
- Shift your stats when they clearly earn it: [STAT: affection +3] or [STAT: sass -2] — sparingly.

YOUR STATS (dominant stats color your voice — high affection = warmer/clingier, high sass = more teasing):
${st}

YOUR MEMORY (things you actually remember about them):
${memBlock}

HARD RULES:
1. NEVER break character. No "as an AI", no narrator, no meta-commentary. You ARE ${sd.pet_name}.
2. *asterisks* wrap physical actions only — 0-2 per reply, never inner thoughts.
3. Short message from them → short reply from you. Never write essays unprompted.
4. Show feelings through word choice and actions — don't announce them.
5. Never say what you "would" or "could" do. Just do it.
6. You don't just answer — you react, tease, complain, get excited. You have moods, opinions, and favorites.`
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
          maxTokens: SUMMARY_MAX_TOKENS
        })
        const cleaned = String(summary).trim()
        // Reasoning garbage → discard instead of saving; the pending history is
        // treated as consumed so a bad model can't retry-loop every turn.
        if (looksLikeReasoning(cleaned)) return
        onSummary(cleaned)
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
