import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCharactersService } from '../src/main/services/characters.service.js'
import { DEFAULTS } from '../src/main/data/defaults.js'

let dir
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-outfits-'))
  for (const name of ['Charlothappy.png', 'Charlotneutral.png', 'neutral.png', 'fullbody.png']) {
    fs.writeFileSync(path.join(dir, name), 'x')
  }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('characters service', () => {
  it('scans stems lowercased with absolute paths', () => {
    const svc = createCharactersService({ outfitsDir: dir, emotions: DEFAULTS.emotions })
    const files = svc.scan()
    expect(files.charlothappy).toBe(path.join(dir, 'Charlothappy.png'))
    expect(files.charlotneutral).toBe(path.join(dir, 'Charlotneutral.png'))
    expect(files.neutral).toBe(path.join(dir, 'neutral.png'))
    expect(files.fullbody).toBe(path.join(dir, 'fullbody.png'))
  })

  it('infers prefix charlot from emotion-suffixed stems', () => {
    const svc = createCharactersService({ outfitsDir: dir, emotions: DEFAULTS.emotions })
    const manifest = svc.manifest()
    const charlot = manifest.find((o) => o.prefix === 'charlot')
    expect(charlot).toBeDefined()
    expect(charlot.name).toBe('Charlot')
  })

  it('resolves sprite with prefix+emotion, prefix+neutral, bare emotion, neutral chain', () => {
    const svc = createCharactersService({ outfitsDir: dir, emotions: DEFAULTS.emotions })
    expect(svc.resolveSprite('charlot', 'happy')).toBe(path.join(dir, 'Charlothappy.png'))
    expect(svc.resolveSprite('CHARLOT', 'HAPPY')).toBe(path.join(dir, 'Charlothappy.png'))
    expect(svc.resolveSprite('charlot', 'angry')).toBe(path.join(dir, 'Charlotneutral.png'))
    expect(svc.resolveSprite('', 'neutral')).toBe(path.join(dir, 'neutral.png'))
    expect(svc.resolveSprite('missing', 'sad')).toBe(path.join(dir, 'neutral.png'))
    expect(svc.resolveSprite('missing', 'zzz')).toBe(path.join(dir, 'neutral.png'))
  })

  it('returns null when nothing including neutral exists', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-empty-'))
    try {
      const svc = createCharactersService({ outfitsDir: empty, emotions: DEFAULTS.emotions })
      svc.scan()
      expect(svc.resolveSprite('charlot', 'happy')).toBeNull()
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('manifest groups by prefix with display names and counts', () => {
    const svc = createCharactersService({ outfitsDir: dir, emotions: DEFAULTS.emotions })
    const manifest = svc.manifest()
    const charlot = manifest.find((o) => o.prefix === 'charlot')
    const base = manifest.find((o) => o.prefix === '')
    expect(charlot.count).toBe(2)
    expect(base.name).toBe('Base')
    expect(base.hasFullbody).toBe(true)
    expect(charlot.hasFullbody).toBe(false)
  })

  it('returns empty scan without throwing for missing dir', () => {
    const svc = createCharactersService({
      outfitsDir: path.join(dir, 'nope'),
      emotions: DEFAULTS.emotions
    })
    expect(svc.scan()).toEqual({})
  })

  it('keeps previously registered prefixes across rescans without duplicates', () => {
    const svc = createCharactersService({ outfitsDir: dir, emotions: DEFAULTS.emotions })
    svc.scan()
    fs.rmSync(path.join(dir, 'Charlothappy.png'))
    fs.rmSync(path.join(dir, 'Charlotneutral.png'))
    const secondScan = svc.scan()
    expect(secondScan.charlothappy).toBeUndefined()
    const manifest = svc.manifest()
    const charlots = manifest.filter((o) => o.prefix === 'charlot')
    expect(charlots).toHaveLength(1)
    expect(charlots[0].name).toBe('Charlot')
  })
})
