import { describe, it, expect } from 'vitest'
import { PROVIDERS, getProvider } from './index'

describe('PROVIDERS', () => {
  it('lists only Claude Code', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['claude'])
    expect(getProvider('claude')?.label).toBe('Claude Code')
    expect(getProvider('codex')).toBeUndefined()
    expect(getProvider('nope')).toBeUndefined()
  })
})
