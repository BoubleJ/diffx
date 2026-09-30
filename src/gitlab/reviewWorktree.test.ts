import { describe, it, expect } from 'vitest'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, makeRepo } from '../test/gitRepo'
import { makeMrRepo, pushMrCommit } from '../test/mrRepo'
import { checkoutReviewWorktree, getReviewWorktree, listChangedFiles, removeReviewWorktree, reviewWorktreePath, WorktreeGitError } from './reviewWorktree'

function setup() {
  const repo = makeMrRepo()
  git(repo.local, 'fetch', '-q', 'origin', 'refs/merge-requests/7/head')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-worktrees-')))
  const addMr = (iid: number, files: Record<string, string>) => {
    const sha = pushMrCommit(repo.remote, iid, repo.base, files)
    git(repo.local, 'fetch', '-q', 'origin', `refs/merge-requests/${iid}/head`)
    return sha
  }
  const headOf = (dir: string) => git(dir, 'rev-parse', 'HEAD').trim()
  return { ...repo, root, addMr, headOf }
}

describe('reviewWorktreePath', () => {
  it('names the folder after the repo and a hash of its path', () => {
    const a = reviewWorktreePath('/wt', '/work/a/app')
    const b = reviewWorktreePath('/wt', '/work/b/app')
    expect(a).toMatch(/^\/wt\/app-[0-9a-f]{8}$/)
    expect(b).toMatch(/^\/wt\/app-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    expect(reviewWorktreePath('/wt', '/work/a/app')).toBe(a)
  })
})

describe('checkoutReviewWorktree', () => {
  it('reports no worktree before the first checkout', async () => {
    const { root, local } = setup()
    expect(await getReviewWorktree(root, local)).toEqual({ exists: false })
  })

  it('creates a detached worktree at the MR head', async () => {
    const { root, local, head, headOf } = setup()
    const result = await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    expect(result).toEqual({ kind: 'done', path, headSha: head, copiedEnvFiles: [] })
    expect(headOf(path)).toBe(head)
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('HEAD')
    expect(readFileSync(join(path, 'b.png'), 'utf-8')).toBe('NEWPNG')
    expect(await getReviewWorktree(root, local)).toEqual({ exists: true, path, headSha: head })
  })

  it('leaves the original repository untouched', async () => {
    const { root, local, head, headOf } = setup()
    const before = headOf(local)
    writeFileSync(join(local, 'a.txt'), 'mine\n')
    await checkoutReviewWorktree(root, local, head, { force: false })
    expect(headOf(local)).toBe(before)
    expect(git(local, 'branch', '--show-current').trim()).toBe('main')
    expect(git(local, 'branch', '--list').trim()).toBe('* main')
    expect(readFileSync(join(local, 'a.txt'), 'utf-8')).toBe('mine\n')
  })

  it('moves the same folder to another MR', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const result = await checkoutReviewWorktree(root, local, other, { force: false })
    const path = reviewWorktreePath(root, local)
    expect(result).toMatchObject({ kind: 'done', path, headSha: other })
    expect(headOf(path)).toBe(other)
    expect(existsSync(join(path, 'c.txt'))).toBe(true)
  })

  it('returns the changed files without switching', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { '문서 파일.txt': 'x\n' })
    await checkoutReviewWorktree(root, local, other, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, '문서 파일.txt'), 'edited\n')
    expect(await checkoutReviewWorktree(root, local, head, { force: false })).toEqual({ kind: 'dirty', files: ['문서 파일.txt'] })
    expect(headOf(path)).toBe(other)
  })

  it('discards tracked edits with force and keeps untracked files', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    writeFileSync(join(path, 'scratch.txt'), 'note\n')
    expect(await checkoutReviewWorktree(root, local, other, { force: true })).toMatchObject({ kind: 'done', headSha: other })
    expect(headOf(path)).toBe(other)
    expect(readFileSync(join(path, 'a.txt'), 'utf-8')).toBe('one\ntwo\nthree\n')
    expect(readFileSync(join(path, 'scratch.txt'), 'utf-8')).toBe('note\n')
  })

  it('does not treat untracked files as changes', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, 'scratch.txt'), 'note\n')
    expect(await checkoutReviewWorktree(root, local, other, { force: false })).toMatchObject({ kind: 'done', headSha: other })
    expect(headOf(path)).toBe(other)
  })

  it('recreates the worktree after the folder was deleted by hand', async () => {
    const { root, local, head, headOf } = setup()
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    rmSync(path, { recursive: true, force: true })
    expect(await getReviewWorktree(root, local)).toEqual({ exists: false })
    expect(await checkoutReviewWorktree(root, local, head, { force: false })).toMatchObject({ kind: 'done', headSha: head })
    expect(headOf(path)).toBe(head)
  })

  it('rejects values that are not commit shas', async () => {
    const { root, local } = setup()
    await expect(checkoutReviewWorktree(root, local, '--help', { force: false })).rejects.toBeInstanceOf(WorktreeGitError)
  })
})

describe('env files', () => {
  function setupEnv() {
    const ctx = setup()
    appendFileSync(join(ctx.local, '.git', 'info', 'exclude'), '.env*\nnode_modules/\n')
    writeFileSync(join(ctx.local, '.env.local'), 'A=1\n')
    mkdirSync(join(ctx.local, 'apps', 'web'), { recursive: true })
    writeFileSync(join(ctx.local, 'apps', 'web', '.env'), 'B=2\n')
    mkdirSync(join(ctx.local, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(ctx.local, 'node_modules', 'pkg', '.env'), 'C=3\n')
    return ctx
  }

  it('copies ignored env files outside ignored folders', async () => {
    const { root, local, head } = setupEnv()
    const result = await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    expect(result.kind === 'done' && [...result.copiedEnvFiles].sort()).toEqual(['.env.local', 'apps/web/.env'])
    expect(readFileSync(join(path, '.env.local'), 'utf-8')).toBe('A=1\n')
    expect(readFileSync(join(path, 'apps', 'web', '.env'), 'utf-8')).toBe('B=2\n')
    expect(existsSync(join(path, 'node_modules'))).toBe(false)
  })

  it('does not overwrite env files already in the worktree', async () => {
    const { root, local, head, addMr } = setupEnv()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, '.env.local'), 'A=mine\n')
    const result = await checkoutReviewWorktree(root, local, other, { force: false })
    expect(result).toMatchObject({ kind: 'done', copiedEnvFiles: [] })
    expect(readFileSync(join(path, '.env.local'), 'utf-8')).toBe('A=mine\n')
  })
})

describe('listChangedFiles', () => {
  it('lists edited tracked files and returns nothing without a worktree', async () => {
    const { root, local, head } = setup()
    expect(await listChangedFiles(root, local)).toEqual([])
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    writeFileSync(join(path, 'scratch.txt'), 'note\n')
    expect(await listChangedFiles(root, local)).toEqual(['a.txt'])
  })
})

describe('removeReviewWorktree', () => {
  const registered = (local: string, path: string) => git(local, 'worktree', 'list', '--porcelain').includes(path)

  it('removes a worktree that has ignored and untracked folders', async () => {
    const { root, local, head } = setup()
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    mkdirSync(join(path, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(path, 'node_modules', 'pkg', 'index.js'), '\n')
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    await removeReviewWorktree(root, local)
    expect(existsSync(path)).toBe(false)
    expect(registered(local, path)).toBe(false)
    expect(await getReviewWorktree(root, local)).toEqual({ exists: false })
  })

  it('clears the registration when the folder was deleted by hand', async () => {
    const { root, local, head } = setup()
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    rmSync(path, { recursive: true, force: true })
    await removeReviewWorktree(root, local)
    expect(registered(local, path)).toBe(false)
  })

  it('does nothing when there is no worktree', async () => {
    const { root, local } = setup()
    await expect(removeReviewWorktree(root, local)).resolves.toBeUndefined()
  })
})

describe('a folder that is not a worktree', () => {
  function breakWorktree(root: string, local: string) {
    const path = reviewWorktreePath(root, local)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'leftover.txt'), 'x\n')
    return path
  }

  it('reports the folder without a HEAD and lists no changes', async () => {
    const { root, local } = setup()
    const path = breakWorktree(root, local)
    expect(await getReviewWorktree(root, local)).toEqual({ exists: true, path, headSha: null })
    expect(await listChangedFiles(root, local)).toEqual([])
  })

  it('does not read a parent repository as the worktree', async () => {
    const { local } = setup()
    const root = makeRepo()
    const path = breakWorktree(root, local)
    expect(await getReviewWorktree(root, local)).toEqual({ exists: true, path, headSha: null })
  })

  it('asks to delete it before checking out, and deletes it', async () => {
    const { root, local, head, headOf } = setup()
    const path = breakWorktree(root, local)
    await expect(checkoutReviewWorktree(root, local, head, { force: true })).rejects.toThrow('worktree 삭제 후 다시 체크아웃해 주세요')
    await removeReviewWorktree(root, local)
    expect(existsSync(path)).toBe(false)
    await checkoutReviewWorktree(root, local, head, { force: false })
    expect(headOf(path)).toBe(head)
  })
})
