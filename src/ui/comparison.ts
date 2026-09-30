export type Comparison =
  | { mode: 'worktree' }
  | { mode: 'branch'; source: string; target: string }
  | { mode: 'mr'; iid: number | null }

interface BranchInfo {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

const STORAGE_PREFIX = 'diffx-comparison:'

export function comparisonParams(c: Comparison, opts: { staged: boolean; untracked: boolean }): URLSearchParams | null {
  if (c.mode === 'mr') return c.iid === null ? null : new URLSearchParams({ mode: 'mr', iid: String(c.iid) })
  if (c.mode === 'branch') {
    return new URLSearchParams({ mode: 'branch', source: c.source, target: c.target })
  }
  return new URLSearchParams({ mode: 'worktree', staged: String(opts.staged), untracked: String(opts.untracked) })
}

export function loadComparison(repoRoot: string, storage: Pick<Storage, 'getItem'> = localStorage): Comparison | null {
  try {
    const raw = storage.getItem(STORAGE_PREFIX + repoRoot)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.mode === 'worktree') return { mode: 'worktree' }
    if (parsed?.mode === 'mr') {
      return { mode: 'mr', iid: Number.isInteger(parsed.iid) && parsed.iid > 0 ? parsed.iid : null }
    }
    if (parsed?.mode === 'branch' && typeof parsed.source === 'string' && typeof parsed.target === 'string') {
      return { mode: 'branch', source: parsed.source, target: parsed.target }
    }
  } catch {}
  return null
}

export function saveComparison(repoRoot: string, c: Comparison, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify(c))
  } catch {}
}

export function defaultBranchComparison(branches: BranchInfo): Comparison {
  const source = branches.current && branches.current !== 'HEAD' ? branches.current : branches.local[0] ?? ''
  const target = branches.defaultTarget ?? branches.local.find((b) => b !== source) ?? source
  return { mode: 'branch', source, target }
}

export function reconcileComparison(saved: Comparison | null, branches: BranchInfo): { comparison: Comparison; missing: string[] } {
  if (!saved || saved.mode === 'worktree') return { comparison: { mode: 'worktree' }, missing: [] }
  if (saved.mode === 'mr') return { comparison: saved, missing: [] }
  const all = new Set([...branches.local, ...branches.remote])
  const missing = [saved.source, saved.target].filter((b) => !all.has(b))
  if (missing.length === 0) return { comparison: saved, missing }
  const fallback = defaultBranchComparison(branches) as { mode: 'branch'; source: string; target: string }
  return {
    comparison: {
      mode: 'branch',
      source: all.has(saved.source) ? saved.source : fallback.source,
      target: all.has(saved.target) ? saved.target : fallback.target,
    },
    missing,
  }
}
