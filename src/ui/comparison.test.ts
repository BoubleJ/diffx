import { describe, it, expect } from 'vitest'
import { comparisonParams, loadComparison, saveComparison, reconcileComparison } from './comparison'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

const branches = { local: ['feature/x', 'main'], remote: ['origin/main'], current: 'feature/x', defaultTarget: 'origin/main' }

describe('comparisonParams', () => {
  it('builds worktree and branch params', () => {
    expect(comparisonParams({ mode: 'worktree' }, { staged: true, untracked: false }).toString())
      .toBe('mode=worktree&staged=true&untracked=false')
    expect(comparisonParams({ mode: 'branch', source: 'feature/x', target: 'origin/main' }, { staged: true, untracked: true }).toString())
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

  it('ignores broken values', () => {
    const s = memoryStorage()
    s.setItem('diffx-comparison:/repo/a', '{bad json')
    expect(loadComparison('/repo/a', s)).toBeNull()
  })
})

describe('reconcileComparison', () => {
  it('defaults to worktree when nothing is saved', () => {
    expect(reconcileComparison(null, branches)).toEqual({ comparison: { mode: 'worktree' }, missing: [] })
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
