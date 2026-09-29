import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { resolveComparison, resolveBranchRefs, createRangeDiffCache, comparisonKey, ComparisonError } from './comparison'

function setup() {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n' }, 'base')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  const feature = commit(repo, { 'a.txt': 'base\nfeature\n' }, 'feature')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'dirty\n')
  return { repo, base, feature }
}

describe('comparisonKey', () => {
  it('builds keys per mode', () => {
    expect(comparisonKey({ mode: 'worktree' })).toBe('worktree')
    expect(comparisonKey({ mode: 'branch', source: 'feature/x', target: 'origin/main' })).toBe('branch:origin/main...feature/x')
    expect(comparisonKey({ mode: 'custom', customArgs: ['HEAD~3'] })).toBe('custom:HEAD~3')
  })
})

describe('resolveComparison', () => {
  it('worktree mode returns uncommitted changes', () => {
    const { repo } = setup()
    const r = resolveComparison(repo, undefined, { mode: 'worktree' })
    expect(r.key).toBe('worktree')
    expect(r.patch).toContain('+dirty')
  })

  it('branch mode ignores the worktree and diffs merge-base..source', () => {
    const { repo, base, feature } = setup()
    const r = resolveComparison(repo, undefined, { mode: 'branch', source: 'feature/x', target: 'main' })
    expect(r.key).toBe('branch:main...feature/x')
    expect(r.patch).toContain('+feature')
    expect(r.patch).not.toContain('dirty')
    expect(r).toMatchObject({ sourceSha: feature, targetSha: base, mergeBase: base })
  })

  it('custom args override the query', () => {
    const { repo } = setup()
    const r = resolveComparison(repo, ['main', 'feature/x'], { mode: 'branch', source: 'x', target: 'y' })
    expect(r.mode).toBe('custom')
    expect(r.key).toBe('custom:main feature/x')
    expect(r.patch).toContain('+feature')
  })

  it('throws ComparisonError for unknown or missing refs', () => {
    const { repo } = setup()
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', source: 'nope', target: 'main' }))
      .toThrowError(expect.objectContaining({ code: 'unknown_ref' }))
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', target: 'main' }))
      .toThrowError(expect.objectContaining({ code: 'missing_ref' }))
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', source: '--output=/tmp/x', target: 'main' }))
      .toThrow(ComparisonError)
  })

  it('throws no_merge_base for unrelated histories', () => {
    const { repo } = setup()
    git(repo, 'stash', '-q')
    git(repo, 'switch', '-q', '--orphan', 'orphan')
    commit(repo, { 'b.txt': 'b\n' }, 'orphan')
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', source: 'orphan', target: 'main' }))
      .toThrowError(expect.objectContaining({ code: 'no_merge_base' }))
  })
})

describe('resolveBranchRefs', () => {
  it('resolves shas and merge-base without building a diff', () => {
    const { repo, base, feature } = setup()
    expect(resolveBranchRefs(repo, { source: 'feature/x', target: 'main' })).toEqual({ source: 'feature/x', target: 'main', sourceSha: feature, targetSha: base, mergeBase: base })
    expect(() => resolveBranchRefs(repo, { source: 'nope', target: 'main' })).toThrowError(expect.objectContaining({ code: 'unknown_ref' }))
  })
})

describe('createRangeDiffCache', () => {
  it('reuses the patch for the same repo and shas and evicts the oldest entry', () => {
    const calls: string[] = []
    const cached = createRangeDiffCache((repo, from, to) => {
      calls.push(`${repo}:${from}..${to}`)
      return `patch ${from}..${to}`
    }, 2)
    expect(cached('/r', 'a', 'b')).toBe('patch a..b')
    expect(cached('/r', 'a', 'b')).toBe('patch a..b')
    expect(calls).toEqual(['/r:a..b'])
    cached('/r', 'a', 'c')
    cached('/other', 'a', 'b')
    cached('/r', 'a', 'b')
    expect(calls).toEqual(['/r:a..b', '/r:a..c', '/other:a..b', '/r:a..b'])
  })

  it('is used by resolveComparison for branch mode', () => {
    const { repo, base, feature } = setup()
    const r = resolveComparison(repo, undefined, { mode: 'branch', source: 'feature/x', target: 'main' }, { rangeDiff: (_repo, from, to) => `${from}..${to}` })
    expect(r.patch).toBe(`${base}..${feature}`)
  })
})
