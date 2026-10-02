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
    body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main', kind: 'review', ...overrides }),
  })
}

describe('review API', () => {
  it('lists providers with install status', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const list = await (await app.request('/api/review/providers')).json()
    expect(list).toEqual([{ id: 'claude', label: 'Fake', installed: true, version: process.version, verified: true, installHint: 'x', loginHint: 'fake' }])
  })

  it('runs a review, streams events, stores it and reports staleness', async () => {
    let receivedCtx: unknown
    const { app, repo } = setup(async (_p, ctx, _r, opts) => {
      receivedCtx = ctx
      opts.onProgress?.('a.txt 읽는 중')
      return { answer: '요약', locations: [] }
    })
    const start = await postReview(app)
    const { id } = await start.json()
    const sse = await readSse(await app.request(`/api/review/${id}/events`))
    expect(sse).toContain('event: progress')
    expect(sse).toContain('a.txt 읽는 중')
    expect(sse).toContain('event: done')
    expect(receivedCtx).toMatchObject({ mode: 'branch', source: 'feature/x', target: 'main', sourceCheckedOut: true, files: ['a.txt'] })

    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved).toMatchObject({ key: 'branch:main...feature/x', running: null, messages: [{ kind: 'review', question: null, stale: false, result: { answer: '요약' } }] })
    expect(typeof saved.sessionId).toBe('string')

    commit(repo, { 'a.txt': 'base\nfeature\nmore\n' }, 'more')
    const stale = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(stale.messages[0].stale).toBe(true)
  })

  it('reports a running review for the key and cancels it', async () => {
    const { app } = setup((_p, _c, _r, opts) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const { id } = await (await postReview(app)).json()
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.running).toMatchObject({ id, provider: 'claude', kind: 'review', question: null })
    expect(await (await app.request(`/api/review/${id}`, { method: 'DELETE' })).json()).toEqual({ ok: true })
  })

  it('rejects a new question with 409 while one is running for the same comparison', async () => {
    const { app } = setup(() => new Promise(() => {}))
    expect((await postReview(app, { kind: 'question', question: '첫 질문' })).status).toBe(200)
    const res = await postReview(app, { kind: 'question', question: '다른 질문' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'running', message: '진행 중인 질문이 끝난 뒤 다시 보내 주세요' })
  })

  it('rejects unknown providers', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'nope', mode: 'worktree' }),
    })
    expect(res.status).toBe(400)
  })

  it('releases the listener after a terminal event', async () => {
    const { app, jobs } = setup(async () => ({ answer: 's', locations: [] }))
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
    const { repo, clientDir, store } = setup(async () => ({ answer: 's', locations: [] }))
    const jobs = new ReviewJobs(store, (_p, _c, _r, opts) => new Promise((_resolve, reject) => {
      signal = opts.signal
      opts.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const server = await startServer({ repoPath: repo, clientDir, port: 0, host: '127.0.0.1', reviewJobs: jobs, reviewStore: store, providers: [fakeProvider] })
    const res = await fetch(`http://127.0.0.1:${server.port}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main', kind: 'review' }),
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
      return { answer: 's', locations: [] }
    })
    git(repo, 'switch', '-q', 'feature/x')
    commit(repo, { 'b.txt': 'b\n' }, 'add b')
    const { id } = await (await postReview(app, { exclude: ['a.txt'] })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx!.files).toEqual(['b.txt'])
    expect(receivedCtx!.patch).not.toContain('a.txt')
    expect(receivedCtx!.patch).toContain('b.txt')
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0].stale).toBe(false)
    expect(saved.messages[0].excluded).toEqual(['a.txt'])
    expect(store.load(repo, saved.key)?.messages[0].excluded).toEqual(['a.txt'])
  })

  it('sends only the trimmed question, ignores exclude and stores the question', async () => {
    let received: { files: string[]; request: { prompt: string } } | undefined
    const { app, repo, store } = setup(async (_p, ctx, request) => {
      received = { files: ctx.files, request }
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { kind: 'question', question: '  이 변경 설명해줘 ', exclude: ['a.txt'] })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(received!.request.prompt).toBe('이 변경 설명해줘')
    expect(received!.files).toEqual(['a.txt'])
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0]).toMatchObject({ kind: 'question', question: '이 변경 설명해줘' })
    expect(saved.messages[0]).not.toHaveProperty('excluded')
    expect(store.load(repo, saved.key)?.messages).toHaveLength(1)
  })

  it('resumes the session for the next question', async () => {
    const sessions: { id: string; resume: boolean }[] = []
    const { app } = setup(async (_p, _c, request) => {
      sessions.push(request.session)
      return { answer: 's', locations: [] }
    })
    for (const body of [{}, { kind: 'question', question: '다음 질문' }]) {
      const { id } = await (await postReview(app, body)).json()
      await readSse(await app.request(`/api/review/${id}/events`))
    }
    expect(sessions[0].resume).toBe(false)
    expect(sessions[1]).toEqual({ id: sessions[0].id, resume: true })
  })

  it('rejects an empty or too long question and an unknown kind', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const empty = await postReview(app, { kind: 'question', question: '   ' })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: 'empty_question', message: '질문을 입력해 주세요' })
    const long = await postReview(app, { kind: 'question', question: 'a'.repeat(2001) })
    expect(long.status).toBe(400)
    expect(await long.json()).toEqual({ error: 'question_too_long', message: '질문은 2000자까지 입력할 수 있습니다' })
    const unknown = await postReview(app, { kind: 'chat' })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'invalid_kind' })
  })

  it('removes one message', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    for (let i = 0; i < 2; i++) {
      const { id } = await (await postReview(app)).json()
      await readSse(await app.request(`/api/review/${id}/events`))
    }
    const before = await (await app.request(`/api/review?${branchQuery}`)).json()
    const target = before.messages[0].id
    const res = await app.request(`/api/review/messages/${target}?${branchQuery}`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    const after = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(after.messages.map((m: { id: string }) => m.id)).toEqual([before.messages[1].id])
    expect(after.sessionId).toBe(before.sessionId)
    const missing = await app.request(`/api/review/messages/${target}?${branchQuery}`, { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })

  it('clears the conversation and starts a new session next time', async () => {
    const sessions: { id: string; resume: boolean }[] = []
    const { app } = setup(async (_p, _c, request) => {
      sessions.push(request.session)
      return { answer: 's', locations: [] }
    })
    const first = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${first.id}/events`))
    const res = await app.request(`/api/review/conversation?${branchQuery}`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    const cleared = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(cleared).toMatchObject({ sessionId: null, messages: [] })
    const second = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${second.id}/events`))
    expect(sessions[1].resume).toBe(false)
    expect(sessions[1].id).not.toBe(sessions[0].id)
  })

  it('refuses to clear the conversation while a question is running', async () => {
    const { app, repo, store } = setup(() => new Promise(() => {}))
    store.append(repo, 'branch:main...feature/x', { provider: 'claude', providerLabel: 'Fake', sessionId: 's-1', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
    await postReview(app, { kind: 'question', question: '진행 중' })
    const res = await app.request(`/api/review/conversation?${branchQuery}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'running' })
    expect(store.load(repo, 'branch:main...feature/x')?.messages).toHaveLength(1)
  })

  it('excludes files with non-ASCII names', async () => {
    let receivedCtx: { files: string[]; patch: string } | undefined
    const { app, repo } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { answer: 's', locations: [] }
    })
    commit(repo, { '한글 파일.txt': 'x\n' }, 'add korean')
    const { id } = await (await postReview(app, { exclude: ['한글 파일.txt'] })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx!.files).toEqual(['a.txt'])
    expect(receivedCtx!.patch).not.toContain('한글')
  })

  it('ignores an exclude value that is not a string array', async () => {
    let receivedCtx: { files: string[] } | undefined
    const { app } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { exclude: 'a.txt' })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx!.files).toEqual(['a.txt'])
  })

  it('marks sourceCheckedOut false when HEAD is not the source branch', async () => {
    let receivedCtx: unknown
    const { app, repo } = setup(async (_p, ctx) => {
      receivedCtx = ctx
      return { answer: 's', locations: [] }
    })
    git(repo, 'switch', '-q', 'main')
    const { id } = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(receivedCtx).toMatchObject({ sourceCheckedOut: false })
  })

  it('returns 400 unknown_ref for an unknown branch', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await postReview(app, { source: 'nope/none' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unknown_ref' })
  })

  it('returns 400 invalid_body for malformed JSON', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await app.request('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
  })

  it('lists conversations of this repository with running state', async () => {
    const { app, repo, store } = setup(() => new Promise(() => {}))
    const saved = (id: string, createdAt: number) => ({ provider: 'claude' as const, providerLabel: 'Fake', sessionId: 's-1', message: { id, createdAt, kind: 'review' as const, question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
    store.append(repo, 'mr:3', saved('m1', 10))
    store.append(repo, 'branch:main...feature/x', saved('m2', 5))
    await postReview(app, { kind: 'question', question: '진행 중' })
    expect(await (await app.request('/api/review/conversations')).json()).toEqual([
      { key: 'mr:3', questionCount: 1, lastAt: 10, running: false },
      { key: 'branch:main...feature/x', questionCount: 1, lastAt: 5, running: true },
    ])
  })

  it('deletes a conversation by key', async () => {
    const { app, repo, store } = setup(async () => ({ answer: 's', locations: [] }))
    store.append(repo, 'mr:3', { provider: 'claude', providerLabel: 'Fake', sessionId: 's-1', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
    const res = await app.request(`/api/review/conversation?key=${encodeURIComponent('mr:3')}`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    expect(store.load(repo, 'mr:3')).toBeNull()
  })

  it('rejects an invalid conversation key', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await app.request('/api/review/conversation?key=foo', { method: 'DELETE' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_key' })
  })

  it('refuses to delete a running conversation by key', async () => {
    const { app } = setup(() => new Promise(() => {}))
    await postReview(app, { kind: 'question', question: '진행 중' })
    const res = await app.request(`/api/review/conversation?key=${encodeURIComponent('branch:main...feature/x')}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'running' })
  })

  const selection = { path: 'a.txt', side: 'additions', startLine: 2, endLine: 2, code: 'feature' }

  it('sends the selected code with the question and stores it', async () => {
    let prompt = ''
    const { app } = setup(async (_p, _c, request) => {
      prompt = request.prompt
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { kind: 'question', question: '왜?', selection })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(prompt).toBe('사용자가 diff에서 선택한 코드: a.txt 2줄 (변경 후 코드)\n```\nfeature\n```\n\n질문: 왜?')
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0]).toMatchObject({ kind: 'question', question: '왜?', selection })
  })

  it('rejects an invalid selection', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    for (const bad of [
      { ...selection, path: '../outside.txt' },
      { ...selection, side: 'both' },
      { ...selection, startLine: 0 },
      { ...selection, startLine: 3, endLine: 2 },
      { ...selection, code: '   ' },
    ]) {
      const res = await postReview(app, { kind: 'question', question: '왜?', selection: bad })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_selection', message: '선택한 코드 정보가 올바르지 않습니다' })
    }
  })

  it('rejects a selection longer than 4000 characters', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await postReview(app, { kind: 'question', question: '왜?', selection: { ...selection, code: 'x'.repeat(4001) } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'selection_too_long', message: '선택한 코드는 4000자까지 보낼 수 있습니다' })
  })

  it('ignores a selection on a full review', async () => {
    let prompt = ''
    const { app } = setup(async (_p, _c, request) => {
      prompt = request.prompt
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { kind: 'review', selection })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(prompt).not.toContain('사용자가 diff에서 선택한 코드')
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0]).not.toHaveProperty('selection')
  })

  it('reports the selection of a running question', async () => {
    const { app } = setup(() => new Promise(() => {}))
    await postReview(app, { kind: 'question', question: '왜?', selection })
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.running).toMatchObject({ kind: 'question', question: '왜?', selection })
  })
})
