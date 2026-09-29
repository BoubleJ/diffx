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

  it('describes worktree mode without staged changes', () => {
    const p = buildPrompt({ ...base, mode: 'worktree', source: undefined, target: undefined, mergeBase: undefined })
    expect(p).toContain('커밋하지 않은 변경사항')
    expect(p).toContain('`git diff -- <경로>`')
    expect(p).not.toContain('git diff HEAD')
    expect(p).toContain('작업 트리의 파일이 리뷰 대상 코드와 같습니다')
  })

  it('includes staged changes in the worktree diff command when staged is on', () => {
    const p = buildPrompt({ ...base, mode: 'worktree', staged: true, source: undefined, target: undefined, mergeBase: undefined })
    expect(p).toContain('`git diff HEAD -- <경로>`')
  })

  it('uses the custom git diff args and does not claim the worktree matches', () => {
    const p = buildPrompt({ ...base, mode: 'custom', customArgs: ['HEAD~3'], source: undefined, target: undefined, mergeBase: undefined })
    expect(p).toContain('`git diff HEAD~3 -- <경로>`')
    expect(p).toContain('HEAD~3')
    expect(p).not.toContain('작업 트리의 파일이 리뷰 대상 코드와 같습니다')
    expect(p).not.toContain('git diff HEAD --')
  })

  it('drops the pathspec from custom args before adding the file path', () => {
    const p = buildPrompt({ ...base, mode: 'custom', customArgs: ['main', '--', 'src'], source: undefined, target: undefined, mergeBase: undefined })
    expect(p).toContain('`git diff main -- <경로>`')
  })
})
