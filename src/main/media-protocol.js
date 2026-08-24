import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json'
}

/**
 * Pure path resolution for the dvc-media scheme. Returns the absolute file
 * path when `urlPath` (e.g. "/tts-cache/tts_3.mp3") lives strictly inside
 * one of the allowlisted roots; null otherwise. Guards against traversal,
 * encoded traversal, and absolute-path escapes.
 *
 * Each root is either an absolute directory string (URL path joins directly)
 * or `{ mount, root }` where the first URL segment must equal `mount` and is
 * stripped before resolving (e.g. "/tts-cache/x" → <root>/x).
 */
export function resolveMediaPath(urlPath, roots) {
  if (!Array.isArray(roots) || roots.length === 0) return null

  let rel
  try {
    rel = decodeURIComponent(String(urlPath ?? ''))
  } catch {
    return null
  }
  rel = rel.replace(/^\/+/, '')
  // Media URLs are posix-style; backslashes are never legitimate here.
  if (!rel || rel.includes('\\')) return null

  const normalized = path.normalize(rel)
  // Windows drive letters / UNC paths survive normalize as absolute.
  if (normalized === '.' || path.isAbsolute(normalized) || normalized.includes('..')) return null

  for (const entry of roots) {
    const isMount = entry !== null && typeof entry === 'object'
    const absRoot = path.resolve(isMount ? entry.root : entry)
    let rest = normalized

    if (isMount) {
      const mount = String(entry.mount ?? '').replace(/^\/+|\/+$/g, '')
      if (!mount) continue
      const parts = normalized.split('/')
      if (parts[0] !== mount || parts.length < 2) continue
      rest = parts.slice(1).join('/')
    }

    const candidate = path.resolve(absRoot, rest)
    if (candidate.startsWith(absRoot + path.sep)) return candidate
  }
  return null
}

/**
 * Registers the dvc-media:// handler serving ONLY files under getRoots().
 * Must be called after registerSchemesAsPrivileged (done at module scope in
 * index.js, before app ready).
 */
export function registerMediaProtocol({ getRoots }) {
  protocol.handle('dvc-media', (request) => {
    let pathname
    try {
      pathname = new URL(request.url).pathname
    } catch {
      return new Response(null, { status: 400 })
    }

    const filePath = resolveMediaPath(pathname, getRoots())
    if (!filePath) return new Response(null, { status: 403 })

    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response(null, { status: 404 })
      }
      const type = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(fs.readFileSync(filePath), {
        headers: { 'Content-Type': type }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
