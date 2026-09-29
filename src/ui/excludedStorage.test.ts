import { describe, it, expect } from 'vitest'
import { loadExcluded, saveExcluded } from './excludedStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

describe('load/saveExcluded', () => {
  it('returns an empty array when nothing is saved', () => {
    expect(loadExcluded('/repo/a', 'k', memoryStorage())).toEqual([])
  })

  it('stores sorted and deduplicated paths', () => {
    const s = memoryStorage()
    saveExcluded('/repo/a', 'k', ['b.ts', 'a.ts', 'b.ts'], s)
    expect(loadExcluded('/repo/a', 'k', s)).toEqual(['a.ts', 'b.ts'])
    expect(s.data.get('diffx-excluded:/repo/a\0k')).toBe('["a.ts","b.ts"]')
  })

  it('separates by repo root and comparison key', () => {
    const s = memoryStorage()
    saveExcluded('/repo/a', 'k1', ['a.ts'], s)
    expect(loadExcluded('/repo/a', 'k2', s)).toEqual([])
    expect(loadExcluded('/repo/b', 'k1', s)).toEqual([])
  })

  it('returns an empty array for broken values', () => {
    const s = memoryStorage()
    s.setItem('diffx-excluded:/repo/a\0k', '{bad json')
    expect(loadExcluded('/repo/a', 'k', s)).toEqual([])
    s.setItem('diffx-excluded:/repo/a\0k', '{"a":1}')
    expect(loadExcluded('/repo/a', 'k', s)).toEqual([])
    s.setItem('diffx-excluded:/repo/a\0k', '["a.ts",1,null]')
    expect(loadExcluded('/repo/a', 'k', s)).toEqual(['a.ts'])
  })

  it('ignores storage exceptions', () => {
    const throwing = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadExcluded('/repo/a', 'k', throwing)).toEqual([])
    expect(() => saveExcluded('/repo/a', 'k', ['a.ts'], throwing)).not.toThrow()
  })
})
