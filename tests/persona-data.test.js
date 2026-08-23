import { describe, it, expect } from 'vitest'
import { PERSONAS, PERSONA_GROUPS, EMO_REMAP, GREETING_TEMPLATES } from '../src/main/data/personas.js'

describe('persona data integrity', () => {
  it('has 24 personas with descriptions', () => {
    expect(Object.keys(PERSONAS).length).toBe(24)
    for (const d of Object.values(PERSONAS)) expect(d.length).toBeGreaterThan(30)
  })
  it('grouped personas all exist', () => {
    for (const members of Object.values(PERSONA_GROUPS))
      for (const m of members) expect(PERSONAS[m]).toBeDefined()
  })
  it('remap targets valid', () => {
    const valid = new Set(['neutral','happy','sad','angry','blush','thinking','love','sleepy','excited','confused','bored','annoyed','evil','eyeroll','mocking','smirk','shocked','disgusted'])
    for (const t of Object.values(EMO_REMAP)) expect(valid.has(t)).toBe(true)
  })
})

describe('greeting templates', () => {
  it('are IPC-serializable strings tagged with an emotion', () => {
    for (const [persona, template] of Object.entries(GREETING_TEMPLATES)) {
      expect(PERSONAS[persona]).toBeDefined()
      expect(typeof template).toBe('string')
      expect(template).toMatch(/\[EMOTION:\s*\w+\]/)
    }
  })
  it('keeps name placeholders only where the legacy greeting used the name', () => {
    expect(GREETING_TEMPLATES.Tsundere).toContain('{name}')
    expect(GREETING_TEMPLATES.Gremlin).toContain('{name}')
    expect(GREETING_TEMPLATES.Catgirl).toContain('{name}')
    expect(GREETING_TEMPLATES.Gothic).not.toContain('{name}')
  })
})
