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
  it('is derived from the comparison key only', () => {
    expect(savedReviewKey('branch-key')).toEqual(['review', 'branch-key'])
  })
})
