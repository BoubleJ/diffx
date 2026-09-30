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
