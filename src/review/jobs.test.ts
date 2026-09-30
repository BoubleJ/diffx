import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewJobs, type JobEvent, type RunFn } from './jobs'
import { ReviewStore } from './store'
import { ReviewFailure, type ReviewContext } from './types'
import { claudeProvider } from './providers/claude'
import { STOP_IMMEDIATELY } from './runner'

const ctx: ReviewContext = { repoPath: '/repo', mode: 'branch', source: 'feature/x', target: 'main', mergeBase: 'abc123', sourceCheckedOut: true, files: [], patch: '' }
const newStore = () => new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))

function deferredRun() {
  const calls: { resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal; onProgress?: (t: string) => void }[] = []
  const run: RunFn = (_p, _c, options) => new Promise((resolve, reject) => {
    calls.push({ resolve: resolve as (v: unknown) => void, reject, signal: options.signal, onProgress: options.onProgress })
    options.signal?.addEventListener('abort', () => reject(new ReviewFailure('cancelled', '리뷰를 취소했습니다')))
  })
  return { run, calls }
}

const input = { provider: claudeProvider, ctx, key: 'worktree', fingerprint: 'fp' }

describe('ReviewJobs', () => {
  it('replays events to late subscribers and saves the result', async () => {
    const store = newStore()
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(input)
    calls[0].onProgress!('a.ts 읽는 중')
    calls[0].resolve({ summary: 's', findings: [] })
    await new Promise((r) => setTimeout(r, 0))

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events[0]).toEqual({ type: 'progress', text: 'a.ts 읽는 중' })
    expect(events[1]).toMatchObject({ type: 'done', record: { provider: 'claude', fingerprint: 'fp', result: { summary: 's' } } })
    expect(store.load('/repo', 'worktree')?.result.summary).toBe('s')
    expect(jobs.runningFor('/repo', 'worktree')).toBeNull()
  })

  it('returns the same job for a duplicate start while running', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(input)
    const b = jobs.start(input)
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
    expect(jobs.runningFor('/repo', 'worktree')).toMatchObject({ id: a, provider: 'claude' })
  })

  it('cancels one job or all jobs', async () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(input)
    jobs.start({ ...input, key: 'branch:x...y' })
    const events: JobEvent[] = []
    jobs.subscribe(a, (e) => events.push(e))
    expect(jobs.cancel(a)).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'cancelled' })
    jobs.cancelAll()
    expect(calls.every((c) => c.signal?.aborted)).toBe(true)
    expect(jobs.cancel('unknown')).toBe(false)
  })

  it('stops immediately only when cancelAll is called with immediate', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(input)
    jobs.start({ ...input, key: 'branch:x...y' })
    jobs.cancel(a)
    expect(calls[0].signal?.reason).not.toBe(STOP_IMMEDIATELY)
    jobs.cancelAll({ immediate: true })
    expect(calls[1].signal?.reason).toBe(STOP_IMMEDIATELY)
  })

  it('starts separate jobs for the same key in different repos', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(input)
    const b = jobs.start({ ...input, ctx: { ...ctx, repoPath: '/other' } })
    expect(a).not.toBe(b)
    expect(calls).toHaveLength(2)
    expect(jobs.runningFor('/other', 'worktree')?.id).toBe(b)
  })

  it('emits exactly one terminal event even when a listener throws', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const id = jobs.start(input)
    jobs.subscribe(id, () => {
      throw new Error('listener')
    })
    calls[0].resolve({ summary: 's', findings: [] })
    await new Promise((r) => setTimeout(r, 10))
    process.off('unhandledRejection', onUnhandled)

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['done'])
    expect(unhandled).toEqual([])
  })

  it('reports a save failure as a single process error', async () => {
    const store = newStore()
    store.save = () => {
      throw new Error('disk full')
    }
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(input)
    calls[0].resolve({ summary: 's', findings: [] })
    await new Promise((r) => setTimeout(r, 0))

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', kind: 'process', message: 'disk full' })
    expect(jobs.runningFor('/repo', 'worktree')).toBeNull()
  })

  it('starts a new job when the same key is started right after cancel', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(input)
    jobs.cancel(a)
    expect(jobs.runningFor('/repo', 'worktree')).toBeNull()
    const b = jobs.start(input)
    expect(b).not.toBe(a)
    expect(calls).toHaveLength(2)
  })
})
