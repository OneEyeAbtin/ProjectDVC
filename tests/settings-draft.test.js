import { describe, it, expect } from 'vitest'
import {
  buildSnapshot,
  diffPatch,
  TEST_EMOTIONS
} from '../src/renderer/src/features/settings/settingsDraft.js'
import { AUTO_SAVE_KEYS } from '../src/renderer/src/features/settings/liveSettings.js'

describe('settings draft snapshot', () => {
  it('applies voice defaults when the config is empty', () => {
    const snap = buildSnapshot({ config: {} })
    expect(snap.tts_config).toEqual({
      enabled: false,
      engine: 'edge',
      edge_voice: 'en-US-AriaNeural',
      piper_voice: '',
      stt_engine: 'groq',
      stt_model: 'whisper-large-v3-turbo'
    })
    expect(snap.elevenlabs).toEqual({ api_key: '', voice_id: '', model_id: 'eleven_flash_v2_5' })
    // Legacy defaults: TTS lip-sync on, text lip-sync off.
    expect(snap.lip_sync_tts).toBe(true)
    expect(snap.lip_sync_text).toBe(false)
  })

  it('carries nested voice objects through from the live config', () => {
    const state = {
      config: {
        tts_config: { enabled: true, engine: 'piper', piper_voice: 'en_AMy', edge_voice: 'x', stt_engine: 'groq', stt_model: 'm' },
        elevenlabs: { api_key: 'k', voice_id: 'v', model_id: 'm2' }
      },
      lipSyncTts: false,
      lipSyncText: true
    }
    const snap = buildSnapshot(state)
    expect(snap.tts_config.enabled).toBe(true)
    expect(snap.tts_config.engine).toBe('piper')
    expect(snap.elevenlabs.api_key).toBe('k')
    expect(snap.lip_sync_tts).toBe(false)
    expect(snap.lip_sync_text).toBe(true)
  })

  it('snapshot objects are copies — editing the draft cannot leak into state', () => {
    const cfg = { tts_config: { enabled: true, engine: 'edge' } }
    const snap = buildSnapshot({ config: cfg })
    snap.tts_config.enabled = false
    expect(cfg.tts_config.enabled).toBe(true)
  })

  describe('auto-save key exclusion (live settings)', () => {
    it('keeps every auto-save key out of the snapshot — those controls read the store', () => {
      const snap = buildSnapshot({
        config: {
          always_on_top: false,
          tray_enabled: false,
          ui_sounds: false,
          idle_chat: false,
          ambient_effects: false,
          custom_gradient: { enabled: true, from: '#112233', to: '#445566', angle: 90 },
          particle_theme: 'sakura'
        },
        theme: 'sakura-dawn',
        heartsVisible: false,
        fontScale: 1.2
      })
      for (const key of AUTO_SAVE_KEYS) {
        expect(key in snap).toBe(false)
      }
    })

    it('diffPatch never sends an auto-save key, even from a stale draft that carries one', () => {
      const base = buildSnapshot({ config: {} })
      // Simulate a pre-migration draft that still holds live keys.
      const staleDraft = {
        ...base,
        theme_id: 'ember-night',
        particle_theme: 'snow',
        custom_gradient: { enabled: true, from: '#000000', to: '#111111', angle: 0 },
        ui_sounds: false,
        always_on_top: false,
        tray_enabled: false,
        idle_chat: false,
        ambient_effects: false,
        font_scale: 1.3,
        hearts_visible: false
      }
      expect(diffPatch(staleDraft, base)).toEqual({})
    })
  })
})

describe('draft diff (whole-object replace strategy)', () => {
  const base = buildSnapshot({ config: {} })

  it('omits untouched fields and includes changed scalars', () => {
    const patch = diffPatch({ ...base, user_name: 'Abtin' }, base)
    expect(patch).toEqual({ user_name: 'Abtin' })
  })

  it('sends a nested object in full when any subfield changes', () => {
    const draft = { ...base, tts_config: { ...base.tts_config, enabled: true } }
    const patch = diffPatch(draft, base)
    expect(patch.tts_config).toEqual({ ...base.tts_config, enabled: true })
  })

  it('omits nested objects whose reference (and content) is unchanged', () => {
    const patch = diffPatch({ ...base }, base)
    expect('tts_config' in patch).toBe(false)
    expect('elevenlabs' in patch).toBe(false)
    expect(Object.keys(patch).length).toBe(0)
  })

  it('a reference-equal but separately-created identical object is omitted only via identity rules the draft never creates', () => {
    // The draft mutates nested objects immutably (new ref per edit), so an
    // equal-content copy would be re-sent — harmless whole-object replace.
    const copy = { ...base.tts_config }
    const patch = diffPatch({ ...base, tts_config: copy }, base)
    expect(patch.tts_config).toEqual(base.tts_config)
  })
})

describe('test-voice emotion list', () => {
  it('offers the 18 persistent emotions without render-only states', () => {
    expect(TEST_EMOTIONS.length).toBe(18)
    expect(TEST_EMOTIONS).not.toContain('talking')
    expect(TEST_EMOTIONS).not.toContain('fullbody')
  })
})
