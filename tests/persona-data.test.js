import { describe, it, expect } from 'vitest'
import {
  PERSONAS,
  PERSONA_GROUPS,
  EMO_REMAP,
  GREETING_TEMPLATES,
  PERSONA_TRANSFORM,
  IDLE_LINES
} from '../src/main/data/personas.js'

const VALID_EMOTIONS = new Set([
  'neutral', 'happy', 'sad', 'angry', 'blush', 'thinking', 'love', 'sleepy',
  'excited', 'confused', 'bored', 'annoyed', 'evil', 'eyeroll', 'mocking',
  'smirk', 'shocked', 'disgusted'
])

const DERES = ['Tsundere', 'Yandere', 'Kuudere', 'Dandere']

describe('persona data integrity', () => {
  it('has 21 personas with descriptions', () => {
    expect(Object.keys(PERSONAS).length).toBe(21)
    for (const d of Object.values(PERSONAS)) expect(d.length).toBeGreaterThan(30)
  })
  it('dere personas are fully retired from every map and group', () => {
    for (const dere of DERES) {
      expect(PERSONAS[dere]).toBeUndefined()
      expect(GREETING_TEMPLATES[dere]).toBeUndefined()
      expect(PERSONA_TRANSFORM[dere]).toBeUndefined()
      for (const members of Object.values(PERSONA_GROUPS)) {
        expect(members, `${dere} must not appear in a persona group`).not.toContain(dere)
      }
    }
  })
  it('ships the Friend persona in the Relationship group', () => {
    expect(PERSONAS.Friend).toBeDefined()
    expect(PERSONA_GROUPS['💝 Relationship']).toContain('Friend')
    expect(Object.keys(PERSONA_GROUPS)).not.toContain('💕 Dere Types')
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

describe('idle lines', () => {
  it('are {text, emotion} pairs with a valid non-transient emotion each (bug A)', () => {
    // Regression guard: every idle line must name its own emotion so the idle
    // push can never fall back to the sprite's stale face.
    expect(IDLE_LINES.length).toBeGreaterThan(0)
    for (const line of IDLE_LINES) {
      expect(typeof line.text).toBe('string')
      expect(line.text.length).toBeGreaterThan(0)
      expect(VALID_EMOTIONS.has(line.emotion), `idle emotion "${line.emotion}" valid`).toBe(true)
      // Tag-free by design: the idle path carries no tag parser.
      expect(line.text).not.toMatch(/\[EMOTION:/i)
    }
  })
  it('maps the reported bored line to the bored emotion', () => {
    const bored = IDLE_LINES.find((l) => l.text.includes('Bored. Bored.'))
    expect(bored).toBeDefined()
    expect(bored.emotion).toBe('bored')
  })
})

describe('greeting templates', () => {
  it('cover every persona key', () => {
    expect(Object.keys(GREETING_TEMPLATES).length).toBe(21)
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
    expect(GREETING_TEMPLATES.Friend).toContain('{name}')
    expect(GREETING_TEMPLATES.Gremlin).toContain('{name}')
    expect(GREETING_TEMPLATES.Catgirl).toContain('{name}')
    expect(GREETING_TEMPLATES.Gothic).not.toContain('{name}')
  })
})

describe('persona transforms', () => {
  it('cover every persona key', () => {
    expect(Object.keys(PERSONA_TRANSFORM).length).toBe(21)
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
