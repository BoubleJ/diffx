import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo } from '../utils'
import { CommentForm } from './CommentForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onReply?: (discussionId: string, body: string) => Promise<void>
}

export function CommentBubble({ comment, onDelete, onReply }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const isResolved = comment.status === 'resolved'
  const canDelete = comment.origin !== 'gitlab' && !isResolved

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const submitReply = async (body: string) => {
    try {
      await onReply!(comment.discussionId!, body)
      setReplying(false)
      setReplyError(null)
    } catch (err) {
      setReplyError((err as Error).message)
    }
  }

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        {comment.author && <span className="comment-bubble-author">{comment.author}</span>}
        {comment.origin === 'draft'
          ? <span className="comment-badge-draft">초안</span>
          : <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>}
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
        )}
        {canDelete && (
          <button className="comment-bubble-delete" onClick={() => onDelete(comment.id)} title="Delete comment">
            &times;
          </button>
        )}
      </div>
      <div className="comment-bubble-body">{comment.body}</div>
      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="comment-reply">
              <div className="comment-reply-header">
                {reply.author
                  ? <span className="comment-bubble-author">{reply.author}</span>
                  : !reply.draft && <Bot size={16} className="comment-reply-avatar" />}
                {reply.draft
                  ? <span className="comment-badge-draft">초안</span>
                  : <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>}
                {reply.draft && (
                  <button className="comment-bubble-delete" onClick={() => onDelete(reply.id)} title="초안 삭제">
                    &times;
                  </button>
                )}
              </div>
              <div className="comment-reply-body">{reply.body}</div>
            </div>
          ))}
        </div>
      )}
      {comment.origin === 'gitlab' && onReply && comment.discussionId && (
        replying ? (
          <CommentForm
            placeholder="답글 작성"
            error={replyError}
            onSubmit={submitReply}
            onCancel={() => {
              setReplying(false)
              setReplyError(null)
            }}
          />
        ) : (
          <button className="btn btn-sm comment-reply-button" onClick={() => setReplying(true)}>
            답글
          </button>
        )
      )}
    </div>
  )
}
