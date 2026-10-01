import { describe, it, expect } from 'vitest'
import { comparisonParams, loadComparison, saveComparison, reconcileComparison, comparisonForMode, comparisonFromKey } from './comparison'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

const branches = { local: ['feature/x', 'main'], remote: ['origin/main'], current: 'feature/x', defaultTarget: 'origin/main' }

describe('comparisonParams', () => {
  it('builds branch params', () => {
    expect(comparisonParams({ mode: 'branch', source: 'feature/x', target: 'origin/main' })?.toString())
      .toBe('mode=branch&source=feature%2Fx&target=origin%2Fmain')
  })
})

describe('load/saveComparison', () => {
  it('stores per repo root', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'branch', source: 'x', target: 'y' }, s)
    expect(loadComparison('/repo/a', s)).toEqual({ mode: 'branch', source: 'x', target: 'y' })
    expect(loadComparison('/repo/b', s)).toBeNull()
  })

  it('ignores a saved worktree comparison', () => {
    const s = memoryStorage()
    s.setItem('diffx-comparison:/repo/a', JSON.stringify({ mode: 'worktree' }))
    expect(loadComparison('/repo/a', s)).toBeNull()
  })

  it('ignores broken values', () => {
    const s = memoryStorage()
    s.setItem('diffx-comparison:/repo/a', '{bad json')
    expect(loadComparison('/repo/a', s)).toBeNull()
  })
})

describe('reconcileComparison', () => {
  it('defaults to the branch comparison when nothing is saved', () => {
    expect(reconcileComparison(null, branches)).toEqual({ comparison: { mode: 'branch', source: 'feature/x', target: 'origin/main' }, missing: [] })
  })

  it('keeps saved branches that still exist', () => {
    const saved = { mode: 'branch' as const, source: 'main', target: 'origin/main' }
    expect(reconcileComparison(saved, branches)).toEqual({ comparison: saved, missing: [] })
  })

  it('replaces missing branches with defaults and reports them', () => {
    const saved = { mode: 'branch' as const, source: 'deleted', target: 'origin/gone' }
    expect(reconcileComparison(saved, branches)).toEqual({
      comparison: { mode: 'branch', source: 'feature/x', target: 'origin/main' },
      missing: ['deleted', 'origin/gone'],
    })
  })
})

describe('mr comparison', () => {
  it('builds params only when an MR is selected', () => {
    expect(comparisonParams({ mode: 'mr', iid: 7 })?.toString()).toBe('mode=mr&iid=7')
    expect(comparisonParams({ mode: 'mr', iid: null })).toBeNull()
  })

  it('saves and loads the selected MR', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'mr', iid: 7 }, s)
    expect(loadComparison('/repo/a', s)).toEqual({ mode: 'mr', iid: 7 })
    s.setItem('diffx-comparison:/repo/a', JSON.stringify({ mode: 'mr', iid: 'x' }))
    expect(loadComparison('/repo/a', s)).toEqual({ mode: 'mr', iid: null })
  })

  it('keeps a saved MR during branch reconciliation', () => {
    expect(reconcileComparison({ mode: 'mr', iid: 7 }, branches)).toEqual({ comparison: { mode: 'mr', iid: 7 }, missing: [] })
  })
})

describe('comparisonForMode', () => {
  it('returns the last MR after visiting the branch tab', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'mr', iid: 100 }, s)
    saveComparison('/repo/a', { mode: 'branch', source: 'main', target: 'origin/main' }, s)
    expect(comparisonForMode('/repo/a', 'mr', branches, s)).toEqual({ comparison: { mode: 'mr', iid: 100 }, missing: [] })
  })

  it('returns the last branch pair after visiting the MR tab', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'branch', source: 'main', target: 'origin/main' }, s)
    saveComparison('/repo/a', { mode: 'mr', iid: 100 }, s)
    expect(comparisonForMode('/repo/a', 'branch', branches, s)).toEqual({ comparison: { mode: 'branch', source: 'main', target: 'origin/main' }, missing: [] })
  })

  it('falls back to defaults when nothing was chosen in that mode', () => {
    const s = memoryStorage()
    expect(comparisonForMode('/repo/a', 'mr', branches, s)).toEqual({ comparison: { mode: 'mr', iid: null }, missing: [] })
    expect(comparisonForMode('/repo/a', 'branch', branches, s)).toEqual({ comparison: { mode: 'branch', source: 'feature/x', target: 'origin/main' }, missing: [] })
  })

  it('replaces a remembered branch that no longer exists', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'branch', source: 'gone', target: 'main' }, s)
    expect(comparisonForMode('/repo/a', 'branch', branches, s)).toEqual({ comparison: { mode: 'branch', source: 'feature/x', target: 'main' }, missing: ['gone'] })
  })

  it('cannot open the branch tab without a branch list', () => {
    expect(comparisonForMode('/repo/a', 'branch', undefined, memoryStorage())).toBeNull()
  })
})

describe('comparisonFromKey', () => {
  it('parses branch and MR keys', () => {
    expect(comparisonFromKey('branch:develop...feature/login')).toEqual({ mode: 'branch', source: 'feature/login', target: 'develop' })
    expect(comparisonFromKey('branch:origin/main...feature/a/b')).toEqual({ mode: 'branch', source: 'feature/a/b', target: 'origin/main' })
    expect(comparisonFromKey('mr:128')).toEqual({ mode: 'mr', iid: 128 })
  })

  it('returns null for malformed keys', () => {
    expect(comparisonFromKey('branch:develop')).toBeNull()
    expect(comparisonFromKey('branch:...feature')).toBeNull()
    expect(comparisonFromKey('mr:0')).toBeNull()
    expect(comparisonFromKey('mr:abc')).toBeNull()
    expect(comparisonFromKey('worktree')).toBeNull()
  })
})
