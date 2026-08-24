import fs from 'node:fs'
import path from 'node:path'
import { stringSimilarity } from 'string-similarity-js'

const PERM_PREFIXES = [
  "user's user name",
  "user's pet name",
  "user's age",
  "user's pronouns",
  "user's hobby",
  "user's love language",
  "user's humor style",
  "user's music taste",
  "user's social type",
  "user's fear",
  "user's life motto",
  "user's deep wish",
  "user's dream superpower",
  "user's desired role",
  "user's friendship value",
  "user's guilty pleasure",
  "user's comfort media",
  "user's emotional response",
  "user's schedule",
  "user's pet peeve"
]

const PERM_KEYWORDS = [
  'name', 'age', 'pronoun', 'hobby', 'passion', 'love language',
  'humor', 'fear', 'motto', 'superpower', 'music', 'schedule',
  'introvert', 'extrovert', 'pet peeve', 'comfort', 'wish',
  'friendship', 'guilty pleasure', 'role', 'job', 'major', 'study'
]

const PERM_HINT_WORDS = ['likes', 'loves', 'hates', 'prefers', 'always', 'never', 'is a', 'was a']

const DEDUP_THRESHOLD = 0.75
const MAX_SESSION_TRAITS = 30
const COMPRESS_THRESHOLD = 25
const CACHE_HISTORY_LIMIT = 20
const PROMPT_SESSION_NOTES_LIMIT = 10

function isPlainObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed ?? structuredClone(fallback)
  } catch {
    return structuredClone(fallback)
  }
}

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function writeJsonAtomic(file, obj) {
  atomicWrite(file, JSON.stringify(obj, null, 2))
}

function normalizeDigits(text) {
  return text.toLowerCase().replace(/\d+/g, '#')
}

function areDuplicates(a, b) {
  if (a === b) return true
  if (a.toLowerCase() === b.toLowerCase()) return true
  if (normalizeDigits(a) === normalizeDigits(b)) return false
  return stringSimilarity(a.toLowerCase(), b.toLowerCase(), 1) >= DEDUP_THRESHOLD
}

export function dedupTraits(traits) {
  const cleaned = []
  for (const raw of traits) {
    if (typeof raw !== 'string') continue
    const trait = raw.trim()
    if (!trait) continue
    const idx = cleaned.findIndex((kept) => areDuplicates(trait, kept))
    if (idx === -1) cleaned.push(trait)
    else if (trait.length > cleaned[idx].length) cleaned[idx] = trait
  }
  return cleaned
}

export function createMemoryService({ rootDir }) {
  const memoryDir = path.join(rootDir, 'data', 'memory')
  fs.mkdirSync(memoryDir, { recursive: true })

  const permanentPath = path.join(memoryDir, 'permanent-facts.json')
  const sessionTraitsPath = path.join(memoryDir, 'session-traits.json')
  const cachePath = path.join(memoryDir, 'session-cache.json')

  function loadList(file) {
    const list = loadJson(file, [])
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  }

  let permanent = loadList(permanentPath)
  let sessionTraits = loadList(sessionTraitsPath)

  function persistPermanent() {
    writeJsonAtomic(permanentPath, permanent)
  }

  function persistSessionTraits() {
    writeJsonAtomic(sessionTraitsPath, sessionTraits)
  }

  function getPermanent() {
    return [...permanent]
  }

  function getSessionTraits() {
    return [...sessionTraits]
  }

  function setSessionTraits(list) {
    sessionTraits = dedupTraits(Array.isArray(list) ? list : [])
    persistSessionTraits()
    return getSessionTraits()
  }

  function removeSessionTrait(text) {
    const target = String(text ?? '')
    const idx = sessionTraits.indexOf(target)
    if (idx !== -1) {
      sessionTraits.splice(idx, 1)
      persistSessionTraits()
    }
    return getSessionTraits()
  }

  function classifyTrait(trait) {
    if (typeof trait !== 'string' || !trait.trim()) return 'session'
    const tl = trait.toLowerCase()
    if (PERM_PREFIXES.some((prefix) => tl.startsWith(prefix))) return 'permanent'
    if (PERM_KEYWORDS.some((keyword) => tl.includes(keyword))) return 'permanent'
    if (trait.length < 80 && PERM_HINT_WORDS.some((word) => tl.includes(word))) return 'permanent'
    return 'session'
  }

  function addTrait(trait) {
    const tier = classifyTrait(trait)
    if (tier === 'permanent') {
      permanent = dedupTraits([...permanent, trait])
      persistPermanent()
    } else {
      sessionTraits = dedupTraits([...sessionTraits, trait])
      persistSessionTraits()
    }
    return tier
  }

  function deletePermanent(text) {
    const target = String(text ?? '')
    const idx = permanent.indexOf(target)
    if (idx !== -1) {
      permanent.splice(idx, 1)
      persistPermanent()
    }
    return getPermanent()
  }

  function wipePermanent() {
    permanent = []
    persistPermanent()
    return getPermanent()
  }

  function rotateAndSave() {
    if (sessionTraits.length > MAX_SESSION_TRAITS) {
      sessionTraits = sessionTraits.slice(-MAX_SESSION_TRAITS)
      persistSessionTraits()
    }
    return { permanent: getPermanent(), session: getSessionTraits() }
  }

  function buildMemoryPrompt(save = {}) {
    const sd = isPlainObj(save) ? save : {}
    const parts = []

    const answers = Object.entries(sd.setup_answers ?? {}).filter(
      ([, value]) => value !== undefined && value !== null && String(value).trim() !== '' && value !== 'skip'
    )
    if (answers.length) {
      const profile = answers.map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`).join('; ')
      parts.push(`Profile: ${profile}`)
    }

    if (permanent.length) {
      parts.push('Permanent facts:\n' + permanent.map((fact) => `  - ${fact}`).join('\n'))
    } else {
      parts.push('Permanent facts: None yet.')
    }

    const setupValues = new Set(answers.map(([, value]) => String(value).toLowerCase()))
    const filtered = sessionTraits.filter(
      (trait) => !setupValues.has(String(trait).split(': ').pop().toLowerCase())
    )
    if (filtered.length) {
      const recent = filtered.slice(-PROMPT_SESSION_NOTES_LIMIT)
      parts.push('This session notes:\n' + recent.map((trait) => `  - ${trait}`).join('\n'))
    }

    const summary = sd.session_summary
    if (summary) parts.push(`Last session:\n  ${summary}`)

    return parts.join('\n')
  }

  function needsCompression() {
    return sessionTraits.length >= COMPRESS_THRESHOLD
  }

  function cacheHistory(hist) {
    if (!Array.isArray(hist) || hist.length === 0) return false
    writeJsonAtomic(cachePath, { messages: hist.slice(-CACHE_HISTORY_LIMIT) })
    return true
  }

  function popPendingSummary() {
    if (!fs.existsSync(cachePath)) return null
    const stolenPath = `${cachePath}.pop.tmp`
    try {
      fs.renameSync(cachePath, stolenPath)
    } catch {
      return null
    }
    let messages = null
    try {
      const data = JSON.parse(fs.readFileSync(stolenPath, 'utf8'))
      if (isPlainObj(data) && Array.isArray(data.messages) && data.messages.length) {
        messages = data.messages
      }
    } catch {
      messages = null
    }
    try {
      fs.rmSync(stolenPath, { force: true })
    } catch {
      void 0
    }
    return messages
  }

  function restorePendingSummary(raw) {
    if (!raw) return false
    const messages = Array.isArray(raw) ? raw : isPlainObj(raw) ? raw.messages : null
    if (!Array.isArray(messages) || messages.length === 0) return false
    writeJsonAtomic(cachePath, { messages })
    return true
  }

  return {
    getPermanent,
    getSessionTraits,
    addTrait,
    setSessionTraits,
    removeSessionTrait,
    deletePermanent,
    wipePermanent,
    rotateAndSave,
    buildMemoryPrompt,
    classifyTrait,
    needsCompression,
    cacheHistory,
    popPendingSummary,
    restorePendingSummary
  }
}
