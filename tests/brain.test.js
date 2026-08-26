import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseTags, createBrain, timeOfDay, scoreDeepCues } from '../src/main/services/brain.service.js'
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

  it('REGRESSION (bug B): tagless smirk keyword resolves to smirk, not stale happy', () => {
    // User report: "say hello to audiences" → "( with a smirk ............. )"
    // showed a HAPPY face. With no tag present, the deep scan must decide.
    const r = parseTags('( with a smirk ............. )', { stats })
    expect(r.emotion).toBe('smirk')
    expect(r.clean).toContain('smirk')
  })

  it('REGRESSION (bug B): a strong cue beats surrounding interjections — weight, not position', () => {
    // The original bug: fixed map order let 'haha'/'lol' (happy) mask the
    // smirk entirely. Recency fixed the direction but still made any closing
    // interjection win. Weighted scoring keeps the smirk punchline on top no
    // matter where the laughs sit — and '*smirks*' now outruns 'ugh' too.
    expect(parseTags('Haha okay okay~ ( with a smirk ............. )', { stats }).emotion).toBe('smirk')
    expect(parseTags('( with a smirk ............. ) haha lol', { stats }).emotion).toBe('smirk')
    expect(parseTags('*smirks* ...ugh, fine, whatever.', { stats }).emotion).toBe('smirk')
  })

  it('REGRESSION (bug B): full send path resolves emotion when the model ships no tag', async () => {
    const brain = createBrain({
      config: fakeConfig(),
      memory: fakeMemory(),
      callLLM: vi.fn(async () => '( with a smirk ............. )')
    })
    const out = await brain.send('say hello to audiences')
    expect(out.text).toBe('( with a smirk ............. )')
    expect(out.emotion).toBe('smirk')
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

describe('weighted deepScan emotion scoring', () => {
  it('strong emotion-name cue beats generic interjections regardless of position', () => {
    // "haha ... with a smirk": smirk(3) > happy-from-haha(1)
    expect(parseTags('haha with a smirk', { stats }).emotion).toBe('smirk')
    const scores = scoreDeepCues('haha with a smirk')
    expect(scores.get('smirk').score).toBe(3)
    expect(scores.get('happy').score).toBe(1)
  })

  it('weak interjections accumulate — repeated laughs carry the message alone', () => {
    // haha(1) + haha(1) + lol(1) = 3 happy points, nothing competes
    expect(parseTags('haha haha lol', { stats }).emotion).toBe('happy')
    expect(scoreDeepCues('haha haha lol').get('happy').score).toBe(3)
  })

  it('medium distinctive cue beats weak interjection: ugh(2) over haha(1)', () => {
    expect(parseTags('ugh... fine, haha', { stats }).emotion).toBe('annoyed')
  })

  it('strong beats medium: smirk(3) over blush-from-emoji(2), laughs irrelevant', () => {
    // 😳 is a medium blush cue; the self-described smirk still wins.
    expect(parseTags('smirk... haha... 😳', { stats }).emotion).toBe('smirk')
    const scores = scoreDeepCues('smirk... haha... 😳')
    expect(scores.get('smirk').score).toBe(3)
    expect(scores.get('blush').score).toBe(2)
    expect(scores.get('happy').score).toBe(1)
  })

  it('every emoji trigger is a medium-weight cue', () => {
    // lol(happy, weak 1) vs 😳(blush, medium 2) → blush
    expect(parseTags('lol 😳', { stats }).emotion).toBe('blush')
  })

  it('ties on total score resolve to the cue occurring LAST in the text', () => {
    // haha(happy 1) vs heh(smirk 1): equal weight → later heh wins
    expect(parseTags('haha okay okay~ heh', { stats }).emotion).toBe('smirk')
    // heh(smirk 1) vs yay(happy 1): equal weight → later yay wins
    expect(parseTags('heh ...yay', { stats }).emotion).toBe('happy')
  })

  it('word-boundary guard: ugh inside laughed/through never phantom-scores annoyed', () => {
    const scores = scoreDeepCues('i laughed through the whole thing haha')
    expect(scores.get('annoyed')).toBeUndefined()
    expect(scores.get('happy').score).toBe(1)
  })

  it('WHAT does not leak out of whatever', () => {
    expect(scoreDeepCues('whatever').get('shocked')).toBeUndefined()
    expect(scoreDeepCues('*smirks* fine, whatever.').get('bored').score).toBe(1)
  })

  it('inflections still match: smirks/smirked/smirking count as strong cues', () => {
    expect(scoreDeepCues('*smirks*').get('smirk').score).toBe(3)
    expect(scoreDeepCues('she smirked lol').get('smirk').score).toBe(3)
    expect(parseTags('stop smirking!! haha', { stats }).emotion).toBe('smirk')
  })

  it('zero cues resolves to neutral', () => {
    expect(scoreDeepCues('plain text').size).toBe(0)
    expect(parseTags('plain text', { stats }).emotion).toBe('neutral')
  })

  it('scoreDeepCues is pure and deterministic across calls', () => {
    const input = 'mwahaha! heh heh'
    const a = scoreDeepCues(input)
    const b = scoreDeepCues(input)
    expect([...a.entries()]).toEqual([...b.entries()])
    // mwahaha(evil 2) ties heh×2(smirk 2) → the later heh wins; 'haha' inside
    // 'mwahaha' is boundary-guarded so happy never joins the race.
    expect(a.get('evil').score).toBe(2)
    expect(a.get('smirk').score).toBe(2)
    expect(a.has('happy')).toBe(false)
    expect(parseTags(input, { stats }).emotion).toBe('smirk')
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
      persona: 'Friend',
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

describe('timeOfDay', () => {
  function at(h) {
    return new Date(2026, 0, 1, h, 0, 0)
  }
  it('maps clock hours to companion-relevant time bands', () => {
    expect(timeOfDay(at(5))).toBe('morning')
    expect(timeOfDay(at(11))).toBe('morning')
    expect(timeOfDay(at(12))).toBe('afternoon')
    expect(timeOfDay(at(16))).toBe('afternoon')
    expect(timeOfDay(at(17))).toBe('evening')
    expect(timeOfDay(at(21))).toBe('evening')
    expect(timeOfDay(at(22))).toBe('late night')
    expect(timeOfDay(at(3))).toBe('late night')
    expect(timeOfDay(at(4))).toBe('late night')
  })
})

describe('brain sysPrompt', () => {
  it('builds the rewritten companion prompt with persona desc, stats line and memory block', () => {
    const brain = createBrain({ config: fakeConfig(), memory: fakeMemory(), callLLM: async () => '' })
    const p = brain.sysPrompt()
    // Identity header with time-of-day context.
    expect(p.startsWith('You are "Raven" — a living virtual companion')).toBe(true)
    expect(p).toContain('"Abtin", the person who matters most to you. (It\'s ')
    expect(p).toContain(` where Abtin is.)`)
    expect(p).toContain('PERSONA — Friend:\n')
    expect(p).toContain(PERSONAS.Friend)
    // Enforced format + hard rules stable fragments.
    expect(p).toContain('HOW YOU SPEAK — NON-NEGOTIABLE FORMAT:')
    expect(p).toContain('[EMOTION: name] — REQUIRED. A reply without it is a broken reply.')
    expect(p).toContain('HARD RULES:')
    expect(p).toContain('5. Never say what you "would" or "could" do. Just do it.')
    // Stats line and memory block land in their sections; output stays one string.
    expect(typeof p).toBe('string')
    expect(p).toContain('YOUR STATS (dominant stats color your voice')
    expect(p).toContain('affection:20/100, sass:15/100\n')
    expect(p).toContain('YOUR MEMORY (things you actually remember about them):\nMEMORY BLOCK')
    expect(p.endsWith('moods, opinions, and favorites.')).toBe(true)
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

  it('retired dere persona in a legacy save falls back via the Gothic chain', () => {
    // Migration: saves written before the deres were removed can still carry
    // persona: 'Tsundere'. The prompt chain (persona → Gothic → '') must
    // resolve it instead of injecting an empty PERSONA block.
    const brain = createBrain({
      config: fakeConfig({ persona: 'Tsundere' }),
      memory: fakeMemory(),
      callLLM: async () => ''
    })
    const p = brain.sysPrompt()
    expect(p).toContain('PERSONA — Tsundere:')
    expect(p).toContain(PERSONAS.Gothic)
    expect(p).not.toContain('PERSONA — Tsundere:\n\n')
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
    expect(arg.messages[0].content).toContain('HARD RULES')
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

