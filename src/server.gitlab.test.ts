import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { fakeGlab } from './test/fakeGlab'
import { GlabError } from './gitlab/glab'
import { createApp } from './server'
import { hasCommit } from './git'
import { makeMrRepo, apiMr } from './test/mrRepo'

function clientDir() {
  const dir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  return dir
}

const PROJECT = { path_with_namespace: 'team/app', web_url: 'https://gitlab.example.com/team/app' }

function setup(routes: Record<string, unknown>) {
  const repo = makeRepo()
  commit(repo, { 'a.txt': 'a\n' }, 'base')
  git(repo, 'remote', 'add', 'origin', 'https://gitlab.example.com/team/app.git')
  const fake = fakeGlab(routes)
  const app = createApp({ repoPath: repo, clientDir: clientDir(), glab: fake.glab })
  return { app, repo, ...fake }
}

describe('GET /api/gitlab/status', () => {
  it('returns the status and reuses it until refresh=true', async () => {
    const { app, calls } = setup({ 'GET projects/:fullpath': PROJECT, 'GET user': { username: 'me' } })
    const first = await (await app.request('/api/gitlab/status')).json()
    expect(first).toEqual({ available: true, host: 'gitlab.example.com', project: 'team/app', webUrl: 'https://gitlab.example.com/team/app', username: 'me' })
    await app.request('/api/gitlab/status')
    expect(calls).toHaveLength(2)
    await app.request('/api/gitlab/status?refresh=true')
    expect(calls).toHaveLength(4)
  })

  it('reports why GitLab is unavailable', async () => {
    const { app } = setup({ 'GET projects/:fullpath': new GlabError('auth', 'Unauthenticated.') })
    expect(await (await app.request('/api/gitlab/status')).json())
      .toEqual({ available: false, reason: 'auth', message: 'Unauthenticated.', host: 'gitlab.example.com' })
  })
})

describe('GET /api/gitlab/mrs', () => {
  it('passes the filter to GitLab and maps the response', async () => {
    const { app, calls } = setup({
      'GET projects/:fullpath/merge_requests': [{
        iid: 3, title: 't', state: 'opened', source_branch: 's', target_branch: 'main',
        author: { name: 'a' }, web_url: 'u', updated_at: 'd', diff_refs: null,
      }],
    })
    const res = await app.request('/api/gitlab/mrs?state=merged&mine=true&search=abc')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ iid: 3, title: 't', state: 'opened', sourceBranch: 's', targetBranch: 'main', author: 'a', webUrl: 'u', updatedAt: 'd' }])
    expect(calls[0].path).toBe('projects/:fullpath/merge_requests?state=merged&order_by=updated_at&sort=desc&per_page=50&scope=assigned_to_me&search=abc&in=title')
  })

  it('returns 502 with the glab error kind', async () => {
    const { app } = setup({ 'GET projects/:fullpath/merge_requests': new GlabError('api', 'glab: 500') })
    const res = await app.request('/api/gitlab/mrs')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'api', message: 'glab: 500' })
  })
})

function setupMr() {
  const repo = makeMrRepo()
  let detail = apiMr(7, repo.base, repo.head)
  const fake = fakeGlab({
    'GET projects/:fullpath': PROJECT,
    'GET user': { username: 'me' },
    'GET projects/:fullpath/merge_requests/7': () => detail,
  })
  const app = createApp({ repoPath: repo.local, clientDir: clientDir(), glab: fake.glab })
  return { app, ...repo, ...fake, setDetail: (d: typeof detail) => { detail = d } }
}

const detailCalls = (calls: { path: string }[]) => calls.filter((c) => c.path === 'projects/:fullpath/merge_requests/7').length

describe('GET /api/diff?mode=mr', () => {
  it('fetches the MR commits and returns the diff with MR info', async () => {
    const { app, local, base, head } = setupMr()
    expect(hasCommit(local, head)).toBe(false)
    const res = await app.request('/api/diff?mode=mr&iid=7')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patch).toContain('+TWO')
    expect(body).toMatchObject({ key: 'mr:7', mode: 'mr', sourceSha: head, targetSha: base, mergeBase: base, identical: false })
    expect(body.mr).toEqual({ iid: 7, title: '로그인 수정', webUrl: 'https://gitlab.example.com/team/app/-/merge_requests/7', sourceBranch: 'feature', targetBranch: 'main', baseSha: base, startSha: base, headSha: head })
    expect(hasCommit(local, head)).toBe(true)
  })

  it('picks up new commits pushed to the MR', async () => {
    const { app, remote, base, head, setDetail } = setupMr()
    await app.request('/api/diff?mode=mr&iid=7')
    git(remote, 'switch', '-q', '--detach', head)
    const next = commit(remote, { 'c.txt': 'new\n' }, 'more')
    git(remote, 'update-ref', 'refs/merge-requests/7/head', next)
    git(remote, 'switch', '-q', 'main')
    setDetail(apiMr(7, base, next))
    const body = await (await app.request('/api/diff?mode=mr&iid=7')).json()
    expect(body.sourceSha).toBe(next)
    expect(body.patch).toContain('+new')
  })

  it('rejects invalid iids and reports GitLab failures', async () => {
    const { app } = setupMr()
    const bad = await app.request('/api/diff?mode=mr&iid=abc')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'invalid_iid' })
    const missing = await app.request('/api/diff?mode=mr&iid=8')
    expect(missing.status).toBe(500)
  })

  it('returns 502 when the MR commits cannot be fetched', async () => {
    const { app, base, setDetail } = setupMr()
    setDetail(apiMr(7, base, 'f'.repeat(40)))
    const res = await app.request('/api/diff?mode=mr&iid=7')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'mr_fetch_failed' })
  })
})

describe('other APIs in mr mode', () => {
  it('reads file versions from base and head and reuses the cached MR detail', async () => {
    const { app, calls } = setupMr()
    await app.request('/api/diff?mode=mr&iid=7')
    expect(await (await app.request('/api/file-content?mode=mr&iid=7&path=a.txt&version=old')).text()).toBe('one\ntwo\nthree\n')
    expect(await (await app.request('/api/file-content?mode=mr&iid=7&path=b.png&version=new')).text()).toBe('NEWPNG')
    expect((await app.request('/api/file-content?mode=mr&iid=7&path=b.png&version=old')).status).toBe(404)
    expect(detailCalls(calls)).toBe(1)
  })

  it('looks up saved reviews by the MR key', async () => {
    const { app } = setupMr()
    const body = await (await app.request('/api/review?mode=mr&iid=7')).json()
    expect(body.key).toBe('mr:7')
  })
})

function setupNotes(extra: Record<string, unknown> = {}) {
  const ctx = setupMr()
  const mrApi = 'projects/:fullpath/merge_requests/7'
  const routes: Record<string, unknown> = {
    'GET projects/:fullpath': PROJECT,
    'GET user': { username: 'me' },
    [`GET ${mrApi}`]: apiMr(7, ctx.base, ctx.head),
    [`GET ${mrApi}/discussions`]: [],
    [`GET ${mrApi}/draft_notes`]: [],
    [`POST ${mrApi}/draft_notes`]: { id: 99 },
    [`DELETE ${mrApi}/draft_notes/5`]: null,
    [`POST ${mrApi}/draft_notes/bulk_publish`]: null,
    ...extra,
  }
  const fake = fakeGlab(routes)
  const app = createApp({ repoPath: ctx.local, clientDir: clientDir(), glab: fake.glab })
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ...ctx, app, calls: fake.calls, post, mrApi }
}

describe('MR comment APIs', () => {
  it('returns threads from paginated discussions and drafts', async () => {
    const { app, calls, mrApi } = setupNotes()
    const res = await app.request('/api/gitlab/mrs/7/threads')
    expect(await res.json()).toEqual({ comments: [], outdatedCount: 0, draftCount: 0 })
    expect(calls.filter((c) => c.request.paginate).map((c) => c.path)).toEqual([`${mrApi}/discussions?per_page=100`, `${mrApi}/draft_notes?per_page=100`])
  })

  it('creates a line draft with the computed position', async () => {
    const { post, calls, mrApi, head } = setupNotes()
    const res = await post('/api/gitlab/mrs/7/drafts', { filePath: 'a.txt', side: 'additions', lineNumber: 2, body: '확인 부탁' })
    expect(res.status).toBe(201)
    const sent = calls.find((c) => c.path === `${mrApi}/draft_notes` && c.request.method === 'POST')!
    expect(sent.request.body).toEqual({
      note: '확인 부탁',
      position: { position_type: 'text', base_sha: expect.any(String), start_sha: expect.any(String), head_sha: head, old_path: 'a.txt', new_path: 'a.txt', new_line: 2 },
    })
  })

  it('creates a reply draft', async () => {
    const { post, calls, mrApi } = setupNotes()
    await post('/api/gitlab/mrs/7/drafts', { discussionId: 'abc', body: '동의합니다' })
    const sent = calls.find((c) => c.path === `${mrApi}/draft_notes` && c.request.method === 'POST')!
    expect(sent.request.body).toEqual({ note: '동의합니다', in_reply_to_discussion_id: 'abc' })
  })

  it('rejects empty bodies and lines outside the diff files', async () => {
    const { post } = setupNotes()
    expect((await post('/api/gitlab/mrs/7/drafts', { discussionId: 'abc', body: '  ' })).status).toBe(400)
    const res = await post('/api/gitlab/mrs/7/drafts', { filePath: 'nope.txt', side: 'additions', lineNumber: 1, body: 'x' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_position' })
  })

  it('deletes a draft and publishes all drafts', async () => {
    const { app, post, calls, mrApi } = setupNotes()
    expect((await app.request('/api/gitlab/mrs/7/drafts/5', { method: 'DELETE' })).status).toBe(200)
    expect((await app.request('/api/gitlab/mrs/7/drafts/x', { method: 'DELETE' })).status).toBe(400)
    expect((await post('/api/gitlab/mrs/7/publish', {})).status).toBe(200)
    expect(calls.map((c) => `${c.request.method ?? 'GET'} ${c.path}`)).toContain(`POST ${mrApi}/draft_notes/bulk_publish`)
  })

  it('returns 502 when GitLab rejects the draft', async () => {
    const { post } = setupNotes({ 'POST projects/:fullpath/merge_requests/7/draft_notes': new GlabError('api', 'glab: 400 Bad Request') })
    const res = await post('/api/gitlab/mrs/7/drafts', { discussionId: 'abc', body: 'x' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'api', message: 'glab: 400 Bad Request' })
  })
})
