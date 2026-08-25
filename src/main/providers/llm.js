const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_TEMPERATURE = 0.85
const DEFAULT_MAX_TOKENS = 300

// Reasoning-model output scrubber — the SINGLE choke point for every LLM
// response consumed by the app (chat replies, session summaries, MC brain).
// Handles, in order:
//   1. Harmony format (`<|channel|>analysis<|message|>…<|end|>…
//      <|channel|>final<|message|>ANSWER`) → keep only the text after the
//      LAST `<|message|>` marker (the final channel's payload).
//   2. `<think>…</think>` blocks (and a truncated unterminated `<think>…`)
//      → removed entirely.
//   3. Any remaining `<|…|>` special tokens → stripped.
// Plain text passes through untouched.
export function stripReasoning(text) {
  let out = String(text ?? '')
  const lastMessage = out.lastIndexOf('<|message|>')
  if (lastMessage !== -1) out = out.slice(lastMessage + '<|message|>'.length)
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const openThink = out.toLowerCase().indexOf('<think>')
  if (openThink !== -1) out = out.slice(0, openThink)
  out = out.replace(/<\|[^>]*\|>/g, '')
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

export async function defaultCallLLM({
  url,
  key,
  model,
  messages,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = DEFAULT_TEMPERATURE,
  maxTokens = DEFAULT_MAX_TOKENS
}) {
  if (!url) throw new Error('LLM URL is not configured — set it in Settings.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`LLM request failed (HTTP ${res.status} ${res.statusText}).`)
    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('LLM response was missing message content.')
    }
    return stripReasoning(content)
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`LLM request timed out after ${timeoutMs}ms.`)
    }
    if (err instanceof Error && err.message.startsWith('LLM ')) throw err
    throw new Error(`LLM request failed: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
}
