import { describe, it, expect } from 'vitest'
import { fetchProviders, savedReviewKey, questionToRefill, appendMessage, type ReviewState } from './useReview'

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

describe('questionToRefill', () => {
  const failed: ReviewState = { status: 'error', pending: { kind: 'question', question: '이 변경 설명해줘' }, kind: 'cancelled', message: '취소했습니다' }

  it('returns the failed question when the input is empty', () => {
    expect(questionToRefill(failed, '')).toBe('이 변경 설명해줘')
    expect(questionToRefill(failed, '  \n')).toBe('이 변경 설명해줘')
  })

  it('keeps a question typed while running', () => {
    expect(questionToRefill(failed, '새로 입력한 질문')).toBeNull()
  })

  it('does not refill a full review or other states', () => {
    expect(questionToRefill({ ...failed, pending: { kind: 'review', question: null } }, '')).toBeNull()
    expect(questionToRefill({ status: 'idle' }, '')).toBeNull()
    expect(questionToRefill({ status: 'running', pending: failed.pending, progress: null, startedAt: 0 }, '')).toBeNull()
  })
})

describe('appendMessage', () => {
  const message = { id: 'm2', createdAt: 2, kind: 'question' as const, question: 'q', fingerprint: 'f', result: { answer: 'a', locations: [] } }
  const saved = { key: 'k', sessionId: 's', messages: [{ ...message, id: 'm1', stale: true }], running: { id: 'job', provider: 'claude' as const, startedAt: 0, kind: 'question' as const, question: 'q' } }

  it('appends the finished message as not stale and clears running', () => {
    const next = appendMessage(saved, message)!
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(next.messages[1].stale).toBe(false)
    expect(next.running).toBeNull()
  })

  it('does not duplicate a message already fetched', () => {
    const once = appendMessage(saved, message)!
    expect(appendMessage(once, message)).toBe(once)
    expect(appendMessage(undefined, message)).toBeUndefined()
  })
})
