import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripReasoning, defaultCallLLM } from '../src/main/providers/llm.js'
import { looksLikeReasoning, createBrain } from '../src/main/services/brain.service.js'
import { sanitizeStoredSummary, createConfigService } from '../src/main/services/config.service.js'
import { truncateAtWord } from '../src/renderer/src/features/companion/greetingText.js'

describe('stripReasoning', () => {
  it('harmony with a final channel keeps only the final payload', () => {
    const raw =
      '<|channel|>analysis<|message|>Here is a thinking process… 1. **Analyze**<|end|>' +
      '<|channel|>final<|message|>Hey! Welcome back~ [EMOTION: happy] 💫'
    expect(stripReasoning(raw)).toBe('Hey! Welcome back~ [EMOTION: happy] 💫')
  })

  it('harmony without a final channel falls back to text after the last marker', () => {
    expect(stripReasoning('<|channel|>final<|message|>Just the answer.')).toBe('Just the answer.')
  })

  it('removes think blocks', () => {
    expect(stripReasoning('<think>secret plan</think>Hello!')).toBe('Hello!')
    expect(stripReasoning('Hi <THINK>noise</Think> there')).toBe('Hi there')
  })

  it('removes a truncated unterminated think block', () => {
    expect(stripReasoning('<think>cut off mid-thought…')).toBe('')
  })

  it('plain text passes through untouched', () => {
    expect(stripReasoning('ordinary companion reply 😊')).toBe('ordinary companion reply 😊')
  })

  it('handles nested/multiple markers and stray special tokens', () => {
    const raw =
      '<|start|>assistant<|channel|>analysis<|message|>a<|end|><|channel|>analysis<|message|>b' +
      '<|end|><|channel|>final<|message|>clean <|endoftext|> tail'
    expect(stripReasoning(raw)).toBe('clean tail')
    // Stray tokens without any channel structure are simply stripped.
    expect(stripReasoning('<|end|>left<|middle|>right')).toBe('leftright')
  })
})

describe('defaultCallLLM strips reasoning at the choke point', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '<|channel|>analysis<|message|>hm<|end|><|channel|>final<|message|>ok!' } }]
      })
    })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returned content is already clean', async () => {
    const out = await defaultCallLLM({ url: 'http://x', key: '', model: 'm', messages: [] })
    expect(out).toBe('ok!')
  })
})

function fakeConfig(saveOverrides = {}, configOverrides = {}) {
  return {
    getSave: () => ({
      user_name: 'Abtin',
      pet_name: 'Raven',
      persona: 'Friend',
      stats: {},
      setup_answers: {},
      session_summary: '',
      brain_mode: 'online',
      ...saveOverrides
    }),
    getConfig: () => ({
      online_api_url: 'http://online.example/v1/chat/completions',
      online_api_key: 'sk-online',
      online_api_model: 'online-m',
      ...configOverrides
    })
  }
}

function fakeMemory(overrides = {}) {
  return {
    buildMemoryPrompt: vi.fn(() => ''),
    popPendingSummary: vi.fn(() => null),
    restorePendingSummary: vi.fn(),
    ...overrides
  }
}

describe('summary reasoning guard', () => {
  function waitMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('max_tokens raised to 300 so reasoning models can finish and answer', async () => {
    const memory = fakeMemory({ popPendingSummary: vi.fn(() => [{ role: 'user', content: 'hi' }]) })
    const callLLM = vi.fn(async () => 'They chatted.')
    const brain = createBrain({ config: fakeConfig(), memory, callLLM, onSummary: vi.fn() })
    await brain.send('yo')
    await waitMicrotasks()
    const summaryCall = callLLM.mock.calls.find(([a]) => a.messages[0].content.startsWith('Summarize'))
    expect(summaryCall[0].maxTokens).toBe(300)
  })

  it('discards a reasoning-channel summary instead of saving it', async () => {
    const memory = fakeMemory({ popPendingSummary: vi.fn(() => [{ role: 'user', content: 'hi' }]) })
    const onSummary = vi.fn()
    const callLLM = vi.fn(async () =>
      '<|channel|>analysis<|message|>thinking about the summary…'
    )
    const brain = createBrain({ config: fakeConfig(), memory, callLLM, onSummary })
    await brain.send('yo')
    await waitMicrotasks()
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('looksLikeReasoning flags markers, thinking openers and empties — not normal prose', () => {
    expect(looksLikeReasoning('<|channel|>final<|message|>x')).toBe(true)
    expect(looksLikeReasoning("Let's see… they talked about tea")).toBe(true)
    expect(looksLikeReasoning('1. First, re-read the conversation')).toBe(true)
    expect(looksLikeReasoning('')).toBe(true)
    expect(looksLikeReasoning('They talked about tea and movies.')).toBe(false)
  })
})

describe('boot repair of stored summaries', () => {
  it('sanitizeStoredSummary cleans or clears poisoned values', () => {
    expect(sanitizeStoredSummary('nice clean recap')).toBe('nice clean recap')
    expect(
      sanitizeStoredSummary('<|channel|>analysis<|message|>raw thoughts… <|end|>')
    ).toBe('')
    expect(sanitizeStoredSummary(undefined)).toBe('')
  })

  it('a corrupted save.json gets cleaned/cleared on the boot path and persisted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-summary-repair-'))
    const dataDir = path.join(root, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    const corrupted = {
      persona: 'Gothic',
      session_summary:
        '<|channel|>analysis<|message|>Here is a thinking process to arrive at the summary: 1. Analyze…'
    }
    fs.writeFileSync(path.join(dataDir, 'save.json'), JSON.stringify(corrupted))

    const config = createConfigService({ rootDir: root })
    expect(config.getSave().session_summary).toBe('')

    // Persisted cleaned value, not just in-memory.
    const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'save.json'), 'utf8'))
    expect(written.session_summary).toBe('')

    // A healthy summary survives untouched (and is left byte-identical).
    fs.writeFileSync(
      path.join(dataDir, 'save.json'),
      JSON.stringify({ persona: 'Gothic', session_summary: 'cozy chat about pizza ' })
    )
    const second = createConfigService({ rootDir: root })
    expect(second.getSave().session_summary).toBe('cozy chat about pizza')
  })

  it('partial repair strips channels but keeps the real recap', () => {
    expect(
      sanitizeStoredSummary('<think>hmm</think>Last time you told me about your new job!')
    ).toBe('Last time you told me about your new job!')
  })
})

describe('truncateAtWord', () => {
  it('passes short strings through untouched', () => {
    expect(truncateAtWord('short summary', 80)).toBe('short summary')
  })

  it('cuts ≤80 chars at the last space, never mid-word, and appends …', () => {
    const s = 'word '.repeat(30).trim() // 149 chars, spaces every 5
    const out = truncateAtWord(s, 80)
    expect(out.length).toBeLessThanOrEqual(81) // + ellipsis
    expect(out.endsWith('…')).toBe(true)
    // The cut lands exactly where the original has a space (word boundary).
    const prefix = out.slice(0, -1)
    expect(s.startsWith(prefix)).toBe(true)
    expect([' ', undefined]).toContain(s[prefix.length])
  })

  it('a single word longer than max still truncates without hanging', () => {
    const out = truncateAtWord('x'.repeat(120), 80)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(81)
  })

  it('coerces non-strings', () => {
    expect(truncateAtWord(null)).toBe('')
    expect(truncateAtWord(undefined)).toBe('')
  })
})
