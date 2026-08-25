import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INTERACT_MENU, INTERACTIONS, THEME_META } from '../src/renderer/src/features/menu/menuData.js'
import { DEFAULTS } from '../src/main/data/defaults.js'
import { THEME_LIST } from '../src/main/data/themes.js'

describe('renderer menu data mirrors legacy', () => {
  it('has 14 interact items matching the legacy ids', () => {
    expect(INTERACT_MENU.map((i) => i.id)).toEqual([
      'pat', 'hug', 'poke', 'kiss', 'tickle', 'gift', 'boop', 'headpat',
      'hold_hands', 'feed', 'whisper', 'stare', 'compliment', 'dance'
    ])
  })
  it('interaction strings match main defaults (ported from legacy config.py)', () => {
    expect(INTERACTIONS).toEqual(DEFAULTS.interactions)
    expect(INTERACTIONS.feed).toBe('*I hold up a small cake to your lips.* Say ahh~')
    expect(INTERACTIONS.compliment).toBe('*I look at you admiringly.* You look really nice today.')
  })
  it('every interact item has an interaction string', () => {
    for (const item of INTERACT_MENU) expect(typeof INTERACTIONS[item.id]).toBe('string')
  })
  it('has 12 themes matching THEME_LIST ids with display names', () => {
    expect(THEME_META.length).toBe(12)
    expect(new Set(THEME_META.map((t) => t.id))).toEqual(new Set(THEME_LIST))
    for (const t of THEME_META) {
      expect(t.name.length).toBeGreaterThan(2)
      expect(t.dot).toHaveLength(2)
    }
  })
})

describe('context menu has no Themes submenu', () => {
  // Theme selection lives in Settings → General only; the right-click menu
  // keeps outfits/personas/interact/stats/settings. Guarded at source level:
  // there is no component-mount test harness in this repo, and any return of
  // the submenu would reintroduce these exact symbols.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(
    path.join(here, '../src/renderer/src/features/menu/ContextMenu.jsx'),
    'utf8'
  )

  it('renders no theme picker entries', () => {
    expect(src).not.toMatch(/🎨|THEME_META|pickTheme|ctx-theme-grid|swatch-cell/)
  })

  it('keeps the outfits/personas/interact/stats/settings entries', () => {
    expect(src).toContain('👗 Outfits')
    expect(src).toContain('🎭 Personas')
    expect(src).toContain('✨ Interact')
    expect(src).toContain('⚙ Settings')
    expect(src).toContain('UTILITY_ENTRIES')
  })
})
