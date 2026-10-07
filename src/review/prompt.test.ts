import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildReviewPrompt, buildQuestionPrompt, MAX_PATCH_CHARS, NO_LOCATIONS } from './prompt'
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
    expect(p).toContain('git show, git log, git diff, git grep, git ls-tree')
    expect(p).toContain('cd, git -C, 변수 대입')
    expect(p).toContain('한국어')
    expect(p).toContain('locations')
    expect(p).toContain('리뷰를 요청하지 않았으면 리뷰하지 마세요')
    expect(p).not.toContain('+hello')
    expect(p).not.toContain('src/b.ts')
    expect(p).not.toContain('시니어 코드 리뷰어')
  })

  it('tells Claude to use git show when the source is not checked out', () => {
    const notCheckedOut = buildSystemPrompt({ ...base, sourceCheckedOut: false })
    expect(notCheckedOut).toContain('git show feature/x:<경로>')
    expect(notCheckedOut).toContain('git ls-tree -r --name-only feature/x')
    expect(notCheckedOut).toContain('git grep -n <패턴> feature/x')
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

describe('buildQuestionPrompt', () => {
  const selection = { path: 'src/cart.ts', side: 'additions' as const, startLine: 12, endLine: 13, code: 'const total = 1\nreturn total' }

  it('returns the question as it is without a selection', () => {
    expect(buildQuestionPrompt('왜 이렇게 했어?')).toBe('왜 이렇게 했어?')
  })

  it('puts the selected code and its location before the question', () => {
    expect(buildQuestionPrompt('성능 괜찮아?', selection)).toBe(
      '사용자가 diff에서 선택한 코드: src/cart.ts 12-13줄 (변경 후 코드)\n```\nconst total = 1\nreturn total\n```\n\n질문: 성능 괜찮아?',
    )
  })

  it('writes a single line and the deletions side', () => {
    expect(buildQuestionPrompt('왜 지웠어?', { ...selection, side: 'deletions', endLine: 12, code: 'old()' })).toBe(
      '사용자가 diff에서 선택한 코드: src/cart.ts 12줄 (변경 전 코드)\n```\nold()\n```\n\n질문: 왜 지웠어?',
    )
  })

  it('asks for no locations when they are turned off', () => {
    expect(buildQuestionPrompt('왜 이렇게 했어?', undefined, false)).toBe(`왜 이렇게 했어?\n\n${NO_LOCATIONS}`)
    expect(buildQuestionPrompt('성능 괜찮아?', selection, false).endsWith(`질문: 성능 괜찮아?\n\n${NO_LOCATIONS}`)).toBe(true)
  })

  it('lengthens the fence when the code contains backticks', () => {
    const prompt = buildQuestionPrompt('설명해줘', { ...selection, code: 'const md = "```ts"' })
    expect(prompt).toContain('\n````\nconst md = "```ts"\n````\n')
  })
})
