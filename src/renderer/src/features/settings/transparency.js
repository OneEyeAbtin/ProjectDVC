// Reduce-transparency preference (Settings → General → Effects) → DOM class
// bridge. The CSS side lives in global.css: `html.reduce-transparency` kills
// every backdrop-filter and swaps glass mixes for opaque fills. Pure enough
// to unit test — the root element is injected.

export const REDUCE_TRANSPARENCY_CLASS = 'reduce-transparency'

// Toggle the class on <html>; anything non-truthy clears it. Guarded so a
// missing root (SSR/test stubs) can never throw.
export function applyTransparencyPreference(root, enabled) {
  if (!root || typeof root.classList?.toggle !== 'function') return false
  return root.classList.toggle(REDUCE_TRANSPARENCY_CLASS, Boolean(enabled))
}
