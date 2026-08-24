import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { createMemoryService } from '../src/main/services/memory.service.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvc-mem-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const svc = () => createMemoryService({ rootDir: dir })

describe('memory', () => {
  it('replaces near-duplicates with the longer string', () => {
    const s = svc()
    s.setSessionTraits(['user likes coffee', 'user enjoys coffee', 'user hates rain'])
    expect(s.getSessionTraits()).toEqual(['user enjoys coffee', 'user hates rain'])
  })

  // Pins the INTENTIONAL divergence from legacy difflib dedup (audit #5):
  // digit-differing facts stay distinct even though difflib scored them ~0.93.
  it('keeps digit-differing trait variants side by side', () => {
    const s = svc()
    s.addTrait("user's age: 25")
    s.addTrait("user's age: 30")
    s.addTrait("user's age: 40")
    expect(s.getPermanent()).toEqual(["user's age: 25", "user's age: 30", "user's age: 40"])
  })
  it('classifies identity facts permanent vs session', () => {
    const s = svc()
    expect(s.classifyTrait("user's name is Abtin")).toBe('permanent')
    expect(s.classifyTrait('user had a sandwich today')).toBe('session')
  })
  it('caps session traits at 30 keeping recent', () => {
    const s = svc()
    s.setSessionTraits(Array.from({length: 35}, (_, i) => `fact number ${i} unique`))
    s.rotateAndSave()
    expect(s.getSessionTraits()).toHaveLength(30)
    expect(s.getSessionTraits()[0]).toContain('fact number 5')
  })
  it('builds prompt with profile/learned/summary sections', () => {
    const s = svc()
    s.addTrait('user likes tea')
    const save = { setup_answers: { hobby: 'gaming' }, session_summary: 'talked about pizza' }
    const p = s.buildMemoryPrompt(save)
    expect(p).toContain('hobby: gaming')
    expect(p).toContain('user likes tea')
    expect(p).toContain('talked about pizza')
  })

  it('skips traits whose tail matches a setup answer value', () => {
    const s = svc()
    s.setSessionTraits(['hobby: gaming', 'user likes tea'])
    const p = s.buildMemoryPrompt({ setup_answers: { hobby: 'gaming' } })
    expect(p.match(/hobby: gaming/g)).toHaveLength(1)
    expect(p).not.toMatch(/- hobby: gaming/)
    expect(p).toContain('user likes tea')
  })

  it('caches history capped at last 20 and pops it once', () => {
    const s = svc()
    expect(s.popPendingSummary()).toBeNull()
    const hist = Array.from({ length: 25 }, (_, i) => ({ role: 'user', content: `msg ${i}` }))
    s.cacheHistory(hist)
    const first = s.popPendingSummary()
    expect(first).toHaveLength(20)
    expect(first[0].content).toBe('msg 5')
    expect(s.popPendingSummary()).toBeNull()
    expect(fs.existsSync(path.join(dir, 'data/memory/session-cache.json'))).toBe(false)
  })

  it('restores pending summary after failed compression', () => {
    const s = svc()
    const raw = [{ role: 'assistant', content: 'hi' }]
    s.restorePendingSummary(raw)
    expect(s.popPendingSummary()).toEqual(raw)
    expect(s.restorePendingSummary(null)).toBe(false)
  })

  it('flags compression need at 25 session traits', () => {
    const s = svc()
    s.setSessionTraits(Array.from({ length: 24 }, (_, i) => `distinct trait alpha ${i} beta`))
    expect(s.needsCompression()).toBe(false)
    s.setSessionTraits(Array.from({ length: 25 }, (_, i) => `distinct trait alpha ${i} beta`))
    expect(s.needsCompression()).toBe(true)
  })

  it('persists traits across service instances', () => {
    const a = svc()
    a.setSessionTraits(['user likes coffee'])
    a.addTrait("user's name is Abtin")
    const b = svc()
    expect(b.getSessionTraits()).toEqual(['user likes coffee'])
    expect(b.getPermanent()).toEqual(["user's name is Abtin"])
  })
})
