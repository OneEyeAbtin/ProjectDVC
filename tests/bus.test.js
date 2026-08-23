import { it, expect } from 'vitest'
import { emit, on } from '../src/main/bus.js'
it('delivers and unsubscribes', () => {
  let n = 0
  const off = on('t:x', v => (n += v))
  emit('t:x', 2); off(); emit('t:x', 5)
  expect(n).toBe(2)
})
