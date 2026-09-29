import { describe, it, expect } from 'vitest'
import { startOnPreferredPort } from './port'

const inUse = () => Object.assign(new Error('in use'), { code: 'EADDRINUSE' })

describe('startOnPreferredPort', () => {
  it('uses the preferred port when free', async () => {
    const tried: number[] = []
    const result = await startOnPreferredPort(async (p) => { tried.push(p); return p }, 4100)
    expect(result).toBe(4100)
    expect(tried).toEqual([4100])
  })

  it('falls back to a random port when the preferred port is in use', async () => {
    const tried: number[] = []
    const result = await startOnPreferredPort(async (p) => {
      tried.push(p)
      if (p === 4100) throw inUse()
      return 5555
    }, 4100)
    expect(result).toBe(5555)
    expect(tried).toEqual([4100, 0])
  })

  it('starts on a random port without a preference and rethrows other errors', async () => {
    expect(await startOnPreferredPort(async (p) => p, null)).toBe(0)
    await expect(startOnPreferredPort(async () => { throw new Error('boom') }, 4100)).rejects.toThrow('boom')
  })
})
