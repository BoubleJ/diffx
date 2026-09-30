import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildReviewPrompt, MAX_PATCH_CHARS } from './prompt'
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

describe('buildSystemPrompt', () => {
  it('includes the comparison and the five rules without the diff', () => {
    const p = buildSystemPrompt(base)
    expect(p).toContain('origin/main...feature/x')
    expect(p).toContain('소스 브랜치: feature/x')
    expect(p).toContain('타겟 브랜치: origin/main')
    expect(p).toContain('merge-base 커밋: abc123')
    expect(p).toContain('파일을 수정하지 마세요')
    expect(p).toContain('git show, git log, git diff')
    expect(p).toContain('한국어')
    expect(p).toContain('locations')
    expect(p).toContain('리뷰를 요청하지 않았으면 리뷰하지 마세요')
    expect(p).not.toContain('+hello')
    expect(p).not.toContain('src/b.ts')
    expect(p).not.toContain('시니어 코드 리뷰어')
  })

  it('tells Claude to use git show when the source is not checked out', () => {
    expect(buildSystemPrompt({ ...base, sourceCheckedOut: false })).toContain('git show feature/x:<경로>')
    expect(buildSystemPrompt(base)).toContain('작업 트리의 파일이 리뷰 대상 코드와 같습니다')
  })
})

describe('buildReviewPrompt', () => {
  it('includes the review instruction, files and patch', () => {
    const p = buildReviewPrompt(base)
    expect(p).toContain('버그, 보안 문제')
    expect(p).toContain('머지 전에 확인할 점')
    expect(p).toContain('- src/a.ts')
    expect(p).toContain('+hello')
    expect(p).toContain('git diff abc123 feature/x -- <경로>')
    expect(p).not.toContain('시니어 코드 리뷰어')
    expect(p).not.toContain('```json')
  })

  it('omits the patch body when it is too large', () => {
    const p = buildReviewPrompt({ ...base, patch: 'x'.repeat(MAX_PATCH_CHARS + 1) })
    expect(p).not.toContain('x'.repeat(1000))
    expect(p).toContain('diff가 커서 본문을 싣지 않았습니다')
  })
})
