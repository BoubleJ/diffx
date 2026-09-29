import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewJobs, type JobEvent, type RunFn } from './jobs'
import { ReviewStore } from './store'
import { ReviewFailure, type ReviewContext } from './types'
import { claudeProvider } from './providers/claude'

const ctx: ReviewContext = { repoPath: '/repo', mode: 'worktree', sourceCheckedOut: true, files: [], patch: '' }
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
    expect(jobs.runningFor('worktree')).toBeNull()
  })

  it('returns the same job for a duplicate start while running', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(input)
    const b = jobs.start(input)
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
    expect(jobs.runningFor('worktree')).toMatchObject({ id: a, provider: 'claude' })
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
})
