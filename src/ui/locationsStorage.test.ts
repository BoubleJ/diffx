import { describe, it, expect } from 'vitest'
import { loadWithLocations, saveWithLocations } from './locationsStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('locationsStorage', () => {
  it('leaves locations out by default', () => {
    expect(loadWithLocations(memoryStorage())).toBe(false)
  })

  it('remembers the last choice', () => {
    const s = memoryStorage()
    saveWithLocations(false, s)
    expect(loadWithLocations(s)).toBe(false)
    saveWithLocations(true, s)
    expect(loadWithLocations(s)).toBe(true)
  })
})
