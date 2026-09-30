import type { ReviewComment } from '../types.js'

interface ApiPosition {
  head_sha: string
  old_path: string
  new_path: string
  old_line: number | null
  new_line: number | null
}

export interface ApiNote {
  id: number
  type: string | null
  system: boolean
  body: string
  author: { name: string }
  created_at: string
  resolved?: boolean
  position?: ApiPosition
}

export interface ApiDiscussion {
  id: string
  notes: ApiNote[]
}

export interface ApiDraftNote {
  id: number
  note: string
  discussion_id: string | null
  position: ApiPosition | null
}

export interface MrThreads {
  comments: ReviewComment[]
  outdatedCount: number
  draftCount: number
}

function lineOf(position: ApiPosition | null | undefined) {
  if (!position) return null
  if (position.new_line != null) return { filePath: position.new_path, side: 'additions' as const, lineNumber: position.new_line }
  if (position.old_line != null) return { filePath: position.old_path, side: 'deletions' as const, lineNumber: position.old_line }
  return null
}

export function buildThreads(key: string, headSha: string, discussions: ApiDiscussion[], drafts: ApiDraftNote[]): MrThreads {
  const comments: ReviewComment[] = []
  const byDiscussion = new Map<string, ReviewComment>()
  let outdatedCount = 0

  for (const discussion of discussions) {
    const first = discussion.notes[0]
    if (!first || first.type !== 'DiffNote') continue
    const line = lineOf(first.position)
    if (!line) continue
    if (first.position!.head_sha !== headSha) {
      outdatedCount++
      continue
    }
    const comment: ReviewComment = {
      id: discussion.id,
      key,
      origin: 'gitlab',
      discussionId: discussion.id,
      author: first.author.name,
      ...line,
      lineContent: '',
      body: first.body,
      status: first.resolved ? 'resolved' : 'open',
      createdAt: Date.parse(first.created_at),
      replies: discussion.notes
        .slice(1)
        .filter((n) => !n.system)
        .map((n) => ({ id: `note:${n.id}`, body: n.body, createdAt: Date.parse(n.created_at), author: n.author.name })),
    }
    comments.push(comment)
    byDiscussion.set(discussion.id, comment)
  }

  for (const draft of drafts) {
    if (draft.discussion_id) {
      byDiscussion.get(draft.discussion_id)?.replies.push({ id: `draft:${draft.id}`, body: draft.note, createdAt: 0, draft: true })
      continue
    }
    const line = lineOf(draft.position)
    if (!line) continue
    if (draft.position!.head_sha !== headSha) {
      outdatedCount++
      continue
    }
    comments.push({
      id: `draft:${draft.id}`,
      key,
      origin: 'draft',
      ...line,
      lineContent: '',
      body: draft.note,
      status: 'open',
      createdAt: 0,
      replies: [],
    })
  }

  return { comments, outdatedCount, draftCount: drafts.length }
}
