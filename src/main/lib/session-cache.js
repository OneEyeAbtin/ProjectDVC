// Composes the shutdown half of the session-cache pipeline:
// memory.cacheHistory(brain.history) writes data/memory/session-cache.json so
// the NEXT boot's compressPending() can summarize it into session_summary.
//
// The returned flusher is idempotent per process — index.js wires it to BOTH
// quit paths (app 'before-quit' and the window-service close-when-not-hiding
// path), and whichever fires first wins; the second call is a no-op, guarding
// against double-writes. Services are read through getServices() at call time
// so a profile:factory-reset swap is always reflected.
export function createQuitFlush({ getServices }) {
  let flushed = false
  return function flushSessionCache() {
    if (flushed) return false
    flushed = true
    try {
      const { memory, brain } = getServices()
      return Boolean(memory?.cacheHistory?.(brain?.history))
    } catch {
      return false
    }
  }
}
