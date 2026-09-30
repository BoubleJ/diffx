import { describe, it, expect } from 'vitest'
import { formatComments } from './hooks/useComments'
import type { ReviewComment } from '../types'

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: '1', key: 'k', origin: 'local', filePath: 'a.ts', side: 'additions', lineNumber: 3,
  lineContent: 'x', body: '확인', status: 'open', createdAt: 0, replies: [], ...over,
})

describe('formatComments', () => {
  it('returns an empty string without comments', () => {
    expect(formatComments([])).toBe('')
  })

  it('groups comments by file', () => {
    expect(formatComments([comment({}), comment({ id: '2', side: 'deletions', lineNumber: 1, lineContent: 'y', body: '삭제' })])).toBe([
      '<code-review-comments>',
      '<file path="a.ts">',
      '<comment line="3">',
      '<code>+ x</code>',
      '확인',
      '</comment>',
      '<comment line="1">',
      '<code>- y</code>',
      '삭제',
      '</comment>',
      '</file>',
      '</code-review-comments>',
    ].join('\n'))
  })
})
