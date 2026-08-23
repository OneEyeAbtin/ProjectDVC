import { describe, it, expect } from 'vitest'
import { PERSONAS, PERSONA_GROUPS, EMO_REMAP } from '../src/main/data/personas.js'

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
