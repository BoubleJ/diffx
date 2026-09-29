import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { createApp } from './server'
import { ReviewJobs, type RunFn } from './review/jobs'
import { ReviewStore } from './review/store'
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
  return { app, repo, base }
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
})
