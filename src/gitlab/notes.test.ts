import { describe, it, expect } from 'vitest'
import { buildThreads, type ApiDiscussion, type ApiDraftNote } from './notes'

const HEAD = 'h'.repeat(40)
const OLD = 'o'.repeat(40)

function position(head: string, oldLine: number | null, newLine: number | null) {
  return { head_sha: head, old_path: 'src/old.ts', new_path: 'src/a.ts', old_line: oldLine, new_line: newLine }
}

function note(id: number, body: string, extra: object = {}) {
  return { id, type: 'DiffNote', system: false, body, author: { name: `사람${id}` }, created_at: '2026-09-29T07:32:59.987Z', ...extra }
}

const discussions: ApiDiscussion[] = [
  { id: 'd1', notes: [note(1, '첫 코멘트', { position: position(HEAD, null, 19), resolved: false }), note(2, '답글'), note(3, '시스템', { system: true })] },
  { id: 'd2', notes: [note(4, '삭제 줄', { position: position(HEAD, 7, null), resolved: true })] },
  { id: 'd3', notes: [note(5, '이전 버전', { position: position(OLD, null, 3) })] },
  { id: 'd4', notes: [{ ...note(6, '일반 코멘트'), type: null }] },
]

const drafts: ApiDraftNote[] = [
  { id: 10, note: '새 초안', discussion_id: null, position: position(HEAD, 4, 5) },
  { id: 11, note: '답글 초안', discussion_id: 'd1', position: null },
  { id: 12, note: '사라진 discussion 답글', discussion_id: 'gone', position: null },
  { id: 13, note: '이전 버전 초안', discussion_id: null, position: position(OLD, null, 1) },
]

describe('buildThreads', () => {
  const result = buildThreads('mr:7', HEAD, discussions, drafts)

  it('converts current diff discussions with replies', () => {
    expect(result.comments[0]).toEqual({
      id: 'd1', key: 'mr:7', origin: 'gitlab', discussionId: 'd1', author: '사람1',
      filePath: 'src/a.ts', side: 'additions', lineNumber: 19, lineContent: '', body: '첫 코멘트',
      status: 'open', createdAt: Date.parse('2026-09-29T07:32:59.987Z'),
      replies: [
        { id: 'note:2', body: '답글', createdAt: Date.parse('2026-09-29T07:32:59.987Z'), author: '사람2' },
        { id: 'draft:11', body: '답글 초안', createdAt: 0, draft: true },
      ],
    })
  })

  it('uses the old path and deletions side for removed lines', () => {
    expect(result.comments[1]).toMatchObject({ id: 'd2', filePath: 'src/old.ts', side: 'deletions', lineNumber: 7, status: 'resolved' })
  })

  it('adds top-level drafts', () => {
    expect(result.comments[2]).toEqual({
      id: 'draft:10', key: 'mr:7', origin: 'draft', filePath: 'src/a.ts', side: 'additions', lineNumber: 5,
      lineContent: '', body: '새 초안', status: 'open', createdAt: 0, replies: [],
    })
    expect(result.comments).toHaveLength(3)
  })

  it('counts outdated discussions and drafts and all drafts', () => {
    expect(result.outdatedCount).toBe(2)
    expect(result.draftCount).toBe(4)
  })
})
