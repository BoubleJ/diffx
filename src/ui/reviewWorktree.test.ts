import { describe, it, expect } from 'vitest'
import { checkoutOutcome, checkoutState } from './reviewWorktree'

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

describe('checkoutOutcome', () => {
  const head = 'a'.repeat(40)
  const newer = 'b'.repeat(40)

  it('announces copied env files', () => {
    expect(checkoutOutcome({ headSha: head, copiedEnvFiles: ['.env.local', 'apps/web/.env'] }, head))
      .toEqual({ notice: 'env 파일 2개를 복사했습니다', reloadDiff: false })
    expect(checkoutOutcome({ headSha: head, copiedEnvFiles: [] }, head)).toEqual({ notice: null, reloadDiff: false })
  })

  it('reloads the diff when the MR has newer commits than the displayed diff', () => {
    expect(checkoutOutcome({ headSha: newer, copiedEnvFiles: [] }, head)).toEqual({ notice: null, reloadDiff: true })
  })
})
