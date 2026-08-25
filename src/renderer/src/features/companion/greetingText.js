// Greeting text helpers — pure, unit-testable string shaping for Companion.

// Truncate at a WORD boundary: ≤max chars kept, cut back to the last space and
// closed with an ellipsis (never mid-word like String.slice did).
export function truncateAtWord(text, max = 80) {
  const s = String(text ?? '').trim()
  if (s.length <= max) return s
  const cut = s.lastIndexOf(' ', max)
  return `${cut > 0 ? s.slice(0, cut) : s.slice(0, max).split(' ')[0]}…`
}
