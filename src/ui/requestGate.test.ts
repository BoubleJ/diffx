import { describe, it, expect } from 'vitest'
import { createRequestGate } from './requestGate'

describe('createRequestGate', () => {
  it('treats only the most recent request as current', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    expect(gate.isLatest(first)).toBe(false)
    expect(gate.isLatest(second)).toBe(true)
  })
})
