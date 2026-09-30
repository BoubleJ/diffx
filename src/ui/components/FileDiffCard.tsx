import { useState, useEffect, useRef, memo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { ExcludeButton } from './ExcludeButton'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'
import { findLineElement } from '../findLine'
import { isSourceFile } from '../../definition/sourceFiles'
import type { DefinitionRequest } from '../definition'
import { tokenLinkHover } from '../tokenLinkHover'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  softWrap: boolean
  viewed: boolean
  onViewedChange: (filePath: string, viewed: boolean) => void
  onExclude: (filePath: string) => void
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void | Promise<void>
  onReplyComment?: (discussionId: string, body: string) => Promise<void>
  onDeleteComment: (id: string) => void
  highlightLine: { side: 'additions' | 'deletions'; line: number } | null
  onDefinition?: (req: DefinitionRequest, anchor: DOMRect) => void
  onHighlightMissing?: (filePath: string, line: number, side: 'additions' | 'deletions') => void
}

function scrollToEstimatedLine(card: HTMLElement, line: number, total: number): void {
  const scroller = card.closest('.main-scroll')
  if (!scroller || total === 0) return
  const cardRect = card.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  scroller.scrollTop += cardRect.top - scrollerRect.top + (cardRect.height * (line - 1)) / total - scrollerRect.height / 2
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  tabSize,
  softWrap,
  viewed,
  onViewedChange,
  onExclude,
  onAddComment,
  onDeleteComment,
  onReplyComment,
  highlightLine,
  onDefinition,
  onHighlightMissing,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!highlightLine) return
    let frames = 0
    let handle = 0
    let nudged = false
    const tryScroll = () => {
      const card = cardRef.current
      const target = card && findLineElement(card, highlightLine.line, highlightLine.side)
      if (target) {
        target.scrollIntoView({ block: 'center' })
        return
      }
      if (!nudged && frames >= 5 && card && !fileDiff.isPartial) {
        nudged = true
        const total = highlightLine.side === 'additions' ? fileDiff.additionLines.length : fileDiff.deletionLines.length
        scrollToEstimatedLine(card, highlightLine.line, total)
      }
      if (frames++ < 60) handle = requestAnimationFrame(tryScroll)
      else onHighlightMissing?.(filePath, highlightLine.line, highlightLine.side)
    }
    handle = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(handle)
  }, [highlightLine])

  const getLineContent = (side: AnnotationSide, lineNumber: number): string => {
    const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
    // Full (non-partial) diffs carry the entire file, so any line — including
    // expanded context outside hunks — can be addressed directly.
    if (!fileDiff.isPartial) {
      return lines[lineNumber - 1] ?? ''
    }
    const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
    const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
    const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
    for (const hunk of fileDiff.hunks) {
      const start = hunk[startKey]
      const count = hunk[countKey]
      if (lineNumber >= start && lineNumber < start + count) {
        const index = hunk[indexKey] + (lineNumber - start)
        return lines[index] ?? ''
      }
    }
    return ''
  }

  const linkable = !!onDefinition && isSourceFile(filePath)
  const tokenHandlers = linkable ? {
    useTokenTransformer: true,
    onTokenEnter: (props: { tokenElement: HTMLElement }, event: PointerEvent) => tokenLinkHover.enter(props.tokenElement, event.metaKey),
    onTokenLeave: () => tokenLinkHover.leave(),
    onTokenClick: (props: { side: 'additions' | 'deletions'; lineNumber: number; lineCharStart: number; tokenElement: HTMLElement }, event: MouseEvent) => {
      if (!event.metaKey) return
      event.preventDefault()
      onDefinition!({ path: filePath, side: props.side, line: props.lineNumber, col: props.lineCharStart }, props.tokenElement.getBoundingClientRect())
    },
  } : {}

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...annotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  return (
    <div className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''}`} id={id} ref={cardRef}>
      {viewed ? (
        <div className="file-diff-viewed-header">
          <span className="file-diff-viewed-name">{filePath}</span>
          <span className="file-header-actions">
            <ExcludeButton onClick={() => onExclude(filePath)} />
            <label className="viewed-label viewed-checked" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={viewed}
                onChange={(e) => onViewedChange(filePath, e.target.checked)}
              />
              Viewed
            </label>
          </span>
        </div>
      ) : (
        <>
          <FileDiff<ReviewComment | { _pending: true }>
            fileDiff={fileDiff}
            options={{
              diffStyle,
              stickyHeader: true,
              expansionLineCount: 20,
              enableGutterUtility: true,
              theme: { dark: 'github-dark', light: 'github-light' },
              themeType: 'system',
              overflow: softWrap ? 'wrap' : 'scroll',
              unsafeCSS: `:host { --diffs-tab-size: ${tabSize}; }`,
              ...tokenHandlers,
            }}
            lineAnnotations={allAnnotations}
            selectedLines={highlightLine ? { start: highlightLine.line, end: highlightLine.line, side: highlightLine.side } : null}
            renderHeaderMetadata={() => (
              <span className="file-header-actions">
                <ExcludeButton onClick={() => onExclude(filePath)} />
                <label className="viewed-label" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={viewed}
                    onChange={(e) => onViewedChange(filePath, e.target.checked)}
                  />
                  Viewed
                </label>
              </span>
            )}
            renderAnnotation={(annotation) => {
              if ('_pending' in annotation.metadata) {
                const target = pending!
                return (
                  <CommentForm
                    error={pendingError}
                    onSubmit={async (body) => {
                      const lineContent = getLineContent(target.side, target.lineNumber)
                      try {
                        await onAddComment(filePath, target.side, target.lineNumber, lineContent, body)
                        setPending(null)
                        setPendingError(null)
                      } catch (err) {
                        setPendingError((err as Error).message)
                      }
                    }}
                    onCancel={() => {
                      setPending(null)
                      setPendingError(null)
                    }}
                  />
                )
              }
              return (
                <CommentBubble
                  comment={annotation.metadata as ReviewComment}
                  onDelete={onDeleteComment}
                  onReply={onReplyComment}
                />
              )
            }}
            renderGutterUtility={(getHoveredLine) => (
              <button
                className="gutter-add-btn"
                onClick={() => {
                  const line = getHoveredLine()
                  if (line) {
                    setPending({ side: line.side, lineNumber: line.lineNumber })
                  }
                }}
              >
                +
              </button>
            )}
          />
        </>
      )}
    </div>
  )
})
