import { describe, it, expect } from 'vitest'
import { fetchProviders, savedReviewKey } from './useReview'

describe('fetchProviders', () => {
  it('returns the provider list on success', async () => {
    const list = [{ id: 'claude', label: 'Claude Code' }]
    const fetchFn = async () => new Response(JSON.stringify(list), { status: 200 })
    expect(await fetchProviders(fetchFn)).toEqual(list)
  })

  it('returns an empty list when the response is not ok', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    expect(await fetchProviders(fetchFn)).toEqual([])
  })
})

describe('savedReviewKey', () => {
  it('differs when worktree options change for the same comparison key', () => {
    expect(savedReviewKey('worktree', 'mode=worktree&staged=true')).not.toEqual(savedReviewKey('worktree', 'mode=worktree&staged=false'))
    expect(savedReviewKey('worktree', 'mode=worktree')[0]).toBe('review')
  })
})
