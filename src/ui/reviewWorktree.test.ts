import { describe, it, expect } from 'vitest'
import { checkoutState } from './reviewWorktree'

describe('checkoutState', () => {
  const head = 'a'.repeat(40)

  it('waits while the status is loading', () => {
    expect(checkoutState(undefined, head)).toBe('loading')
  })

  it('offers a checkout when there is no worktree', () => {
    expect(checkoutState({ exists: false }, head)).toBe('none')
  })

  it('compares the worktree HEAD with the MR head', () => {
    expect(checkoutState({ exists: true, path: '/wt/app-12345678', headSha: head }, head)).toBe('current')
    expect(checkoutState({ exists: true, path: '/wt/app-12345678', headSha: 'b'.repeat(40) }, head)).toBe('outdated')
  })
})
