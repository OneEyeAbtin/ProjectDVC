import fs from 'node:fs'
import path from 'node:path'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const TRANSIENT_EMOTIONS = ['talking', 'fullbody']

export function createCharactersService({ outfitsDir, emotions = [] }) {
  const allEmotions = new Set([...emotions, ...TRANSIENT_EMOTIONS].map((e) => String(e).toLowerCase()))
  let files = null
  let registry = new Map()
  let prefixSprites = new Map()

  function ensureScanned() {
    if (files === null) scan()
    return files
  }

  function scan() {
    files = {}
    const prefixes = new Set([''])
    if (!fs.existsSync(outfitsDir)) return files
    for (const entry of fs.readdirSync(outfitsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const stem = path.basename(entry.name, ext).toLowerCase()
      files[stem] = path.resolve(outfitsDir, entry.name)
      for (const emotion of allEmotions) {
        if (stem.endsWith(emotion) && stem.length > emotion.length) {
          prefixes.add(stem.slice(0, stem.length - emotion.length))
        }
      }
    }
    registerPrefixes([...prefixes].sort())
    assignSprites()
    return files
  }

  function assignSprites() {
    prefixSprites = new Map()
    const owned = new Set()
    const sorted = [...registry.keys()].sort((a, b) => b.length - a.length)
    for (const stem of Object.keys(files)) {
      const owner = sorted.find(
        (p) => stem.startsWith(p) && stem.length > p.length && !owned.has(stem)
      )
      if (owner === undefined) continue
      owned.add(stem)
      if (!prefixSprites.has(owner)) prefixSprites.set(owner, {})
      prefixSprites.get(owner)[stem.slice(owner.length)] = files[stem]
    }
  }

  function registerPrefixes(prefixes) {
    for (const prefix of prefixes) {
      if (registry.has(prefix)) continue
      let display = prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : 'Base'
      while ([...registry.values()].includes(display)) display += ' Outfit'
      registry.set(prefix, display)
    }
  }

  function manifest() {
    ensureScanned()
    return [...registry.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([prefix, name]) => ({
        name,
        prefix,
        count: [...emotions]
          .map((e) => String(e).toLowerCase())
          .filter((e) => Boolean(files[`${prefix}${e}`])).length,
        hasFullbody: Boolean(files[`${prefix}fullbody`]),
        sprites: { ...(prefixSprites.get(prefix) ?? {}) }
      }))
  }

  function resolveSprite(outfitPrefix, emotion) {
    const cached = ensureScanned()
    const prefix = String(outfitPrefix ?? '').toLowerCase()
    const emo = String(emotion ?? '').toLowerCase()
    const candidates = prefix
      ? [`${prefix}${emo}`, `${prefix}neutral`, emo, 'neutral']
      : [emo, 'neutral']
    for (const key of new Set(candidates)) {
      if (cached[key]) return cached[key]
    }
    return null
  }

  return { scan, manifest, resolveSprite }
}
