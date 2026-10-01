export type Comparison =
  | { mode: 'branch'; source: string; target: string }
  | { mode: 'mr'; iid: number | null }

export interface BranchInfo {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

const STORAGE_PREFIX = 'diffx-comparison:'

export function comparisonParams(c: Comparison): URLSearchParams | null {
  if (c.mode === 'mr') return c.iid === null ? null : new URLSearchParams({ mode: 'mr', iid: String(c.iid) })
  return new URLSearchParams({ mode: 'branch', source: c.source, target: c.target })
}

function readComparison(storageKey: string, storage: Pick<Storage, 'getItem'>): Comparison | null {
  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.mode === 'mr') {
      return { mode: 'mr', iid: Number.isInteger(parsed.iid) && parsed.iid > 0 ? parsed.iid : null }
    }
    if (parsed?.mode === 'branch' && typeof parsed.source === 'string' && typeof parsed.target === 'string') {
      return { mode: 'branch', source: parsed.source, target: parsed.target }
    }
  } catch {}
  return null
}

export function loadComparison(repoRoot: string, storage: Pick<Storage, 'getItem'> = localStorage): Comparison | null {
  return readComparison(STORAGE_PREFIX + repoRoot, storage)
}

export function saveComparison(repoRoot: string, c: Comparison, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify(c))
    storage.setItem(`${STORAGE_PREFIX}${repoRoot}:${c.mode}`, JSON.stringify(c))
  } catch {}
}

export function comparisonForMode(
  repoRoot: string,
  mode: Comparison['mode'],
  branches: BranchInfo | undefined,
  storage: Pick<Storage, 'getItem'> = localStorage,
): { comparison: Comparison; missing: string[] } | null {
  const last = readComparison(`${STORAGE_PREFIX}${repoRoot}:${mode}`, storage)
  if (mode === 'mr') return { comparison: last?.mode === 'mr' ? last : { mode: 'mr', iid: null }, missing: [] }
  if (!branches) return null
  return reconcileComparison(last?.mode === 'branch' ? last : null, branches)
}

export function defaultBranchComparison(branches: BranchInfo): Extract<Comparison, { mode: 'branch' }> {
  const source = branches.current && branches.current !== 'HEAD' ? branches.current : branches.local[0] ?? ''
  const target = branches.defaultTarget ?? branches.local.find((b) => b !== source) ?? source
  return { mode: 'branch', source, target }
}

export function reconcileComparison(saved: Comparison | null, branches: BranchInfo): { comparison: Comparison; missing: string[] } {
  if (!saved) return { comparison: defaultBranchComparison(branches), missing: [] }
  if (saved.mode === 'mr') return { comparison: saved, missing: [] }
  const all = new Set([...branches.local, ...branches.remote])
  const missing = [saved.source, saved.target].filter((b) => !all.has(b))
  if (missing.length === 0) return { comparison: saved, missing }
  const fallback = defaultBranchComparison(branches)
  return {
    comparison: {
      mode: 'branch',
      source: all.has(saved.source) ? saved.source : fallback.source,
      target: all.has(saved.target) ? saved.target : fallback.target,
    },
    missing,
  }
}

export function comparisonFromKey(key: string): Comparison | null {
  if (key.startsWith('branch:')) {
    const rest = key.slice('branch:'.length)
    const at = rest.indexOf('...')
    if (at < 0) return null
    const target = rest.slice(0, at)
    const source = rest.slice(at + 3)
    return target && source ? { mode: 'branch', source, target } : null
  }
  if (key.startsWith('mr:')) {
    const rest = key.slice('mr:'.length)
    return /^[1-9]\d*$/.test(rest) ? { mode: 'mr', iid: Number(rest) } : null
  }
  return null
}
