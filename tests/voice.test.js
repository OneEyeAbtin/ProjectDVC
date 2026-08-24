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
