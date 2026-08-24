import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  nativeImage: { createFromDataURL: vi.fn() },
  Tray: class {},
  Menu: { buildFromTemplate: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn() },
  app: { on: vi.fn(), quit: vi.fn(), whenReady: () => Promise.resolve() }
}))

import { clampToWorkarea } from '../src/main/services/window.service.js'

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
