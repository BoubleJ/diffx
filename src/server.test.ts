import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { createApp } from './server'

function clientDir() {
  const dir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  return dir
}

export function setupApp(customDiffArgs?: string[]) {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n', 'img.png': 'OLDPNG' }, 'base')
  git(repo, 'update-ref', 'refs/remotes/origin/main', base)
  git(repo, 'switch', '-q', '-c', 'feature/x')
  const feature = commit(repo, { 'a.txt': 'base\nfeature\n', 'img.png': 'NEWPNG' }, 'feature')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'img.png'), 'WORKTREEPNG')
  const app = createApp({ repoPath: repo, clientDir: clientDir(), customDiffArgs })
  return { app, repo, base, feature }
}

describe('GET /api/repo and /api/branches', () => {
  it('returns repo info and branch lists', async () => {
    const { app, repo } = setupApp()
    const info = await (await app.request('/api/repo')).json()
    expect(info).toEqual({ root: repo, name: repo.split('/').pop(), customMode: false })
    const branches = await (await app.request('/api/branches')).json()
    expect(branches.local).toEqual(['feature/x', 'main'])
    expect(branches.remote).toEqual(['origin/main'])
    expect(branches.defaultTarget).toBe('origin/main')
  })
})

describe('GET /api/diff', () => {
  it('branch mode returns the range diff with shas', async () => {
    const { app, base, feature } = setupApp()
    const res = await app.request('/api/diff?mode=branch&source=feature/x&target=origin/main')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patch).toContain('+feature')
    expect(body).toMatchObject({ key: 'branch:origin/main...feature/x', mode: 'branch', sourceSha: feature, targetSha: base, mergeBase: base, identical: false })
  })

  it('reports identical branches', async () => {
    const { app } = setupApp()
    const body = await (await app.request('/api/diff?mode=branch&source=main&target=origin/main')).json()
    expect(body.identical).toBe(true)
    expect(body.patch).toBe('')
  })

  it('returns 400 for unknown refs and 422 without merge base', async () => {
    const { app, repo } = setupApp()
    const bad = await app.request('/api/diff?mode=branch&source=nope&target=main')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'unknown_ref' })

    git(repo, 'stash', '-q', '-u')
    git(repo, 'switch', '-q', '--orphan', 'orphan')
    commit(repo, { 'z.txt': 'z\n' }, 'orphan')
    const unrelated = await app.request('/api/diff?mode=branch&source=orphan&target=main')
    expect(unrelated.status).toBe(422)
    expect(await unrelated.json()).toMatchObject({ error: 'no_merge_base', message: '두 브랜치의 공통 조상 커밋이 없습니다' })
  })
})

describe('GET /api/file-content in branch mode', () => {
  it('reads old from merge-base and new from source, not the worktree', async () => {
    const { app } = setupApp()
    const q = 'mode=branch&source=feature/x&target=origin/main&path=img.png'
    expect(await (await app.request(`/api/file-content?${q}&version=old`)).text()).toBe('OLDPNG')
    expect(await (await app.request(`/api/file-content?${q}&version=new`)).text()).toBe('NEWPNG')
  })

  it('worktree mode keeps reading the worktree for the new version', async () => {
    const { app } = setupApp()
    expect(await (await app.request('/api/file-content?path=img.png&version=new')).text()).toBe('WORKTREEPNG')
  })
})

describe('GET /api/file-versions in branch mode', () => {
  it('serves full contents for oids in the branch diff', async () => {
    const { app } = setupApp()
    const diff = await (await app.request('/api/diff?mode=branch&source=feature/x&target=origin/main')).json()
    const chunk = diff.patch.split(/^(?=diff --git )/m).find((c: string) => c.includes('+++ b/a.txt'))
    const [, oldOid, newOid] = chunk.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
    const res = await app.request(`/api/file-versions?mode=branch&source=feature/x&target=origin/main&path=a.txt&oldOid=${oldOid}&newOid=${newOid}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ old: 'base\n', new: 'base\nfeature\n' })
  })

  it('returns the same result on repeated requests and uses the new patch after a new commit', async () => {
    const { app, repo } = setupApp()
    const q = 'mode=branch&source=feature/x&target=origin/main'
    const oidsFor = async () => {
      const diff = await (await app.request(`/api/diff?${q}`)).json()
      const chunk = diff.patch.split(/^(?=diff --git )/m).find((c: string) => c.includes('+++ b/a.txt'))
      const [, oldOid, newOid] = chunk.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
      return `path=a.txt&oldOid=${oldOid}&newOid=${newOid}`
    }
    const first = await oidsFor()
    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/file-versions?${q}&${first}`)
      expect(await res.json()).toEqual({ old: 'base\n', new: 'base\nfeature\n' })
    }

    git(repo, 'stash', '-q')
    git(repo, 'switch', '-q', 'feature/x')
    commit(repo, { 'a.txt': 'base\nfeature\nmore\n' }, 'more')
    git(repo, 'switch', '-q', 'main')
    expect((await app.request(`/api/file-versions?${q}&${first}`)).status).toBe(404)
    const second = await oidsFor()
    expect(await (await app.request(`/api/file-versions?${q}&${second}`)).json()).toEqual({ old: 'base\n', new: 'base\nfeature\nmore\n' })
  })
})

describe('comments and viewed are scoped by comparison key', () => {
  it('separates comments per key and defaults to the last diffed key', async () => {
    const { app } = setupApp()
    const post = (body: object) => app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'a.txt', side: 'additions', lineNumber: 1, lineContent: 'x', body: 'c', ...body }),
    })
    await post({ key: 'worktree', body: 'on worktree' })
    await post({ key: 'branch:origin/main...feature/x', body: 'on branch' })

    const wt = await (await app.request('/api/comments?key=worktree')).json()
    expect(wt.map((c: { body: string }) => c.body)).toEqual(['on worktree'])

    // key 없는 요청은 마지막 /api/diff 조합을 따른다 (skills/diffx-finish-review 호환)
    await app.request('/api/diff?mode=branch&source=feature/x&target=origin/main')
    const active = await (await app.request('/api/comments')).json()
    expect(active.map((c: { body: string }) => c.body)).toEqual(['on branch'])

    // key 없는 POST도 active key로 저장된다
    await post({ body: 'no key' })
    const branch = await (await app.request('/api/comments?key=branch:origin/main...feature/x')).json()
    expect(branch.map((c: { body: string }) => c.body)).toEqual(['on branch', 'no key'])
  })

  it('separates viewed state per key', async () => {
    const { app } = setupApp()
    await app.request('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'worktree', filePath: 'a.txt', viewed: true, contentHash: 'abc' }),
    })
    expect(await (await app.request('/api/viewed?key=worktree')).json()).toEqual({ 'a.txt': 'abc' })
    expect(await (await app.request('/api/viewed?key=branch:origin/main...feature/x')).json()).toEqual({})
  })
})

describe('custom mode diff directory', () => {
  it('runs custom git diff args from diffCwd so pathspecs are relative to it', async () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'a\n', 'sub/b.txt': 'b\n' }, 'base')
    writeFileSync(join(repo, 'a.txt'), 'a changed\n')
    writeFileSync(join(repo, 'sub/b.txt'), 'b changed\n')
    const app = createApp({ repoPath: repo, clientDir: clientDir(), customDiffArgs: ['--', '.'], diffCwd: join(repo, 'sub') })
    const body = await (await app.request('/api/diff')).json()
    expect(body.patch).toContain('+++ b/sub/b.txt')
    expect(body.patch).not.toContain('a.txt')
  })
})
