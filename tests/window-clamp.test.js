import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  nativeImage: { createFromDataURL: vi.fn() },
  Tray: class {},
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn(), getDisplayMatching: vi.fn() },
  app: { on: vi.fn(), quit: vi.fn(), whenReady: () => Promise.resolve() }
}))

import { clampToWorkarea, createWindowService } from '../src/main/services/window.service.js'
import { createConfigService } from '../src/main/services/config.service.js'
import { screen } from 'electron'

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

describe('restorePosition multi-monitor handling', () => {
  function makeWin({ listeners = {}, bounds = { width: 400, height: 700 } } = {}) {
    const calls = { setPosition: [] }
    const win = {
      on: (ev, fn) => {
        listeners[ev] = fn
      },
      isDestroyed: () => false,
      getPosition: () => [0, 0],
      getBounds: () => ({ ...bounds }),
      setPosition: (x, y) => calls.setPosition.push([x, y])
    }
    return { win, calls }
  }

  it('accepts negative coords and clamps against the matched display workArea', () => {
    const config = createConfigService({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mm-')) })
    config.patchSave({ win_x: -1920, win_y: 100 })
    const leftMonitorWa = { x: -1920, y: 0, width: 1920, height: 1040 }
    const { win, calls } = makeWin()
    const svc = createWindowService({
      win,
      getConfig: () => config,
      getWorkAreaForPoint: () => leftMonitorWa
    })
    svc.restorePosition()
    expect(calls.setPosition).toHaveLength(1)
    expect(calls.setPosition[0]).toEqual([-1920, 100])
  })

  it('uses getDisplayMatching for the point, not the primary display', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mm2-'))
    const config = createConfigService({ rootDir: root })
    config.patchSave({ win_x: 2500, win_y: 50 })
    const rightMonitorWa = { x: 1920, y: 0, width: 1920, height: 1040 }
    screen.getDisplayMatching.mockReturnValue({ workArea: rightMonitorWa })
    const { win, calls } = makeWin({})
    const svc = createWindowService({ win, getConfig: () => config })
    svc.restorePosition()
    expect(screen.getDisplayMatching).toHaveBeenCalledWith(
      expect.objectContaining({ x: 2500, y: 50 })
    )
    // x=2500 fits inside the right monitor's workArea untouched:
    expect(calls.setPosition[0]).toEqual([2500, 50])
  })

  it('falls back to primary workArea when display matching throws', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mm3-'))
    const config = createConfigService({ rootDir: root })
    config.patchSave({ win_x: 5000, win_y: 5000 })
    screen.getDisplayMatching.mockImplementation(() => {
      throw new Error('no displays')
    })
    screen.getPrimaryDisplay.mockReturnValue({ workArea: WA })
    const { win, calls } = makeWin({})
    const svc = createWindowService({ win, getConfig: () => config })
    svc.restorePosition()
    // clamped into primary 1920x1040 area
    expect(calls.setPosition[0]).toEqual([1520, 340])
  })

  it('rejects non-integer saved positions; sentinel -1 clamps to workArea origin', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mm4-'))
    const config = createConfigService({ rootDir: root })
    screen.getPrimaryDisplay.mockReturnValue({ workArea: WA })
    const { win, calls } = makeWin({})
    const svc = createWindowService({
      win,
      getConfig: () => config,
      getWorkAreaForPoint: () => WA
    })
    // Fresh save carries the -1/-1 "never moved" sentinel: integers now pass
    // validation and clamp to the workArea origin (was silently skipped before).
    svc.restorePosition()
    expect(calls.setPosition).toEqual([[0, 0]])

    config.patchSave({ win_x: Number.NaN, win_y: 10 })
    svc.restorePosition()
    expect(calls.setPosition).toHaveLength(1)
  })
})
