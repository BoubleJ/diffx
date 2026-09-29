import { useState, useMemo, useCallback, useEffect } from 'react'
import { Resizable } from 'react-resizable'
import { parsePatchFiles } from '@pierre/diffs'
import { Virtualizer } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useRepo } from './hooks/useRepo'
import { useBranches } from './hooks/useBranches'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { useFullDiffs, fileKey } from './hooks/useFullDiffs'
import { useReview, type Finding } from './hooks/useReview'
import { Toolbar } from './components/Toolbar'
import { BranchPicker } from './components/BranchPicker'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import { CommentTracker } from './components/CommentTracker'
import { ReviewPanel } from './components/ReviewPanel'
import { SidebarStorage } from './sidebarStorage'
import { loadReviewPanel, saveReviewPanel, REVIEW_PANEL_MIN } from './reviewPanelStorage'
import { comparisonParams, loadComparison, saveComparison, reconcileComparison, type Comparison } from './comparison'

function useWindowSize({ factor }: { factor: number }) {
  const compute = () => Math.round(window.innerWidth * factor)

  const [size, setSize] = useState(compute)

  useEffect(() => {
    const handleResize = () => setSize(compute())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [factor])

  return size
}

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const { repo, error: repoError } = useRepo()
  const branchMode = !!repo && !repo.customMode
  const { branches, branchesError, fetchRemote, fetching, fetchError } = useBranches(branchMode)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!repo) return
    if (repo.customMode) {
      setComparison({ mode: 'worktree' })
      return
    }
    if (!branches) {
      if (branchesError) {
        setNotice(`브랜치 목록을 불러오지 못했습니다: ${branchesError}`)
        if (comparison?.mode !== 'worktree') setComparison({ mode: 'worktree' })
      }
      return
    }
    const base = comparison ?? loadComparison(repo.root)
    const { comparison: next, missing } = reconcileComparison(base, branches)
    if (missing.length > 0) {
      setNotice(`저장된 브랜치 ${missing.join(', ')}을 찾지 못해 기본값으로 바꿨습니다`)
    }
    if (JSON.stringify(next) !== JSON.stringify(comparison)) setComparison(next)
  }, [repo, branches, branchesError])

  const handleComparisonChange = useCallback((next: Comparison) => {
    setNotice(null)
    setComparison(next)
    if (repo) saveComparison(repo.root, next)
  }, [repo])

  const params = useMemo(
    () => (comparison ? comparisonParams(comparison, { staged: settings.staged, untracked: settings.untracked }) : null),
    [comparison, settings.staged, settings.untracked],
  )
  const { patch, repoName, branch, binaryFiles, tabSizeMap, untrackedFiles, key, identical, loading, error } = useDiff(params)
  const review = useReview(params, key)
  const [reviewPanel, setReviewPanel] = useState(() => loadReviewPanel())
  const updateReviewPanel = useCallback((next: typeof reviewPanel) => {
    setReviewPanel(next)
    saveReviewPanel(next)
  }, [])
  const claude = review.providers.find((p) => p.id === 'claude')
  const [highlight, setHighlight] = useState<{ file: string; side: 'additions' | 'deletions'; line: number } | null>(null)
  const { comments, addComment, removeComment, copyAllComments } = useComments(key)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(() => SidebarStorage.load())
  const maxSidebarWidth = Math.max(SidebarStorage.minSize, useWindowSize({ factor: 0.5 }))

  const handleResize = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSidebar((prev) => prev.withSize(data.size.width))
  }, [])

  const handleResizeStop = useCallback((_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSidebar((prev) => prev.withSize(data.size.width).save())
  }, [])

  const handleToggleCollapse = useCallback(() => {
    setSidebar((prev) => prev.withCollapsed(!prev.collapsed).save())
  }, [])

  const untrackedSet = useMemo(() => new Set(untrackedFiles), [untrackedFiles])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return parsedFiles
    } catch {
      return []
    }
  }, [patch, binaryFiles])

  const fullFiles = useFullDiffs(patch, files, params)
  const displayFiles = useMemo(() => {
    if (fullFiles.size === 0) return files
    return files.map((f) => fullFiles.get(fileKey(f)) ?? f)
  }, [files, fullFiles])

  const { viewedFiles, setViewed } = useViewed(files, key)

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }, [patch])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const handleFileClick = useCallback((filePath: string) => {
    setActiveFile(filePath)
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [])

  const handleFindingClick = useCallback((f: Finding) => {
    handleFileClick(f.file)
    if (f.line !== null) {
      setHighlight({ file: f.file, side: f.side === 'old' ? 'deletions' : 'additions', line: f.line })
      setTimeout(() => setHighlight(null), 2000)
    }
  }, [handleFileClick])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
  }, [setViewed])

  const sidebarContent = (
    <div className="sidebar-content">
      <FileTree
        files={files}
        activeFile={activeFile}
        commentCounts={commentCounts}
        viewedFiles={viewedFiles}
        untrackedFiles={untrackedSet}
        onFileClick={handleFileClick}
        collapsed={sidebar.collapsed}
        onToggleCollapse={handleToggleCollapse}
      />
      {!sidebar.collapsed && <CommentTracker comments={comments} />}
    </div>
  )

  if (repoError) {
    return (
      <div className="error">
        <p>Error: {repoError}</p>
      </div>
    )
  }

  if (!loaded || !repo || !comparison) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar
        repoName={repoName || repo.name}
        showWorktreeOptions={!repo.customMode && comparison.mode === 'worktree'}
        branchPicker={repo.customMode ? undefined : (
          <BranchPicker
            comparison={comparison}
            branches={branches}
            fetching={fetching}
            fetchError={fetchError}
            notice={notice}
            onChange={handleComparisonChange}
            onFetch={fetchRemote}
          />
        )}
        branch={branch}
        fileCount={files.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        commentCount={comments.length}
        diffStyle={settings.diffStyle}
        diffOptions={{ staged: settings.staged, untracked: settings.untracked }}
        defaultTabSize={settings.defaultTabSize}
        softWrap={settings.softWrap}
        browser={settings.browser}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDiffOptionsChange={(options) => updateSettings(options)}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onSoftWrapChange={(softWrap) => updateSettings({ softWrap })}
        onBrowserChange={(browser) => updateSettings({ browser })}
        reviewOpen={reviewPanel.open}
        onToggleReview={() => updateReviewPanel({ ...reviewPanel, open: !reviewPanel.open })}
        onCopyComments={copyAllComments}
      />
      <div className="app-body">
        {sidebar.collapsed ? (
          <aside className="sidebar sidebar-collapsed" style={{ width: sidebar.visibleSize() }}>
            {sidebarContent}
          </aside>
        ) : (
          <Resizable
            width={sidebar.visibleSize(maxSidebarWidth)}
            height={0}
            axis="x"
            resizeHandles={['e']}
            minConstraints={[SidebarStorage.minSize, 0]}
            maxConstraints={[maxSidebarWidth, 0]}
            onResize={handleResize}
            onResizeStop={handleResizeStop}
            handle={<div className="sidebar-resize-handle" />}
          >
            <aside className="sidebar" style={{ width: sidebar.visibleSize(maxSidebarWidth) }}>
              {sidebarContent}
            </aside>
          </Resizable>
        )}
        <main className="main">
          {loading ? (
            <div className="loading"><p>Loading diff...</p></div>
          ) : error ? (
            <div className="empty-state"><p>{error}</p></div>
          ) : identical ? (
            <div className="empty-state"><p>두 브랜치의 내용이 같습니다</p></div>
          ) : (
          <Virtualizer className="main-scroll" contentClassName="main-content">
            <DiffViewer
              files={displayFiles}
              diffStyle={settings.diffStyle}
              tabSizeMap={tabSizeMap}
              defaultTabSize={settings.defaultTabSize}
              softWrap={settings.softWrap}
              viewedFiles={viewedFiles}
              binaryFiles={binaryFileMap}
              onViewedChange={handleViewedChange}
              fileAnnotationsMap={fileAnnotationsMap}
              onAddComment={addComment}
              onDeleteComment={removeComment}
              contentQuery={params?.toString() ?? ''}
            />
          </Virtualizer>
          )}
        </main>
        {reviewPanel.open && (
          <Resizable
            width={Math.min(reviewPanel.size, maxSidebarWidth)}
            height={0}
            axis="x"
            resizeHandles={['w']}
            minConstraints={[REVIEW_PANEL_MIN, 0]}
            maxConstraints={[maxSidebarWidth, 0]}
            onResize={(_e, data) => setReviewPanel((prev) => ({ ...prev, size: data.size.width }))}
            onResizeStop={(_e, data) => updateReviewPanel({ ...reviewPanel, size: data.size.width })}
            handle={<div className="review-resize-handle" />}
          >
            <aside className="review-aside" style={{ width: Math.min(reviewPanel.size, maxSidebarWidth) }}>
              <div className="review-aside-scroll">
              <ReviewPanel
                provider={claude}
                record={review.record}
                stale={review.stale}
                state={review.state}
                onStart={() => review.start('claude')}
                onCancel={review.cancel}
                onFindingClick={handleFindingClick}
                onClose={() => updateReviewPanel({ ...reviewPanel, open: false })}
              />
              </div>
            </aside>
          </Resizable>
        )}
      </div>
    </div>
  )
}
