import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewJobs, type JobEvent, type RunFn, type StartInput } from './jobs'
import { ReviewStore } from './store'
import { ReviewFailure, type ReviewContext, type ReviewRequest } from './types'
import { claudeProvider } from './providers/claude'
import { STOP_IMMEDIATELY } from './runner'

const ctx: ReviewContext = { repoPath: '/repo', mode: 'branch', source: 'feature/x', target: 'main', mergeBase: 'abc123', sourceCheckedOut: true, files: ['a.ts'], patch: '+x' }
const newStore = () => new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
const tick = () => new Promise((r) => setTimeout(r, 0))

function deferredRun() {
  const calls: { request: ReviewRequest; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal; onProgress?: (t: string) => void }[] = []
  const run: RunFn = (_p, _c, request, options) => new Promise((resolve, reject) => {
    calls.push({ request, resolve: resolve as (v: unknown) => void, reject, signal: options.signal, onProgress: options.onProgress })
    options.signal?.addEventListener('abort', () => reject(new ReviewFailure('cancelled', '요청을 취소했습니다')))
  })
  return { run, calls }
}

const review: StartInput = { provider: claudeProvider, ctx, key: 'k', fingerprint: 'fp', kind: 'review', question: null, excluded: ['b.ts'] }
const ask: StartInput = { provider: claudeProvider, ctx, key: 'k', fingerprint: 'fp', kind: 'question', question: '이 변경 설명해줘' }
const result = { answer: 's', locations: [] }

describe('ReviewJobs', () => {
  it('starts a new session with the review prompt and saves the message with the session id', async () => {
    const store = newStore()
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(review)
    expect(calls[0].request.session.resume).toBe(false)
    expect(calls[0].request.prompt).toContain('아래 변경사항을 리뷰하세요')
    expect(calls[0].request.systemPrompt).toContain('파일을 수정하지 마세요')
    calls[0].onProgress!('a.ts 읽는 중')
    calls[0].resolve(result)
    await tick()

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events[0]).toEqual({ type: 'progress', text: 'a.ts 읽는 중' })
    expect(events[1]).toMatchObject({ type: 'done', message: { kind: 'review', question: null, fingerprint: 'fp', excluded: ['b.ts'], result } })
    const saved = store.load('/repo', 'k')!
    expect(saved.sessionId).toBe(calls[0].request.session.id)
    expect(saved.messages).toHaveLength(1)
    expect(jobs.runningFor('/repo', 'k')).toBeNull()
  })

  it('sends only the question and resumes the saved session', async () => {
    const store = newStore()
    store.append('/repo', 'k', { provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-1', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'fp', result } })
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    jobs.start({ ...ask, excluded: ['b.ts'] })
    expect(calls[0].request).toMatchObject({ prompt: '이 변경 설명해줘', session: { id: 's-1', resume: true } })
    calls[0].resolve(result)
    await tick()
    const saved = store.load('/repo', 'k')!
    expect(saved.sessionId).toBe('s-1')
    expect(saved.messages[1]).toMatchObject({ kind: 'question', question: '이 변경 설명해줘' })
    expect(saved.messages[1]).not.toHaveProperty('excluded')
  })

  it('retries once with a new session when the saved session is missing', async () => {
    const store = newStore()
    store.append('/repo', 'k', { provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-old', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'fp', result } })
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    jobs.start(ask)
    calls[0].reject(new ReviewFailure('session_missing', '이어갈 Claude 세션을 찾지 못했습니다'))
    await tick()
    expect(calls).toHaveLength(2)
    expect(calls[1].request.session.resume).toBe(false)
    expect(calls[1].request.session.id).not.toBe('s-old')
    expect(calls[1].request.prompt).toBe('이 변경 설명해줘')
    calls[1].resolve(result)
    await tick()
    expect(store.load('/repo', 'k')!.sessionId).toBe(calls[1].request.session.id)
  })

  it('does not retry after cancel', async () => {
    const store = newStore()
    store.append('/repo', 'k', { provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-old', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'fp', result } })
    const calls: { reject: (e: unknown) => void }[] = []
    const run: RunFn = () => new Promise((_resolve, reject) => {
      calls.push({ reject })
    })
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(ask)
    jobs.cancel(id)
    calls[0].reject(new ReviewFailure('session_missing', 'x'))
    await tick()
    expect(calls).toHaveLength(1)
  })

  it('does not save a failed or cancelled question', async () => {
    const store = newStore()
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(ask)
    calls[0].reject(new ReviewFailure('process', 'boom'))
    await tick()
    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events).toEqual([{ type: 'error', kind: 'process', message: 'boom', rawOutput: undefined }])
    const b = jobs.start(ask)
    jobs.cancel(b)
    await tick()
    expect(store.load('/repo', 'k')).toBeNull()
  })

  it('returns the same job for a duplicate start while running and reports its question', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(ask)
    const b = jobs.start(review)
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
    expect(jobs.runningFor('/repo', 'k')).toMatchObject({ id: a, provider: 'claude', kind: 'question', question: '이 변경 설명해줘' })
  })

  it('cancels one job or all jobs', async () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    jobs.start({ ...review, key: 'other' })
    const events: JobEvent[] = []
    jobs.subscribe(a, (e) => events.push(e))
    expect(jobs.cancel(a)).toBe(true)
    await tick()
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'cancelled' })
    jobs.cancelAll()
    expect(calls.every((c) => c.signal?.aborted)).toBe(true)
    expect(jobs.cancel('unknown')).toBe(false)
  })

  it('stops immediately only when cancelAll is called with immediate', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    jobs.start({ ...review, key: 'other' })
    jobs.cancel(a)
    expect(calls[0].signal?.reason).not.toBe(STOP_IMMEDIATELY)
    jobs.cancelAll({ immediate: true })
    expect(calls[1].signal?.reason).toBe(STOP_IMMEDIATELY)
  })

  it('starts separate jobs for the same key in different repos', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    const b = jobs.start({ ...review, ctx: { ...ctx, repoPath: '/other' } })
    expect(a).not.toBe(b)
    expect(calls).toHaveLength(2)
    expect(jobs.runningFor('/other', 'k')?.id).toBe(b)
  })

  it('emits exactly one terminal event even when a listener throws', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const id = jobs.start(review)
    jobs.subscribe(id, () => {
      throw new Error('listener')
    })
    calls[0].resolve(result)
    await new Promise((r) => setTimeout(r, 10))
    process.off('unhandledRejection', onUnhandled)

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['done'])
    expect(unhandled).toEqual([])
  })

  it('reports a save failure as a single process error', async () => {
    const store = newStore()
    store.append = () => {
      throw new Error('disk full')
    }
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(review)
    calls[0].resolve(result)
    await tick()

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', kind: 'process', message: 'disk full' })
    expect(jobs.runningFor('/repo', 'k')).toBeNull()
  })

  it('starts a new job when the same key is started right after cancel', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    jobs.cancel(a)
    expect(jobs.runningFor('/repo', 'k')).toBeNull()
    const b = jobs.start(review)
    expect(b).not.toBe(a)
    expect(calls).toHaveLength(2)
  })
})
