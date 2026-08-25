import fs from 'node:fs'
import path from 'node:path'
import { DEFAULTS, SETTINGS_KEYS, SAVE_KEYS } from '../data/defaults.js'
import { THEMES_NAME_TO_ID, DEFAULT_THEME_ID } from '../data/themes.js'
import { atomicWrite, writeJsonAtomic } from '../lib/atomic.js'
import { stripReasoning } from '../providers/llm.js'

const SETTINGS_DEFAULTS = DEFAULTS
const SAVE_DEFAULTS = Object.fromEntries(SAVE_KEYS.map((k) => [k, structuredClone(DEFAULTS[k])]))

// Boot repair for the reasoning-token leak (bug wave): a session_summary saved
// before stripReasoning existed can carry raw model reasoning channels. Strip;
// if nothing sane remains, clear it. A harmony payload with NO final channel
// means the visible text IS the thinking — clear that too. Returns the
// cleaned value.
export function sanitizeStoredSummary(value) {
  if (typeof value !== 'string') return ''
  const hadHarmony = value.includes('<|channel|>')
  const cleaned = stripReasoning(value)
  if (!cleaned || cleaned.includes('<|')) return ''
  if (hadHarmony && !value.includes('<|channel|>final<|message|>')) return ''
  return cleaned
}

function isPlainObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function deepMerge(base, patch) {
  if (!isPlainObj(patch)) return patch === undefined ? base : patch
  const out = isPlainObj(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) {
    // Prototype-pollution guard: never copy structural keys from untrusted
    // (IPC-supplied) patches onto fresh objects.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    out[key] = isPlainObj(value) && isPlainObj(out[key]) ? deepMerge(out[key], value) : structuredClone(value)
  }
  return out
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return isPlainObj(parsed) ? parsed : structuredClone(fallback)
  } catch {
    return structuredClone(fallback)
  }
}

export function createConfigService({ rootDir }) {
  const dataDir = path.join(rootDir, 'data')
  const memoryDir = path.join(dataDir, 'memory')
  const configPath = path.join(dataDir, 'config.json')
  const savePath = path.join(dataDir, 'save.json')

  fs.mkdirSync(memoryDir, { recursive: true })

  let config = deepMerge(SETTINGS_DEFAULTS, loadJson(configPath, {}))
  let save = deepMerge(SAVE_DEFAULTS, loadJson(savePath, {}))

  // One-time sanitize of a stored summary on every service construction
  // (= app boot and factory reset). Persist only when it actually changed so
  // healthy saves never rewrite the file.
  if (typeof save.session_summary === 'string') {
    const cleaned = sanitizeStoredSummary(save.session_summary)
    if (cleaned !== save.session_summary) {
      save.session_summary = cleaned
      writeJsonAtomic(savePath, save)
    }
  }

  if (!fs.existsSync(configPath)) writeJsonAtomic(configPath, config)
  if (!fs.existsSync(savePath)) writeJsonAtomic(savePath, save)

  function getConfig() {
    return structuredClone(config)
  }

  function getSave() {
    return structuredClone(save)
  }

  // Patches return defensive copies (matching the getters) so callers can
  // never hold a live reference into internal state.
  function patchConfig(patch) {
    config = deepMerge(config, patch)
    writeJsonAtomic(configPath, config)
    return structuredClone(config)
  }

  function patchSave(patch) {
    save = deepMerge(save, patch)
    writeJsonAtomic(savePath, save)
    return structuredClone(save)
  }

  function setSaveEntries(entries) {
    for (const [key, value] of Object.entries(entries)) {
      if (!SAVE_KEYS.includes(key)) continue
      save[key] = structuredClone(value)
    }
    writeJsonAtomic(savePath, save)
    return getSave()
  }

  function migrateLegacyIfNeeded() {
    const markerPath = path.join(memoryDir, '.migrated')
    if (fs.existsSync(markerPath)) return false

    const legacyProfilePath = path.join(rootDir, 'dvc_profile.json')
    if (fs.existsSync(legacyProfilePath)) {
      let legacy = {}
      try {
        const parsed = JSON.parse(fs.readFileSync(legacyProfilePath, 'utf8'))
        if (isPlainObj(parsed)) legacy = parsed
      } catch {
        legacy = {}
      }

      const settingsPatch = {}
      const savePatch = {}
      for (const [key, value] of Object.entries(legacy)) {
        if (key === 'theme') {
          savePatch.theme_id =
            typeof value === 'string' ? (THEMES_NAME_TO_ID[value] ?? DEFAULT_THEME_ID) : DEFAULT_THEME_ID
          continue
        }
        if (SAVE_KEYS.includes(key)) {
          savePatch[key] = structuredClone(value)
          continue
        }
        if (SETTINGS_KEYS.includes(key)) {
          settingsPatch[key] = structuredClone(value)
        }
      }

      config = deepMerge(config, settingsPatch)
      save = deepMerge(save, savePatch)
      writeJsonAtomic(configPath, config)
      writeJsonAtomic(savePath, save)

      const traitsPath = path.join(rootDir, 'traits.txt')
      if (fs.existsSync(traitsPath)) {
        try {
          const lines = fs
            .readFileSync(traitsPath, 'utf8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          if (lines.length) writeJsonAtomic(path.join(memoryDir, 'session-traits.json'), lines)
        } catch {
          /* traits.txt unreadable — skip */
        }
      }

      const legacyFactsPath = path.join(dataDir, 'permanent_facts.json')
      if (fs.existsSync(legacyFactsPath)) {
        try {
          const facts = JSON.parse(fs.readFileSync(legacyFactsPath, 'utf8'))
          if (Array.isArray(facts) && facts.length) {
            writeJsonAtomic(path.join(memoryDir, 'permanent-facts.json'), facts.filter((f) => typeof f === 'string'))
          }
        } catch {
          /* permanent_facts.json unreadable — skip */
        }
      }
    }

    atomicWrite(markerPath, new Date().toISOString())
    return true
  }

  return { rootDir, getConfig, getSave, patchConfig, patchSave, setSaveEntries, migrateLegacyIfNeeded }
}
