import { getCustomGitDiff, getGitDiff, getMergeBase, getRangeDiff, resolveCommit } from './git.js'

export interface ComparisonQuery {
  mode?: string
  source?: string
  target?: string
  staged?: boolean
  untracked?: boolean
}

export interface ResolvedComparison {
  key: string
  mode: 'worktree' | 'branch' | 'custom'
  patch: string
  source?: string
  target?: string
  sourceSha?: string
  targetSha?: string
  mergeBase?: string
}

export class ComparisonError extends Error {
  constructor(public code: 'unknown_ref' | 'no_merge_base' | 'missing_ref', message: string) {
    super(message)
  }
}

export function comparisonKey(q: { mode: 'worktree' | 'branch' | 'custom'; source?: string; target?: string; customArgs?: string[] }): string {
  if (q.mode === 'custom') return `custom:${(q.customArgs ?? []).join(' ')}`
  if (q.mode === 'branch') return `branch:${q.target}...${q.source}`
  return 'worktree'
}

export function queryFromSearch(get: (name: string) => string | undefined): ComparisonQuery {
  return {
    mode: get('mode'),
    source: get('source'),
    target: get('target'),
    staged: get('staged') === 'true',
    untracked: get('untracked') === 'true',
  }
}

export type RangeDiff = (repo: string, fromSha: string, toSha: string) => string

// 같은 두 커밋 sha 사이의 diff는 바뀌지 않으므로 sha를 키로 저장해 두고 다시 쓴다.
export function createRangeDiffCache(diff: RangeDiff = getRangeDiff, max = 16): RangeDiff {
  const cache = new Map<string, string>()
  return (repo, fromSha, toSha) => {
    const key = `${repo}\0${fromSha}\0${toSha}`
    const hit = cache.get(key)
    if (hit !== undefined) {
      cache.delete(key)
      cache.set(key, hit)
      return hit
    }
    const patch = diff(repo, fromSha, toSha)
    cache.set(key, patch)
    if (cache.size > max) cache.delete(cache.keys().next().value!)
    return patch
  }
}

export interface BranchRefs {
  source: string
  target: string
  sourceSha: string
  targetSha: string
  mergeBase: string
}

export function resolveBranchRefs(repo: string, q: { source?: string; target?: string }): BranchRefs {
  if (!q.source || !q.target) {
    throw new ComparisonError('missing_ref', '소스 브랜치와 타겟 브랜치를 모두 선택해 주세요')
  }
  const sourceSha = resolveCommit(repo, q.source)
  if (!sourceSha) throw new ComparisonError('unknown_ref', `브랜치 ${q.source}을 찾지 못했습니다`)
  const targetSha = resolveCommit(repo, q.target)
  if (!targetSha) throw new ComparisonError('unknown_ref', `브랜치 ${q.target}을 찾지 못했습니다`)
  const mergeBase = getMergeBase(repo, targetSha, sourceSha)
  if (!mergeBase) throw new ComparisonError('no_merge_base', '두 브랜치의 공통 조상 커밋이 없습니다')
  return { source: q.source, target: q.target, sourceSha, targetSha, mergeBase }
}

export interface ResolveOptions {
  diffCwd?: string
  rangeDiff?: RangeDiff
}

export function resolveComparison(repo: string, customDiffArgs: string[] | undefined, q: ComparisonQuery, options: ResolveOptions = {}): ResolvedComparison {
  if (customDiffArgs) {
    return {
      key: comparisonKey({ mode: 'custom', customArgs: customDiffArgs }),
      mode: 'custom',
      patch: getCustomGitDiff(options.diffCwd ?? repo, customDiffArgs),
    }
  }

  if (q.mode !== 'branch') {
    return {
      key: comparisonKey({ mode: 'worktree' }),
      mode: 'worktree',
      patch: getGitDiff(repo, { staged: q.staged, untracked: q.untracked }),
    }
  }

  const refs = resolveBranchRefs(repo, q)
  const rangeDiff = options.rangeDiff ?? getRangeDiff
  return {
    key: comparisonKey({ mode: 'branch', source: refs.source, target: refs.target }),
    mode: 'branch',
    patch: rangeDiff(repo, refs.mergeBase, refs.sourceSha),
    ...refs,
  }
}
