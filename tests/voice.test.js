import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
}))

vi.mock('msedge-tts', () => {
  class MsEdgeTTS {
    setMetadata = vi.fn().mockResolvedValue(undefined)
    toStream = () => {
      throw new Error('ws connect refused')
    }
    close = () => {}
  }
  return { MsEdgeTTS, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3' } }
})

import {
  EMOTION_SETTINGS,
  VoiceQuotaError,
  synthesize as synthesizeElevenLabs
} from '../src/main/providers/tts/elevenlabs.js'
import { synthesize as synthesizeEdge } from '../src/main/providers/tts/edge.js'
import { synthesize as synthesizePiper } from '../src/main/providers/tts/piper.js'

let dir
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-tts-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const outMp3 = () => path.join(dir, 'out.mp3')

describe('EMOTION_SETTINGS map integrity (vs legacy tts_elevenlabs.py)', () => {
  it('has exactly the 18 legacy emotions', () => {
    const expected = [
      'neutral', 'happy', 'excited', 'love', 'blush', 'sad', 'angry', 'annoyed',
      'shocked', 'thinking', 'confused', 'sleepy', 'bored', 'smirk', 'mocking',
      'eyeroll', 'evil', 'disgusted'
    ]
    expect(Object.keys(EMOTION_SETTINGS).sort()).toEqual([...expected].sort())
  })

  it('spot-checks five entries verbatim from legacy', () => {
    expect(EMOTION_SETTINGS.neutral).toEqual({
      stability: 0.5, similarity_boost: 0.75, style: 0.1, speaker_boost: true
    })
    expect(EMOTION_SETTINGS.angry).toEqual({
      stability: 0.15, similarity_boost: 0.9, style: 0.9, speaker_boost: true
    })
    expect(EMOTION_SETTINGS.sleepy).toEqual({
      stability: 0.85, similarity_boost: 0.65, style: 0.05, speaker_boost: false
    })
    expect(EMOTION_SETTINGS.shocked).toEqual({
      stability: 0.1, similarity_boost: 0.9, style: 0.85, speaker_boost: true
    })
    expect(EMOTION_SETTINGS.disgusted).toEqual({
      stability: 0.3, similarity_boost: 0.8, style: 0.65, speaker_boost: true
    })
  })
})

describe('VoiceQuotaError', () => {
  it('is instanceof-checkable across module boundaries', () => {
    const err = new VoiceQuotaError('HTTP 402')
    expect(err).toBeInstanceOf(VoiceQuotaError)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('VoiceQuotaError')
    expect(err.message).toContain('402')
  })
})

describe('elevenlabs provider', () => {
  const cfg = { api_key: 'sk-test', voice_id: 'voice-1', model_id: 'eleven_flash_v2_5' }

  function stubFetch(payload) {
    const fetchMock = vi.fn().mockResolvedValue(payload)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('posts to the TTS endpoint with xi-api-key + voice settings and writes the file', async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('fake-mp3-bytes').buffer
    })
    const out = outMp3()
    const returned = await synthesizeElevenLabs({
      text: 'hello there', emotion: 'angry', outPath: out, cfg
    })

    expect(returned).toBe(out)
    expect(fs.readFileSync(out, 'utf8')).toBe('fake-mp3-bytes')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128')
    expect(init.headers['xi-api-key']).toBe('sk-test')
    const body = JSON.parse(init.body)
    expect(body.text).toBe('hello there')
    expect(body.model_id).toBe('eleven_flash_v2_5')
    // angry settings ported from legacy, speaker_boost mapped to use_speaker_boost
    expect(body.voice_settings).toEqual({
      stability: 0.15, similarity_boost: 0.9, style: 0.9, use_speaker_boost: true
    })
  })

  it('falls back to neutral for unknown emotions', async () => {
    const fetchMock = stubFetch({
      ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4)
    })
    await synthesizeElevenLabs({ text: 'hi', emotion: 'nope', outPath: outMp3(), cfg })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.voice_settings.stability).toBe(0.5)
    expect(body.voice_settings.similarity_boost).toBe(0.75)
  })

  it.each([401, 402, 403, 429])('classifies HTTP %i as VoiceQuotaError naming the status', async (status) => {
    stubFetch({ ok: false, status, statusText: 'nope' })
    await expect(
      synthesizeElevenLabs({ text: 'hi', emotion: 'neutral', outPath: outMp3(), cfg })
    ).rejects.toSatisfy((err) => err instanceof VoiceQuotaError && err.message.includes(String(status)))
  })

  it('non-quota errors stay plain Errors', async () => {
    stubFetch({ ok: false, status: 500, statusText: 'boom' })
    await expect(
      synthesizeElevenLabs({ text: 'hi', emotion: 'neutral', outPath: outMp3(), cfg })
    ).rejects.toSatisfy((err) => !(err instanceof VoiceQuotaError) && /500/.test(err.message))
  })

  it('throws when not configured', async () => {
    await expect(
      synthesizeElevenLabs({ text: 'hi', emotion: 'neutral', outPath: outMp3(), cfg: {} })
    ).rejects.toThrow(/not configured/)
  })
})

describe('piper provider', () => {
  it('throws a friendly error naming the engine when the model is missing', async () => {
    await expect(
      synthesizePiper({ text: 'hi', outPath: path.join(dir, 'o.wav'), cfg: {} })
    ).rejects.toThrow(/Piper voice model not found/)
  })

  it('throws a friendly error naming the engine when the binary is missing', async () => {
    // linux PATH lookup of a binary that does not exist in the test env
    if (process.platform === 'win32') return
    const model = path.join(dir, 'voice.onnx')
    fs.writeFileSync(model, '')
    await expect(
      synthesizePiper({ text: 'hi', outPath: path.join(dir, 'o.wav'), cfg: { voice: model } })
    ).rejects.toThrow(/Piper binary not found/)
  })
})

describe('edge provider', () => {
  it('surfaces failures wrapped with the engine name', async () => {
    await expect(
      synthesizeEdge({ text: 'hi', outPath: outMp3(), cfg: { edge_voice: '' } })
    ).rejects.toThrow(/Edge TTS failed/)
  })
})

// ── voice service + media protocol ──────────────────────────────────────────

import { on } from '../src/main/bus.js'
import { cleanSpeechText, createVoiceService, chainFor } from '../src/main/services/voice.service.js'
import { resolveMediaPath } from '../src/main/media-protocol.js'
import { createConfigService } from '../src/main/services/config.service.js'

function stubProvider(name, behavior) {
  const calls = []
  const fn = vi.fn(async ({ text, emotion, outPath }) => {
    calls.push({ name, text, emotion, outPath })
    if (behavior) await behavior({ text, emotion, outPath })
    return outPath
  })
  return { fn, calls }
}

function makeService({
  configPatch = {},
  elevenlabs,
  edge,
  piper
} = {}) {
  const config = createConfigService({ rootDir: dir })
  if (Object.keys(configPatch).length) config.patchConfig(configPatch)
  return {
    config,
    svc: createVoiceService({
      rootDir: dir,
      getConfig: () => config.getConfig(),
      providers: {
        elevenlabs: elevenlabs?.impl ?? { synthesize: elevenlabs?.fn ?? vi.fn() },
        edge: edge?.impl ?? { synthesize: edge?.fn ?? vi.fn() },
        piper: piper?.impl ?? { synthesize: piper?.fn ?? vi.fn() }
      }
    }),
    elevenlabs,
    edge,
    piper
  }
}

function collectBus(topic) {
  const events = []
  const off = on(topic, (payload) => events.push(payload))
  return { events, off }
}

const elCfg = { api_key: 'sk', voice_id: 'v1', model_id: 'eleven_flash_v2_5' }

describe('cleanSpeechText (legacy regex port)', () => {
  it('strips *actions*, [tags], and non-speech chars', () => {
    expect(cleanSpeechText('*waves* Hello there! [EMOTION: happy] 💖')).toBe('Hello there!')
    expect(cleanSpeechText("I-I can't believe it... right?!")).toBe("I-I can't believe it... right?!")
    expect(cleanSpeechText('[EMOTION: love]')).toBe('')
    expect(cleanSpeechText(null)).toBe('')
  })

  it('keeps accented letters (unicode-aware \\w parity)', () => {
    expect(cleanSpeechText('café naïve')).toBe('café naïve')
  })
})

describe('voice service arbitration', () => {
  it('falls back EL → edge on VoiceQuotaError; piper never called', async () => {
    const edge = stubProvider('edge')
    const piper = stubProvider('piper')
    const h = makeService({
      configPatch: { tts_config: { enabled: true, engine: 'elevenlabs' }, elevenlabs: elCfg },
      elevenlabs: stubProvider('el', () => {
        throw new VoiceQuotaError('HTTP 402 — quota hit')
      }),
      edge,
      piper
    })

    const ttsReady = collectBus('tts:ready')
    const result = await h.svc.speak({ text: '*giggles* hi!', emotion: 'happy' })

    expect(result.path).toMatch(/tts-cache[\\/]tts_\d+\.mp3$/)
    expect(result.emotion).toBe('happy')
    // Providers receive the CLEANED text.
    expect(edge.calls[0].text).toBe('hi!')
    expect(piper.calls).toHaveLength(0)
    expect(ttsReady.events).toEqual([{ path: result.path, emotion: 'happy' }])
    ttsReady.off()
  })

  it('engine pinning: edge only runs edge even with EL configured', async () => {
    const el = stubProvider('el')
    const piper = stubProvider('piper')
    const h = makeService(
      {
        configPatch: { tts_config: { engine: 'edge' }, elevenlabs: elCfg },
        elevenlabs: el,
        edge: stubProvider('edge'),
        piper
      }
    )
    await h.svc.speak({ text: 'hey', emotion: null })
    expect(el.calls).toHaveLength(0)
    expect(h.edge.calls).toHaveLength(1)
    expect(piper.calls).toHaveLength(0)
  })

  it('engine pinning: piper only runs piper and gets a .wav cache path + model cfg', async () => {
    const model = path.join(dir, 'assets', 'tts', 'voices', 'en-test-medium.onnx.json')
    fs.mkdirSync(path.dirname(model), { recursive: true })
    fs.writeFileSync(model, '{}')
    const piper = stubProvider('piper')
    const el = stubProvider('el')
    const h = makeService({
      configPatch: {
        tts_config: { engine: 'piper', piper_voice: path.join(dir, 'm.onnx') },
        elevenlabs: elCfg
      },
      elevenlabs: el,
      edge: stubProvider('edge'),
      piper
    })
    await h.svc.speak({ text: 'offline mode' })
    expect(el.calls).toHaveLength(0)
    expect(h.edge.calls).toHaveLength(0)
    expect(piper.calls).toHaveLength(1)
    expect(piper.calls[0].outPath.endsWith('.wav')).toBe(true)
  })

  it('unconfigured EL is skipped in the elevenlabs chain', async () => {
    const el = stubProvider('el')
    const h = makeService({
      configPatch: { tts_config: { engine: 'elevenlabs' }, elevenlabs: {} },
      elevenlabs: el,
      edge: stubProvider('edge')
    })
    await h.svc.speak({ text: 'no creds' })
    expect(el.calls).toHaveLength(0)
    expect(h.edge.calls).toHaveLength(1)
  })

  it('non-quota failure does not cascade; emits tts {error} and returns null', async () => {
    const edge = stubProvider('edge')
    const h = makeService({
      configPatch: { tts_config: { engine: 'elevenlabs' }, elevenlabs: elCfg },
      elevenlabs: stubProvider('el', () => {
        throw new Error('network exploded')
      }),
      edge
    })
    const ttsErr = collectBus('tts')
    const result = await h.svc.speak({ text: 'boom' })
    expect(result).toBeNull()
    expect(edge.calls).toHaveLength(0)
    expect(ttsErr.events).toHaveLength(1)
    expect(ttsErr.events[0].error).toContain('network exploded')
    ttsErr.off()
  })

  it('quota errors cascade through every engine before failing', async () => {
    const quota = () => {
      throw new VoiceQuotaError('HTTP 429')
    }
    const h = makeService({
      configPatch: { tts_config: { engine: 'elevenlabs' }, elevenlabs: elCfg },
      elevenlabs: stubProvider('el', quota),
      edge: stubProvider('edge', quota),
      piper: stubProvider('piper', quota)
    })
    const ttsErr = collectBus('tts')
    const result = await h.svc.speak({ text: 'all dead' })
    expect(result).toBeNull()
    expect(ttsErr.events[0].error).toContain('429')
    ttsErr.off()
  })

  it('skips silently when text cleans to empty', async () => {
    const edge = stubProvider('edge')
    const h = makeService({ configPatch: { tts_config: { engine: 'edge' } }, edge })
    expect(await h.svc.speak({ text: '*silent wave*' })).toBeNull()
    expect(await h.svc.speak({ text: '' })).toBeNull()
    expect(edge.calls).toHaveLength(0)
  })

  it('speak never throws even when providers explode synchronously', async () => {
    const h = makeService({
      configPatch: { tts_config: { engine: 'edge' } },
      edge: { impl: { synthesize: () => { throw new Error('sync boom') } } }
    })
    const ttsErr = collectBus('tts')
    await expect(h.svc.speak({ text: 'x' })).resolves.toBeNull()
    ttsErr.off()
  })
})

describe('cache rotation', () => {
  it('writes tts_0..tts_9 then wraps around, overwriting the oldest', async () => {
    const h = makeService({ configPatch: { tts_config: { engine: 'edge' } }, edge: stubProvider('e') })
    const paths = []
    for (let i = 0; i < 12; i++) {
      const r = await h.svc.speak({ text: `line ${i}` })
      paths.push(path.basename(r.path))
    }
    expect(paths.slice(0, 10)).toEqual(paths.slice(0, 10).map((_, i) => `tts_${i}.mp3`))
    expect(paths[10]).toBe('tts_0.mp3')
    expect(paths[11]).toBe('tts_1.mp3')
  })

  it('piper attempts use .wav siblings of the same counter', async () => {
    const h = makeService({
      configPatch: { tts_config: { engine: 'piper', piper_voice: '/x.onnx' } },
      piper: stubProvider('p')
    })
    const first = await h.svc.speak({ text: 'a' })
    expect(path.basename(first.path)).toBe('tts_0.wav')
  })
})

describe('scanPiperVoices + isConfigured', () => {
  it('lists .onnx stems from assets/tts/voices and reports EL configured state', () => {
    fs.mkdirSync(path.join(dir, 'assets', 'tts', 'voices'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'assets', 'tts', 'voices', 'b_voice.onnx'), '')
    fs.writeFileSync(path.join(dir, 'assets', 'tts', 'voices', 'a_voice.onnx'), '')
    fs.writeFileSync(path.join(dir, 'assets', 'tts', 'voices', 'a_voice.onnx.json'), '{}')
    fs.writeFileSync(path.join(dir, 'assets', 'tts', 'voices', 'notes.txt'), '')

    const config = createConfigService({ rootDir: dir })
    config.patchConfig({ elevenlabs: elCfg })
    const svc = createVoiceService({ rootDir: dir, getConfig: () => config.getConfig() })

    expect(svc.scanPiperVoices()).toEqual(['a_voice', 'b_voice'])
    expect(svc.isConfigured()).toBe(true)

    const bare = createVoiceService({ rootDir: dir, getConfig: () => config.getConfig() })
    void bare
    const noElRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-tts-noel-'))
    const noEl = createConfigService({ rootDir: noElRoot })
    const svc2 = createVoiceService({ rootDir: noElRoot, getConfig: () => noEl.getConfig() })
    expect(svc2.isConfigured()).toBe(false)
  })
})

describe('chainFor', () => {
  it('pins per engine and builds the fallback order for elevenlabs', () => {
    expect(chainFor('edge', true)).toEqual(['edge'])
    expect(chainFor('piper', true)).toEqual(['piper'])
    expect(chainFor('elevenlabs', true)).toEqual(['elevenlabs', 'edge', 'piper'])
    expect(chainFor('elevenlabs', false)).toEqual(['edge', 'piper'])
  })
})

describe('resolveMediaPath (pure traversal guard)', () => {
  const roots = [
    { mount: 'tts-cache', root: path.resolve('/app/root/data/tts-cache') },
    path.resolve('/app/root/assets')
  ]

  it('resolves files inside allowlisted roots', () => {
    expect(resolveMediaPath('/tts-cache/tts_3.mp3', roots)).toBe(
      path.resolve('/app/root/data/tts-cache/tts_3.mp3')
    )
    expect(resolveMediaPath('/sprites/x.png', [path.resolve('/app/root/assets')])).toBe(
      path.resolve('/app/root/assets/sprites/x.png')
    )
  })

  it('bare mount never maps into the mounted cache root', () => {
    const resolved = resolveMediaPath('/tts-cache/', roots)
    expect(resolved).not.toBe(path.resolve('/app/root/data/tts-cache'))
  })

  it.each([
    '/../secrets.txt',
    '/..%2F..%2Fetc%2Fpasswd',
    '/../../etc/passwd',
    '/tts-cache/../../../etc/passwd',
    '\\\\server\\share\\x',
    '',
    null
  ])('rejects traversal attempt %j', (attempt) => {
    expect(resolveMediaPath(attempt, roots)).toBeNull()
  })

  it('rejects when no roots are provided', () => {
    expect(resolveMediaPath('/tts-cache/a.mp3', [])).toBeNull()
    expect(resolveMediaPath('/tts-cache/a.mp3', undefined)).toBeNull()
  })
})
