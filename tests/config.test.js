import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createConfigService } from '../src/main/services/config.service.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('config service', () => {
  it('creates defaults on fresh root', () => {
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    expect(svc.getConfig().max_history).toBe(20)
    expect(svc.getSave().stats.affection).toBe(20)
    expect(fs.existsSync(path.join(dir, 'data/config.json'))).toBe(true)
  })

  it('migrates legacy profile/traits/facts and is idempotent', () => {
    fs.writeFileSync(path.join(dir, 'dvc_profile.json'), JSON.stringify({
      user_name: 'Abtin', pet_name: 'Raven', persona: 'Vampire',
      stats: { affection: 55 }, theme: 'Matrix',
      tts: { enabled: true, engine: 'online', online_voice: 'x' },
      max_history: 12
    }))
    fs.writeFileSync(path.join(dir, 'traits.txt'), 'user likes coffee\nuser studies engineering\n')
    fs.mkdirSync(path.join(dir, 'data'))
    fs.writeFileSync(path.join(dir, 'data/permanent_facts.json'), JSON.stringify(['user fears heights']))

    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    svc.migrateLegacyIfNeeded() // idempotent

    expect(svc.getSave().persona).toBe('Vampire')
    expect(svc.getConfig().max_history).toBe(12)
    expect(svc.getSave().stats.affection).toBe(55)
    expect(JSON.parse(fs.readFileSync(path.join(dir,'data/memory/session-traits.json')))).toHaveLength(2)
    expect(JSON.parse(fs.readFileSync(path.join(dir,'data/memory/permanent-facts.json')))[0]).toBe('user fears heights')
    // theme name→id mapping applied
    expect(svc.getSave().theme_id).toBe('matrix')
    // legacy untouched
    expect(fs.existsSync(path.join(dir, 'dvc_profile.json'))).toBe(true)
  })

  it('unknown legacy theme falls back to default id', () => {
    fs.writeFileSync(path.join(dir, 'dvc_profile.json'), JSON.stringify({
      user_name: 'Abtin', theme: 'Nonexistent Theme'
    }))
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    expect(svc.getSave().theme_id).toBe('midnight-sakura')
  })

  it('writes .migrated marker inside data/memory with timestamp', () => {
    fs.writeFileSync(path.join(dir, 'dvc_profile.json'), JSON.stringify({ user_name: 'X' }))
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    const markerPath = path.join(dir, 'data/memory/.migrated')
    expect(fs.existsSync(markerPath)).toBe(true)
    const raw = fs.readFileSync(markerPath, 'utf8')
    expect(new Date(raw.trim()).toString()).not.toBe('Invalid Date')
  })

  it('drops unknown legacy keys but keeps legacy file intact', () => {
    fs.writeFileSync(path.join(dir, 'dvc_profile.json'), JSON.stringify({
      user_name: 'Abtin', minecraft: true, theme: 'Matrix'
    }))
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    expect(svc.getConfig().minecraft).toBeUndefined()
    expect(svc.getConfig().theme).toBeUndefined()
    expect(fs.existsSync(path.join(dir, 'dvc_profile.json'))).toBe(true)
  })

  it('patchSave merges deep (stats)', () => {
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    svc.patchSave({ stats: { affection: 99 } })
    expect(Object.keys(svc.getSave().stats)).toHaveLength(10)
    expect(svc.getSave().stats.affection).toBe(99)
    expect(svc.getSave().stats.humor).toBeDefined()
  })

  it('patchConfig persists to disk atomically', () => {
    const svc = createConfigService({ rootDir: dir })
    svc.migrateLegacyIfNeeded()
    svc.patchConfig({ max_history: 42, tts: { enabled: true } })
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'data/config.json'), 'utf8'))
    expect(onDisk.max_history).toBe(42)
    expect(onDisk.tts.enabled).toBe(true)
    expect(onDisk.tts.engine).toBe('online')
    expect(fs.existsSync(path.join(dir, 'data/config.json.tmp'))).toBe(false)
  })

  it('corrupt json files fall back to defaults without throwing', () => {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data/config.json'), '{not json')
    const svc = createConfigService({ rootDir: dir })
    expect(svc.getConfig().max_history).toBe(20)
  })
})
