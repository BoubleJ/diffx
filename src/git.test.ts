import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import {
  getRepoRoot, getRepoName, getBranchName, getGitDiff, isGitRepo,
  listBranches, resolveCommit, getMergeBase, getRangeDiff, getFileAtCommit, fetchAll, getHeadSha, getUntrackedFilePaths,
} from './git'

describe('git functions take a repo path', () => {
  it('reads branch and diff of the given repo regardless of process.cwd()', () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'one\n' }, 'init')
    git(repo, 'switch', '-q', '-c', 'feature/x')
    writeFileSync(join(repo, 'a.txt'), 'two\n')

    expect(process.cwd()).not.toBe(repo)
    expect(isGitRepo(repo)).toBe(true)
    expect(getRepoRoot(join(repo))).toBe(repo)
    expect(getRepoName(repo)).toBe(repo.split('/').pop())
    expect(getBranchName(repo)).toBe('feature/x')
    expect(getGitDiff(repo)).toContain('+two')
  })
})

function repoWithBranches() {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n' }, 'base')
  git(repo, 'update-ref', 'refs/remotes/origin/main', base)
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  const feature = commit(repo, { 'a.txt': 'base\nfeature\n', 'img.png': 'PNGDATA' }, 'feature')
  git(repo, 'update-ref', 'refs/remotes/origin/feature/x', feature)
  return { repo, base, feature }
}

describe('listBranches', () => {
  it('lists local and remote branches without symbolic refs and finds the default target', () => {
    const { repo } = repoWithBranches()
    const list = listBranches(repo)
    expect(list.local).toEqual(['feature/x', 'main'])
    expect(list.remote).toEqual(['origin/feature/x', 'origin/main'])
    expect(list.current).toBe('feature/x')
    expect(list.defaultTarget).toBe('origin/main')
  })

  it('falls back to main when origin/HEAD is missing', () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'x\n' }, 'init')
    expect(listBranches(repo).defaultTarget).toBe('main')
  })
})

describe('resolveCommit', () => {
  it('resolves branch names to commit shas', () => {
    const { repo, feature } = repoWithBranches()
    expect(resolveCommit(repo, 'origin/feature/x')).toBe(feature)
  })

  it('rejects unknown refs and option-looking input', () => {
    const { repo } = repoWithBranches()
    expect(resolveCommit(repo, 'nope')).toBeNull()
    expect(resolveCommit(repo, '--output=/tmp/pwned')).toBeNull()
    expect(resolveCommit(repo, '')).toBeNull()
  })
})

describe('non-ASCII file names', () => {
  it('prints paths unquoted in diffs and untracked lists', () => {
    const repo = makeRepo()
    const base = commit(repo, { '한글 파일.txt': 'one\n' }, 'base')
    writeFileSync(join(repo, '한글 파일.txt'), 'one\ntwo\n')
    expect(getGitDiff(repo)).toContain('+++ b/한글 파일.txt')
    writeFileSync(join(repo, '새 파일.txt'), 'x\n')
    expect(getUntrackedFilePaths(repo)).toEqual(['새 파일.txt'])
    git(repo, 'add', '-A')
    const next = commit(repo, {}, 'next')
    expect(getRangeDiff(repo, base, next)).toContain('+++ b/한글 파일.txt')
  })
})

describe('getMergeBase and getRangeDiff', () => {
  it('produces the same diff as target...source', () => {
    const { repo, base, feature } = repoWithBranches()
    const mb = getMergeBase(repo, base, feature)
    expect(mb).toBe(base)
    const diff = getRangeDiff(repo, mb!, feature)
    expect(diff).toContain('+feature')
    expect(diff).toBe(git(repo, 'diff', '--no-ext-diff', '--no-color', 'main...feature/x'))
  })

  it('rejects option-looking shas', () => {
    const { repo, feature } = repoWithBranches()
    expect(getMergeBase(repo, '--foo', feature)).toBeNull()
    expect(() => getRangeDiff(repo, '--output=/tmp/x', feature)).toThrow('invalid commit sha')
  })

  it('returns null when histories are unrelated', () => {
    const { repo, feature } = repoWithBranches()
    git(repo, 'switch', '-q', '--orphan', 'orphan')
    const orphan = commit(repo, { 'b.txt': 'b\n' }, 'orphan')
    expect(getMergeBase(repo, orphan, feature)).toBeNull()
  })
})

describe('getFileAtCommit', () => {
  it('reads a file at a commit and refuses unsafe paths', () => {
    const { repo, feature } = repoWithBranches()
    expect(getFileAtCommit(repo, feature, 'img.png')?.toString()).toBe('PNGDATA')
    expect(getFileAtCommit(repo, feature, '../etc/passwd')).toBeNull()
    expect(getFileAtCommit(repo, feature, 'missing.txt')).toBeNull()
    expect(getFileAtCommit(repo, '--output=/tmp/x', 'img.png')).toBeNull()
    expect(getFileAtCommit(repo, feature, '')).toBeNull()
  })
})

describe('getHeadSha', () => {
  it('returns the checked out commit', () => {
    const { repo, feature } = repoWithBranches()
    expect(getHeadSha(repo)).toBe(feature)
  })
})

describe('fetchAll', () => {
  it('fetches from a local bare remote and prunes deleted branches', async () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-remote-')))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'a\n' }, 'init')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main', 'main:gone')
    git(repo, 'fetch', '-q', 'origin')
    git(remote, 'branch', '-D', 'gone')

    const result = await fetchAll(repo)
    expect(result).toEqual({ ok: true })
    expect(listBranches(repo).remote).toEqual(['origin/main'])
  })

  it('reports git errors without throwing', async () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'a\n' }, 'init')
    git(repo, 'remote', 'add', 'origin', '/nonexistent/diffx-remote')
    const result = await fetchAll(repo)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/nonexistent/)
  })
})
