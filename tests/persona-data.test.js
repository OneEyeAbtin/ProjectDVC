import { describe, it, expect } from 'vitest'
import {
  PERSONAS,
  PERSONA_GROUPS,
  EMO_REMAP,
  GREETING_TEMPLATES,
  PERSONA_TRANSFORM
} from '../src/main/data/personas.js'

const VALID_EMOTIONS = new Set([
  'neutral', 'happy', 'sad', 'angry', 'blush', 'thinking', 'love', 'sleepy',
  'excited', 'confused', 'bored', 'annoyed', 'evil', 'eyeroll', 'mocking',
  'smirk', 'shocked', 'disgusted'
])

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
  it('cover every persona key', () => {
    expect(Object.keys(GREETING_TEMPLATES).length).toBe(24)
    for (const persona of Object.keys(PERSONAS)) {
      expect(typeof GREETING_TEMPLATES[persona]).toBe('string')
    }
  })
  it('are IPC-serializable strings tagged with exactly one valid emotion', () => {
    for (const [persona, template] of Object.entries(GREETING_TEMPLATES)) {
      expect(PERSONAS[persona]).toBeDefined()
      expect(typeof template).toBe('string')
      const tags = template.match(/\[EMOTION:\s*(\w+)\]/gi) ?? []
      expect(tags, `${persona} greeting must have exactly one EMOTION tag`).toHaveLength(1)
      const emotion = tags[0].match(/\[EMOTION:\s*(\w+)\]/i)[1].toLowerCase()
      expect(VALID_EMOTIONS.has(emotion), `${persona} emotion "${emotion}" valid`).toBe(true)
    }
  })
  it('keeps name placeholders only where the legacy greeting used the name', () => {
    expect(GREETING_TEMPLATES.Tsundere).toContain('{name}')
    expect(GREETING_TEMPLATES.Gremlin).toContain('{name}')
    expect(GREETING_TEMPLATES.Catgirl).toContain('{name}')
    expect(GREETING_TEMPLATES.Gothic).not.toContain('{name}')
  })
})

describe('persona transforms', () => {
  it('cover every persona key', () => {
    expect(Object.keys(PERSONA_TRANSFORM).length).toBe(24)
    for (const persona of Object.keys(PERSONAS)) {
      expect(typeof PERSONA_TRANSFORM[persona]).toBe('string')
    }
  })
  it('carry exactly one valid emotion tag each', () => {
    for (const [persona, line] of Object.entries(PERSONA_TRANSFORM)) {
      const tags = line.match(/\[EMOTION:\s*(\w+)\]/gi) ?? []
      expect(tags, `${persona} transform must have exactly one EMOTION tag`).toHaveLength(1)
      const emotion = tags[0].match(/\[EMOTION:\s*(\w+)\]/i)[1].toLowerCase()
      expect(VALID_EMOTIONS.has(emotion), `${persona} emotion "${emotion}" valid`).toBe(true)
    }
  })
})
