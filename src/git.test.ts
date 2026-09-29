import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { getRepoRoot, getRepoName, getBranchName, getGitDiff, isGitRepo } from './git'

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
