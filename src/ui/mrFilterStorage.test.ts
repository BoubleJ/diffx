import { describe, it, expect } from 'vitest'
import { loadMrFilter, saveMrFilter, DEFAULT_MR_FILTER } from './mrFilterStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('mrFilterStorage', () => {
  it('defaults to opened MRs without the mine filter', () => {
    expect(DEFAULT_MR_FILTER).toEqual({ state: 'opened', mine: false })
    expect(loadMrFilter('/repo', memoryStorage())).toEqual(DEFAULT_MR_FILTER)
  })

  it('stores the filter per repo', () => {
    const s = memoryStorage()
    saveMrFilter('/repo/a', { state: 'merged', mine: true }, s)
    expect(loadMrFilter('/repo/a', s)).toEqual({ state: 'merged', mine: true })
    expect(loadMrFilter('/repo/b', s)).toEqual(DEFAULT_MR_FILTER)
  })

  it('ignores broken values', () => {
    const s = memoryStorage()
    s.setItem('diffx-mr-filter:/repo', JSON.stringify({ state: 'closed', mine: true }))
    expect(loadMrFilter('/repo', s)).toEqual(DEFAULT_MR_FILTER)
  })
})
