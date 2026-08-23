const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_TEMPERATURE = 0.85
const DEFAULT_MAX_TOKENS = 300

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
    return content
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
