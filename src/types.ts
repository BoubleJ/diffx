export interface CommentReply {
  id: string
  body: string
  createdAt: number
  author?: string
  draft?: boolean
}

export interface ReviewComment {
  id: string
  key: string
  origin: 'local' | 'draft' | 'gitlab'
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
  author?: string
  discussionId?: string
}
