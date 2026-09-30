import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from './test/gitRepo'
import { fakeGlab } from './test/fakeGlab'
import { makeMrRepo, apiMr, pushMrCommit } from './test/mrRepo'

const PROJECT = { path_with_namespace: 'team/app', web_url: 'https://gitlab.example.com/team/app' }

beforeEach(() => {
  vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'diffx-home-')))
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function setup() {
  const { createApp } = await import('./server')
  const { saveSettings } = await import('./settings')
  const repo = makeMrRepo()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-worktrees-')))
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '<html></html>')
  const details: Record<number, unknown> = { 7: apiMr(7, repo.base, repo.head) }
  const { glab } = fakeGlab({
    'GET projects/:fullpath': PROJECT,
    'GET user': { username: 'me' },
    'GET projects/:fullpath/merge_requests/7': () => details[7],
  })
  const opened: string[][] = []
  let openError: Error | null = null
  const openApp = async (args: string[]) => {
    if (openError) throw openError
    opened.push(args)
  }
  const app = createApp({ repoPath: repo.local, clientDir, glab, reviewWorktreeRoot: root, openApp })
  const post = (path: string, body: unknown = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const status = async () => (await app.request('/api/review-worktree')).json()
  return {
    ...repo, app, root, details, opened, post, status, saveSettings,
    failOpen: (err: Error) => { openError = err },
  }
}

describe('review worktree APIs', () => {
  it('checks out the MR head and reports the worktree status', async () => {
    const { head, root, post, status } = await setup()
    expect(await status()).toEqual({ exists: false })
    const res = await post('/api/gitlab/mrs/7/checkout')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ path: expect.any(String), headSha: head, copiedEnvFiles: [] })
    expect(body.path.startsWith(`${root}/`)).toBe(true)
    expect(await status()).toEqual({ exists: true, path: body.path, headSha: head })
  })

  it('checks out new commits pushed to the MR', async () => {
    const { remote, base, head, details, post, status } = await setup()
    await post('/api/gitlab/mrs/7/checkout')
    const next = pushMrCommit(remote, 7, head, { 'c.txt': 'c\n' })
    details[7] = apiMr(7, base, next)
    expect(await (await post('/api/gitlab/mrs/7/checkout')).json()).toMatchObject({ headSha: next })
    expect(await status()).toMatchObject({ headSha: next })
  })

  it('keeps serving the displayed MR version after checking out newer commits', async () => {
    const { app, remote, base, head, details, post } = await setup()
    await app.request('/api/diff?mode=mr&iid=7')
    const next = pushMrCommit(remote, 7, head, { 'c.txt': 'c\n' })
    details[7] = apiMr(7, base, next)
    expect(await (await post('/api/gitlab/mrs/7/checkout')).json()).toMatchObject({ headSha: next })
    expect((await app.request('/api/file-content?mode=mr&iid=7&path=c.txt&version=new')).status).toBe(404)
  })

  it('returns 409 with changed files and checks out with force', async () => {
    const { app, head, post } = await setup()
    const { path } = await (await post('/api/gitlab/mrs/7/checkout')).json()
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    const dirty = await post('/api/gitlab/mrs/7/checkout')
    expect(dirty.status).toBe(409)
    expect(await dirty.json()).toEqual({ error: 'dirty', files: ['a.txt'] })
    expect(await (await app.request('/api/review-worktree/changes')).json()).toEqual({ files: ['a.txt'] })
    const forced = await post('/api/gitlab/mrs/7/checkout', { force: true })
    expect(forced.status).toBe(200)
    expect(await forced.json()).toMatchObject({ headSha: head })
    expect(await (await app.request('/api/review-worktree/changes')).json()).toEqual({ files: [] })
  })

  it('returns 502 when the MR commits cannot be fetched', async () => {
    const { base, details, post } = await setup()
    details[7] = apiMr(7, base, 'f'.repeat(40))
    const res = await post('/api/gitlab/mrs/7/checkout')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'mr_fetch_failed' })
  })

  it('rejects invalid iids', async () => {
    const { post } = await setup()
    const res = await post('/api/gitlab/mrs/abc/checkout')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_iid' })
  })

  it('opens the worktree with the configured terminal app', async () => {
    const { post, opened, saveSettings } = await setup()
    const missing = await post('/api/review-worktree/open-terminal')
    expect(missing.status).toBe(404)
    expect(opened).toEqual([])
    const { path } = await (await post('/api/gitlab/mrs/7/checkout')).json()
    expect((await post('/api/review-worktree/open-terminal')).status).toBe(204)
    saveSettings({ terminalApp: 'Visual Studio Code' })
    await post('/api/review-worktree/open-terminal')
    saveSettings({ terminalApp: '' })
    await post('/api/review-worktree/open-terminal')
    expect(opened).toEqual([
      ['-a', 'Terminal', path],
      ['-a', 'Visual Studio Code', path],
      ['-a', 'Terminal', path],
    ])
  })

  it('returns the open error message', async () => {
    const { post, failOpen } = await setup()
    await post('/api/gitlab/mrs/7/checkout')
    failOpen(new Error("Unable to find application named 'Nope'"))
    const res = await post('/api/review-worktree/open-terminal')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'open_failed', message: "Unable to find application named 'Nope'" })
  })

  it('deletes the worktree', async () => {
    const { app, local, post, status } = await setup()
    const { path } = await (await post('/api/gitlab/mrs/7/checkout')).json()
    const res = await app.request('/api/review-worktree', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(existsSync(path)).toBe(false)
    expect(git(local, 'worktree', 'list', '--porcelain')).not.toContain(path)
    expect(await status()).toEqual({ exists: false })
  })
})
