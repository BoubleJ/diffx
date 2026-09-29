import { describe, it, expect } from 'vitest'
import { buildPrompt, MAX_PATCH_CHARS } from './prompt'
import type { ReviewContext } from './types'

const base: ReviewContext = {
  repoPath: '/repo',
  mode: 'branch',
  source: 'feature/x',
  target: 'origin/main',
  mergeBase: 'abc123',
  sourceCheckedOut: true,
  files: ['src/a.ts', 'src/b.ts'],
  patch: 'diff --git a/src/a.ts b/src/a.ts\n+hello',
}

describe('buildPrompt', () => {
  it('includes comparison, files, patch, Korean and JSON instructions', () => {
    const p = buildPrompt(base)
    expect(p).toContain('origin/main...feature/x')
    expect(p).toContain('abc123')
    expect(p).toContain('- src/a.ts')
    expect(p).toContain('+hello')
    expect(p).toContain('한국어')
    expect(p).toContain('"findings"')
  })

  it('tells the reviewer to use git show when the source is not checked out', () => {
    const p = buildPrompt({ ...base, sourceCheckedOut: false })
    expect(p).toContain('git show feature/x:<경로>')
  })

  it('omits the patch body when it is too large', () => {
    const p = buildPrompt({ ...base, patch: 'x'.repeat(MAX_PATCH_CHARS + 1) })
    expect(p).not.toContain('x'.repeat(1000))
    expect(p).toContain('git diff abc123 feature/x -- <경로>')
  })

  it('describes worktree mode', () => {
    const p = buildPrompt({ ...base, mode: 'worktree', source: undefined, target: undefined, mergeBase: undefined })
    expect(p).toContain('커밋하지 않은 변경사항')
    expect(p).toContain('git diff HEAD -- <경로>')
  })
})
