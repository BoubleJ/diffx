import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { createApp, startServer } from './server'
import { ReviewJobs, type RunFn } from './review/jobs'
import { ReviewStore } from './review/store'
import { STOP_IMMEDIATELY } from './review/runner'
import type { ReviewProvider } from './review/types'

const fakeProvider: ReviewProvider = {
  id: 'claude',
  label: 'Fake',
  verified: true,
  installHint: 'x',
  loginHint: 'fake',
  authPattern: /login/,
  versionArgs: ['--version'],
  buildCommand: () => ({ bin: process.execPath, args: [] }),
}

function setup(run: RunFn) {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n' }, 'base')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  commit(repo, { 'a.txt': 'base\nfeature\n' }, 'feature')
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '')
  const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
  const jobs = new ReviewJobs(store, run)
  const app = createApp({ repoPath: repo, clientDir, reviewJobs: jobs, reviewStore: store, providers: [fakeProvider] })
  return { app, repo, base, jobs, store, clientDir }
}

const branchQuery = 'mode=branch&source=feature/x&target=main'

async function readSse(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
    if (text.includes('event: done') || text.includes('event: error')) break
  }
  await reader.cancel()
  return text
}

function postReview(app: ReturnType<typeof createApp>, overrides: Record<string, unknown> = {}) {
  return app.request('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main', ...overrides }),
  })
}

describe('review API', () => {
  it('lists providers with install status', async () => {
    const { app } = setup(async () => ({ summary: 's', findings: [] }))
    const list = await (await app.request('/api/review/providers')).json()
    expect(list).toEqual([{ id: 'claude', label: 'Fake', installed: true, version: process.version, verified: true, installHint: 'x', loginHint: 'fake' }])
  })

  it('runs a review, streams events, stores it and reports staleness', async () => {
    let receivedCtx: unknown
    const { app, repo } = setup(async (_p, ctx, opts) => {
      receivedCtx = ctx
      opts.onProgress?.('a.txt 읽는 중')
      return { summary: '요약', findings: [] }
    })
    const start = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main' }),
    })
    const { id } = await start.json()
    const sse = await readSse(await app.request(`/api/review/${id}/events`))
    expect(sse).toContain('event: progress')
    expect(sse).toContain('a.txt 읽는 중')
    expect(sse).toContain('event: done')
    expect(receivedCtx).toMatchObject({ mode: 'branch', source: 'feature/x', target: 'main', sourceCheckedOut: true, files: ['a.txt'] })

    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved).toMatchObject({ key: 'branch:main...feature/x', stale: false, running: null, record: { result: { summary: '요약' } } })

    commit(repo, { 'a.txt': 'base\nfeature\nmore\n' }, 'more')
    const stale = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(stale.stale).toBe(true)
  })

  it('reports a running review for the key and cancels it', async () => {
    const { app } = setup((_p, _c, opts) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const { id } = await (await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main' }),
    })).json()
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.running).toMatchObject({ id, provider: 'claude' })
    expect(await (await app.request(`/api/review/${id}`, { method: 'DELETE' })).json()).toEqual({ ok: true })
  })

  it('rejects unknown providers', async () => {
    const { app } = setup(async () => ({ summary: 's', findings: [] }))
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'nope', mode: 'worktree' }),
    })
    expect(res.status).toBe(400)
  })

  it('releases the listener after a terminal event', async () => {
    const { app, jobs } = setup(async () => ({ summary: 's', findings: [] }))
    const { id } = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    await vi.waitFor(() => expect(jobs.listenerCount(id)).toBe(0))
  })

  it('releases the listener when the SSE request is aborted', async () => {
    const { app, jobs } = setup(() => new Promise(() => {}))
    const { id } = await (await postReview(app)).json()
    const controller = new AbortController()
    const res = await app.request(`/api/review/${id}/events`, { signal: controller.signal })
    const reader = res.body!.getReader()
    await vi.waitFor(() => expect(jobs.listenerCount(id)).toBe(1))
    controller.abort()
    await reader.cancel().catch(() => {})
    await vi.waitFor(() => expect(jobs.listenerCount(id)).toBe(0))
  })

  it('aborts running jobs when the server closes', async () => {
    let signal: AbortSignal | undefined
    const { repo, clientDir, store } = setup(async () => ({ summary: 's', findings: [] }))
    const jobs = new ReviewJobs(store, (_p, _c, opts) => new Promise((_resolve, reject) => {
      signal = opts.signal
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const server = await startServer({ repoPath: repo, clientDir, port: 0, host: '127.0.0.1', reviewJobs: jobs, reviewStore: store, providers: [fakeProvider] })
    const res = await fetch(`http://127.0.0.1:${server.port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main' }),
    })
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(signal).toBeDefined())
    await server.close()
    expect(signal!.aborted).toBe(true)
    expect(signal!.reason).toBe(STOP_IMMEDIATELY)
  })

  it('removes excluded files from the review context and stores them on the record', async () => {
    let receivedCtx: { files: string[]; patch: string } | undefined
    const { app, repo, store } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { summary: 's', findings: [] }
    })
    git(repo, 'switch', '-q', 'feature/x')
    commit(repo, { 'b.txt': 'b\n' }, 'add b')
    const { id } = await (await postReview(app, { exclude: ['a.txt'] })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx!.files).toEqual(['b.txt'])
    expect(receivedCtx!.patch).not.toContain('a.txt')
    expect(receivedCtx!.patch).toContain('b.txt')
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.stale).toBe(false)
    expect(saved.record.excluded).toEqual(['a.txt'])
    expect(store.load(repo, saved.key)?.excluded).toEqual(['a.txt'])
  })

  it('ignores an exclude value that is not a string array', async () => {
    let receivedCtx: { files: string[] } | undefined
    const { app } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { summary: 's', findings: [] }
    })
    const { id } = await (await postReview(app, { exclude: 'a.txt' })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx!.files).toEqual(['a.txt'])
  })

  it('marks sourceCheckedOut false when HEAD is not the source branch', async () => {
    let receivedCtx: unknown
    const { app, repo } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { summary: 's', findings: [] }
    })
    git(repo, 'switch', '-q', 'main')
    const { id } = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx).toMatchObject({ sourceCheckedOut: false })
  })

  it('passes staged to the review context in worktree mode', async () => {
    let receivedCtx: unknown
    const { app } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { summary: 's', findings: [] }
    })
    const { id } = await (await postReview(app, { mode: 'worktree', staged: true })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx).toMatchObject({ mode: 'worktree', staged: true })
  })

  it('returns 400 unknown_ref for an unknown branch', async () => {
    const { app } = setup(async () => ({ summary: 's', findings: [] }))
    const res = await postReview(app, { source: 'nope/none' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unknown_ref' })
  })

  it('returns 400 invalid_body for malformed JSON', async () => {
    const { app } = setup(async () => ({ summary: 's', findings: [] }))
    const res = await app.request('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
  })
})
