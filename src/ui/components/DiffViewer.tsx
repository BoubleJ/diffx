import { memo, useMemo } from 'react'
import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { BinaryFileInfo } from '../hooks/useDiff'
import { FileDiffCard } from './FileDiffCard'
import { BinaryFileDiff } from './BinaryFileDiff'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  tabSizeMap: Record<string, number>
  defaultTabSize: number
  softWrap: boolean
  viewedFiles: Set<string>
  binaryFiles: Map<string, BinaryFileInfo>
  onViewedChange: (filePath: string, viewed: boolean) => void
  onExclude: (filePath: string) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
  contentQuery: string
  highlight: { file: string; side: 'additions' | 'deletions'; line: number } | null
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

export const DiffViewer = memo(function DiffViewer({
  files,
  diffStyle,
  tabSizeMap,
  defaultTabSize,
  softWrap,
  viewedFiles,
  binaryFiles,
  onViewedChange,
  onExclude,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
  contentQuery,
  highlight,
}: DiffViewerProps) {
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const partsA = a.name.split('/')
      const partsB = b.name.split('/')
      const len = Math.min(partsA.length, partsB.length)
      for (let i = 0; i < len; i++) {
        const aIsDir = i < partsA.length - 1
        const bIsDir = i < partsB.length - 1
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
        const cmp = partsA[i].localeCompare(partsB[i])
        if (cmp !== 0) return cmp
      }
      return partsA.length - partsB.length
    })
  }, [files])

  if (sortedFiles.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  const seen = new Map<string, number>()

  return (
    <div className="diff-viewer">
      {sortedFiles.map((file) => {
        const filePath = file.name
        const occurrence = seen.get(filePath) ?? 0
        seen.set(filePath, occurrence + 1)
        const cardKey = `${filePath}#${occurrence}`
        const binaryInfo = binaryFiles.get(filePath)
        if (binaryInfo) {
          return (
            <BinaryFileDiff
              key={cardKey}
              filePath={filePath}
              info={binaryInfo}
              viewed={viewedFiles.has(filePath)}
              onViewedChange={onViewedChange}
              onExclude={onExclude}
              contentQuery={contentQuery}
            />
          )
        }
        return (
          <FileDiffCard
            // Include isPartial in the key so the card remounts when a file is
            // upgraded from a partial (patch-only) to a full diff. The
            // @pierre/diffs <FileDiff> under the Virtualizer does not re-process
            // an in-place fileDiff change, so without a remount the upgraded
            // diff never renders and hunk-context expansion controls never appear.
            key={`${cardKey}-${file.isPartial ? 'p' : 'f'}`}
            id={`file-${filePath}`}
            fileDiff={file}
            filePath={filePath}
            annotations={fileAnnotationsMap.get(filePath) ?? emptyAnnotations}
            diffStyle={diffStyle}
            tabSize={tabSizeMap[filePath] ?? defaultTabSize}
            softWrap={softWrap}
            viewed={viewedFiles.has(filePath)}
            onViewedChange={onViewedChange}
            onExclude={onExclude}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            highlightLine={highlight && highlight.file === filePath ? highlight : null}
          />
        )
      })}
    </div>
  )
})
