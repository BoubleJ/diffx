import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { fakeGlab } from './test/fakeGlab'
import { GlabError } from './gitlab/glab'
import { createApp } from './server'

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
