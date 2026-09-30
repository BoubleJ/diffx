import { describe, it, expect } from 'vitest'
import { loadReviewInstruction, saveReviewInstruction } from './reviewInstructionStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('reviewInstructionStorage', () => {
  it('stores the instruction per repo', () => {
    const s = memoryStorage()
    saveReviewInstruction('/repo/a', '성능 위주', s)
    expect(loadReviewInstruction('/repo/a', s)).toBe('성능 위주')
    expect(loadReviewInstruction('/repo/b', s)).toBe('')
  })

  it('does not throw when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(loadReviewInstruction('/repo', broken)).toBe('')
    expect(() => saveReviewInstruction('/repo', 'x', broken)).not.toThrow()
  })
})
