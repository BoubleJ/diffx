import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../test/gitRepo'
import { makeMrRepo, pushMrCommit } from '../test/mrRepo'
import { checkoutReviewWorktree, getReviewWorktree, reviewWorktreePath, WorktreeGitError } from './reviewWorktree'

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
