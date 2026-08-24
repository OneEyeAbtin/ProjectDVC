import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  nativeImage: { createFromDataURL: vi.fn() },
  Tray: class {},
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn() },
  app: { on: vi.fn(), quit: vi.fn(), whenReady: () => Promise.resolve() }
}))

import { clampToWorkarea, createWindowService } from '../src/main/services/window.service.js'
import { createConfigService } from '../src/main/services/config.service.js'

const WA = { x: 0, y: 0, width: 1920, height: 1040 }

describe('clampToWorkarea', () => {
  it('keeps an exactly-fitting window untouched', () => {
    expect(clampToWorkarea(0, 0, 1920, 1040, WA)).toEqual({ x: 0, y: 0 })
    expect(clampToWorkarea(100, 80, 400, 700, WA)).toEqual({ x: 100, y: 80 })
  })

  it('clamps window dragged left/above the screen to workArea origin', () => {
    expect(clampToWorkarea(-50, -20, 400, 700, WA)).toEqual({ x: 0, y: 0 })
  })

  it('clamps bottom-right overflow so the window stays fully visible', () => {
    expect(clampToWorkarea(1900, 1020, 400, 700, WA)).toEqual({ x: 1520, y: 340 })
  })

  it('respects non-zero workArea origin (taskbar on left/top)', () => {
    const wa = { x: 60, y: 30, width: 1800, height: 990 }
    expect(clampToWorkarea(0, 0, 400, 700, wa)).toEqual({ x: 60, y: 30 })
    expect(clampToWorkarea(5000, 5000, 400, 700, wa)).toEqual({ x: 1460, y: 320 })
  })

  it('clamps windows larger than the workArea to the origin corner', () => {
    expect(clampToWorkarea(-10, -10, 3000, 2000, WA)).toEqual({ x: 0, y: 0 })
  })
})

describe('createWindowService config binding', () => {
  it('window move after config rebind writes via the CURRENT config, not a stale one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-winbind-'))
    const staleConfig = createConfigService({ rootDir: root })
    staleConfig.patchSave({ persona: 'Gothic', session_summary: 'pre-reset recap' })

    const services = { config: staleConfig }
    let onMove
    const win = {
      on: (ev, fn) => {
        if (ev === 'move') onMove = fn
      },
      isDestroyed: () => false,
      getPosition: () => [111, 222]
    }
    const svc = createWindowService({ win, getConfig: () => services.config })
    svc.trackPosition()

    // Simulate profile:factory-reset: wipe data files THEN replace the config instance
    for (const name of ['save.json', 'config.json']) {
      fs.rmSync(path.join(root, 'data', name), { force: true })
    }
    services.config = createConfigService({ rootDir: root })

    vi.useFakeTimers()
    onMove()
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()

    const written = JSON.parse(fs.readFileSync(path.join(root, 'data', 'save.json'), 'utf8'))
    expect(written.win_x).toBe(111)
    expect(written.win_y).toBe(222)
    expect(written.persona).toBe('Tsundere')
    expect(written.session_summary).toBeUndefined()
  })
})
