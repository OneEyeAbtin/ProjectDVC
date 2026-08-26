import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  REDUCE_TRANSPARENCY_CLASS,
  applyTransparencyPreference
} from '../src/renderer/src/features/settings/transparency.js'
import { DEFAULTS, SETTINGS_KEYS } from '../src/main/data/defaults.js'
import { AUTO_SAVE_KEYS } from '../src/renderer/src/features/settings/liveSettings.js'
import { buildSnapshot, diffPatch } from '../src/renderer/src/features/settings/settingsDraft.js'
import { createConfigService } from '../src/main/services/config.service.js'

// Reduce-transparency toggle (fixwave M): config key + auto-save + the
// documentElement class bridge that drives the CSS overrides in global.css.

describe('reduce_transparency persistence', () => {
  it('ships in DEFAULTS (false) + SETTINGS_KEYS', () => {
    expect(DEFAULTS.reduce_transparency).toBe(false)
    expect(SETTINGS_KEYS).toContain('reduce_transparency')
  })

  it('round-trips through the config service and lands on disk', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-reduce-transparency-'))
    const config = createConfigService({ rootDir: root })
    expect(config.getConfig().reduce_transparency).toBe(false)
    config.patchConfig({ reduce_transparency: true })
    expect(config.getConfig().reduce_transparency).toBe(true)
    const written = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'))
    expect(written.reduce_transparency).toBe(true)
  })
})

describe('reduce_transparency auto-save integration', () => {
  it('auto-saves and never rides the Save-button draft', () => {
    expect(AUTO_SAVE_KEYS).toContain('reduce_transparency')
    const snap = buildSnapshot({ config: { reduce_transparency: true } })
    expect('reduce_transparency' in snap).toBe(false)
    const staleDraft = { ...snap, reduce_transparency: true }
    expect(diffPatch(staleDraft, snap)).toEqual({})
  })

  it('applies optimistically through the live-setting machinery', async () => {
    vi.useFakeTimers()
    globalThis.window = globalThis.window || {}
    const handlers = {}
    const invokes = []
    window.dvc = {
      invoke(channel, payload) {
        return new Promise((resolve) => {
          invokes.push({ channel, payload, resolve })
        })
      },
      on(channel, fn) {
        handlers[channel] = fn
        return () => delete handlers[channel]
      }
    }
    try {
      const { useStore } = await import('../src/renderer/src/state/store.js')
      useStore.setState({
        booted: true,
        theme: 'midnight-sakura',
        heartsVisible: true,
        fontScale: 1,
        config: {},
        error: null,
        liveSavedSeq: {},
        _unsubs: [],
        _errorTimer: null,
        _transientTimer: null,
        _mcConnectTimer: null
      })
      useStore.setState({ _liveTimers: {}, _livePayloads: {}, _liveOrigins: {} })

      useStore.getState().saveLiveSetting('reduce_transparency', true)
      // Optimistic apply before the debounce fires.
      expect(useStore.getState().config.reduce_transparency).toBe(true)

      await vi.advanceTimersByTimeAsync(500)
      const saves = invokes.filter((i) => i.channel === 'profile:save')
      expect(saves).toHaveLength(1)
      expect(saves[0].payload).toEqual({ reduce_transparency: true })
    } finally {
      window.dvc = undefined
      vi.useRealTimers()
    }
  })
})

describe('documentElement class wiring', () => {
  it('toggles the class on and off without touching siblings', () => {
    const classes = new Set(['theme-x'])
    const classList = {
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name)
          else classes.add(name)
          return classes.has(name)
        }
        if (force) classes.add(name)
        else classes.delete(name)
        return classes.has(name)
      }
    }
    const root = { classList }

    expect(REDUCE_TRANSPARENCY_CLASS).toBe('reduce-transparency')

    applyTransparencyPreference(root, true)
    expect(classes.has('reduce-transparency')).toBe(true)
    expect(classes.has('theme-x')).toBe(true) // unrelated classes survive

    applyTransparencyPreference(root, false)
    expect(classes.has('reduce-transparency')).toBe(false)
    expect(classes.has('theme-x')).toBe(true)
  })

  it('is safe with a missing or malformed root', () => {
    expect(applyTransparencyPreference(null, true)).toBe(false)
    expect(applyTransparencyPreference({}, true)).toBe(false)
  })
})
