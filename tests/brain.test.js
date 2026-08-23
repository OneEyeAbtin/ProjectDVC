import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseTags, createBrain } from '../src/main/services/brain.service.js'
import { defaultCallLLM } from '../src/main/providers/llm.js'
import { PERSONAS } from '../src/main/data/personas.js'

const stats = { affection: 20, sass: 15 }

describe('parseTags', () => {
  it('extracts emotion, strips tags, applies remap', () => {
    const r = parseTags('Hmph! Whatever. [EMOTION: smug]', { stats })
    expect(r.clean).toBe('Hmph! Whatever.')
    expect(r.emotion).toBe('smirk')
    expect(r.remappedEmotion).toBe('smirk')
  })

  it('applies stat deltas clamped 0..100', () => {
    const r = parseTags('nice [STAT: affection +5] [STAT: sass -50]', { stats })
    expect(r.statDeltas).toEqual([{ key: 'affection', delta: 5 }, { key: 'sass', delta: -50 }])
    expect(r.applyTo(stats)).toEqual({ ...stats, affection: 25, sass: 0 })
  })

  it('applyTo returns a new object and never mutates input', () => {
    const snapshot = { ...stats }
    const r = parseTags('[STAT: affection +5]', { stats })
    const next = r.applyTo(stats)
    expect(next).not.toBe(stats)
    expect(stats).toEqual(snapshot)
  })

  it('falls back to deep-scan keywords then neutral', () => {
    expect(parseTags('wow amazing awesome!!', { stats }).emotion).toBe('excited')
    expect(parseTags('plain text', { stats }).emotion).toBe('neutral')
  })

  it('collects traits', () => {
    const r = parseTags('[TRAIT: user likes tea] ok!', { stats })
    expect(r.traits).toEqual(['user likes tea'])
    expect(r.clean).toBe('ok!')
  })

  it('unknown emotion tag validates to neutral without deep-scan', () => {
    const r = parseTags('wow amazing!! [EMOTION: banana]', { stats })
    expect(r.emotion).toBe('neutral')
    expect(r.remappedEmotion).toBe('banana')
  })

  it('ignores stat deltas for unknown stat keys', () => {
    const r = parseTags('[STAT: nope +9]', { stats })
    expect(r.statDeltas).toEqual([])
    expect(r.applyTo(stats)).toEqual(stats)
  })
})

describe('defaultCallLLM', () => {
  let captured
  beforeEach(() => {
    captured = {}
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.url = url
      captured.opts = opts
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) }
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts openai-style payload with bearer auth and returns content', async () => {
    const out = await defaultCallLLM({
      url: 'http://localhost:1234/v1/chat/completions',
      key: 'sk-test',
      model: 'm1',
      messages: [{ role: 'user', content: 'yo' }],
      timeoutMs: 500
    })
    expect(out).toBe('hi')
    expect(captured.url).toBe('http://localhost:1234/v1/chat/completions')
    expect(captured.opts.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(captured.opts.body)
    expect(body.model).toBe('m1')
    expect(body.messages).toEqual([{ role: 'user', content: 'yo' }])
    expect(body.stream).toBe(false)
  })

  it('omits auth header when key empty', async () => {
    await defaultCallLLM({ url: 'http://x', key: '', model: 'm', messages: [] })
    expect(captured.opts.headers.Authorization).toBeUndefined()
  })

  it('throws friendly message on http error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })))
    await expect(defaultCallLLM({ url: 'http://x', key: 'k', model: 'm', messages: [] }))
      .rejects.toThrow(/401/)
  })

  it('throws friendly message when content missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ choices: [] }) })))
    await expect(defaultCallLLM({ url: 'http://x', key: '', model: 'm', messages: [] }))
      .rejects.toThrow(/content/i)
  })
})

function fakeConfig(saveOverrides = {}, configOverrides = {}) {
  return {
    getSave: () => ({
      user_name: 'Abtin',
      pet_name: 'Raven',
      persona: 'Tsundere',
      stats: { ...stats },
      setup_answers: {},
      session_summary: '',
      brain_mode: 'online',
      ...saveOverrides
    }),
    getConfig: () => ({
      online_api_url: 'http://online.example/v1/chat/completions',
      online_api_key: 'sk-online',
      online_api_model: 'online-m',
      local_api_url: 'http://localhost:1234/v1/chat/completions',
      local_api_key: '',
      local_api_model: '',
      max_history: 20,
      ...configOverrides
    })
  }
}

function fakeMemory(overrides = {}) {
  return {
    buildMemoryPrompt: vi.fn(() => 'MEMORY BLOCK'),
    popPendingSummary: vi.fn(() => null),
    restorePendingSummary: vi.fn(),
    ...overrides
  }
}

describe('brain sysPrompt', () => {
  it('ports legacy rules with persona desc, stats line and memory block', () => {
    const brain = createBrain({ config: fakeConfig(), memory: fakeMemory(), callLLM: async () => '' })
    const p = brain.sysPrompt()
    expect(p.startsWith('You are "Raven", a virtual companion. The user is "Abtin".\n')).toBe(true)
    expect(p).toContain('PERSONA: Tsundere\n')
    expect(p).toContain(PERSONAS.Tsundere)
    expect(p).toContain('STATS: affection:20/100, sass:15/100\n')
    expect(p).toContain("9. Never describe what you 'would' do or 'could' say. Just do it.\n")
    expect(p.endsWith('MEMORY:\nMEMORY BLOCK')).toBe(true)
    expect(brain.history).toEqual([])
  })

  it('unknown persona falls back to Gothic description, never empty', () => {
    const brain = createBrain({
      config: fakeConfig({ persona: 'Nonexistent' }),
      memory: fakeMemory(),
      personaName: 'Also-Missing',
      callLLM: async () => ''
    })
    expect(brain.sysPrompt()).toContain(PERSONAS.Gothic)
  })
})

describe('brain send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('online mode calls llm with system prompt + history and parses reply', async () => {
    const callLLM = vi.fn(async () => 'Hello there! [EMOTION: happy] [STAT: affection +5] 😊')
    const brain = createBrain({ config: fakeConfig(), memory: fakeMemory(), callLLM })
    const out = await brain.send('hi')
    expect(callLLM).toHaveBeenCalledTimes(1)
    const arg = callLLM.mock.calls[0][0]
    expect(arg.url).toBe('http://online.example/v1/chat/completions')
    expect(arg.key).toBe('sk-online')
    expect(arg.model).toBe('online-m')
    expect(arg.messages[0].role).toBe('system')
    expect(arg.messages[0].content).toContain('STRICT RULES')
    expect(arg.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(out.text).toBe('Hello there!   😊')
    expect(out.emotion).toBe('happy')
    expect(out.statDeltas).toEqual([{ key: 'affection', delta: 5 }])
    expect(brain.history).toHaveLength(2)
    expect(brain.history[1].content).toContain('[EMOTION: happy]')
  })

  it('online mode without api key returns confused prompt without network', async () => {
    const callLLM = vi.fn(async () => 'nope')
    const config = fakeConfig({}, { online_api_key: '' })
    const brain = createBrain({ config, memory: fakeMemory(), callLLM })
    const out = await brain.send('hi')
    expect(callLLM).not.toHaveBeenCalled()
    expect(out.emotion).toBe('confused')
    expect(out.text).toContain('API key')
  })

  it('local mode uses local endpoint and dead messages on error', async () => {
    const callLLM = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const config = fakeConfig({ brain_mode: 'local' })
    const brain = createBrain({ config, memory: fakeMemory(), callLLM })
    const out = await brain.send('hello')
    const arg = callLLM.mock.calls[0][0]
    expect(arg.url).toBe('http://localhost:1234/v1/chat/completions')
    expect(out.text.length).toBeGreaterThan(0)
    expect(brain.history.at(-1).role).toBe('assistant')
    expect(brain.history.at(-1).content).toBe(out.raw)
  })

  it('offline mode answers from fallback rules with no network', async () => {
    const callLLM = vi.fn(async () => 'nope')
    const config = fakeConfig({ brain_mode: 'offline' })
    const brain = createBrain({ config, memory: fakeMemory(), callLLM })
    const out = await brain.send('HELLO there')
    expect(callLLM).not.toHaveBeenCalled()
    expect(out.text).toContain('Hey Abtin!')
    expect(out.emotion).toBe('happy')
  })

  it('offline mode applies fallback rule stat deltas', async () => {
    const config = fakeConfig({ brain_mode: 'offline', stats: { ...stats, loyalty: 10 } })
    const brain = createBrain({ config, memory: fakeMemory(), callLLM: async () => 'x' })
    const out = await brain.send('i am sad today')
    expect(out.statDeltas).toContainEqual({ key: 'loyalty', delta: 2 })
  })

  it('offline mode falls back to random pool for unmatched input', async () => {
    const config = fakeConfig({ brain_mode: 'offline' })
    const brain = createBrain({ config, memory: fakeMemory(), callLLM: async () => 'x' })
    const out = await brain.send('qwzx blorp')
    expect(['thinking', 'excited', 'smirk', 'happy', 'confused', 'bored']).toContain(out.emotion)
  })

  it('trims history to max_history and never stores system prompt', async () => {
    const config = fakeConfig({}, { max_history: 4 })
    const brain = createBrain({ config, memory: fakeMemory(), callLLM: async () => 'k [EMOTION: neutral]' })
    for (let i = 0; i < 5; i++) await brain.send(`msg ${i}`)
    expect(brain.history.length).toBeLessThanOrEqual(4)
    expect(brain.history.every((m) => m.role !== 'system')).toBe(true)
    expect(brain.history[0].content).not.toBe('msg 0')
  })

  it('ignores empty input', async () => {
    const callLLM = vi.fn(async () => 'x')
    const brain = createBrain({ config: fakeConfig(), memory: fakeMemory(), callLLM })
    expect(await brain.send('   ')).toBeNull()
    expect(callLLM).not.toHaveBeenCalled()
    expect(brain.history).toHaveLength(0)
  })
})

describe('lazy summary compression', () => {
  function waitMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('fires summary request on first send and saves via onSummary', async () => {
    const raw = [
      { role: 'user', content: 'i love tea' },
      { role: 'assistant', content: 'noted! [EMOTION: happy]' }
    ]
    const memory = fakeMemory({ popPendingSummary: vi.fn(() => raw) })
    const onSummary = vi.fn()
    const callLLM = vi.fn(async ({ messages }) =>
      messages[0].content.startsWith('Summarize this conversation')
        ? 'They talked about tea.'
        : 'cool [EMOTION: happy]')
    const brain = createBrain({ config: fakeConfig(), memory, callLLM, onSummary })
    await brain.send('new msg')
    await waitMicrotasks()
    const summaryCall = callLLM.mock.calls.find(([a]) => a.messages[0].content.startsWith('Summarize'))
    expect(summaryCall).toBeDefined()
    expect(summaryCall[0].messages[0].content).toContain('Abtin: i love tea')
    expect(summaryCall[0].messages[0].content).toContain('Raven: noted!')
    expect(onSummary).toHaveBeenCalledWith('They talked about tea.')
    expect(memory.restorePendingSummary).not.toHaveBeenCalled()
  })

  it('restores pending history when summarization fails', async () => {
    const raw = [{ role: 'user', content: 'a' }]
    const restore = vi.fn()
    const memory = fakeMemory({
      popPendingSummary: vi.fn(() => raw),
      restorePendingSummary: restore
    })
    const callLLM = vi.fn(async ({ messages }) => {
      if (messages[0].content.startsWith('Summarize')) throw new Error('boom')
      return 'ok'
    })
    const brain = createBrain({ config: fakeConfig(), memory, callLLM, onSummary: vi.fn() })
    await brain.send('new msg')
    await waitMicrotasks()
    expect(restore).toHaveBeenCalledWith(raw)
    expect(brain.history.at(-1).content).toBe('ok')
  })

  it('skips compression in offline mode', async () => {
    const memory = fakeMemory({ popPendingSummary: vi.fn(() => [{ role: 'user', content: 'a' }]) })
    const onSummary = vi.fn()
    const config = fakeConfig({ brain_mode: 'offline' })
    const brain = createBrain({ config, memory, callLLM: async () => 'x', onSummary })
    await brain.send('new msg')
    await waitMicrotasks()
    expect(onSummary).not.toHaveBeenCalled()
    expect(memory.restorePendingSummary).not.toHaveBeenCalled()
  })
})

