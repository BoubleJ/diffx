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

export function resolveComparison(repo: string, customDiffArgs: string[] | undefined, q: ComparisonQuery, diffCwd = repo): ResolvedComparison {
  if (customDiffArgs) {
    return {
      key: comparisonKey({ mode: 'custom', customArgs: customDiffArgs }),
      mode: 'custom',
      patch: getCustomGitDiff(diffCwd, customDiffArgs),
    }
  }

  if (q.mode !== 'branch') {
    return {
      key: comparisonKey({ mode: 'worktree' }),
      mode: 'worktree',
      patch: getGitDiff(repo, { staged: q.staged, untracked: q.untracked }),
    }
  }

  if (!q.source || !q.target) {
    throw new ComparisonError('missing_ref', '소스 브랜치와 타겟 브랜치를 모두 선택해 주세요')
  }
  const sourceSha = resolveCommit(repo, q.source)
  if (!sourceSha) throw new ComparisonError('unknown_ref', `브랜치 ${q.source}을 찾지 못했습니다`)
  const targetSha = resolveCommit(repo, q.target)
  if (!targetSha) throw new ComparisonError('unknown_ref', `브랜치 ${q.target}을 찾지 못했습니다`)
  const mergeBase = getMergeBase(repo, targetSha, sourceSha)
  if (!mergeBase) throw new ComparisonError('no_merge_base', '두 브랜치의 공통 조상 커밋이 없습니다')

  return {
    key: comparisonKey({ mode: 'branch', source: q.source, target: q.target }),
    mode: 'branch',
    patch: getRangeDiff(repo, mergeBase, sourceSha),
    source: q.source,
    target: q.target,
    sourceSha,
    targetSha,
    mergeBase,
  }
}
