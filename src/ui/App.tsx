import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Resizable } from 'react-resizable'
import { useQueryClient } from '@tanstack/react-query'
import { parsePatchFiles } from '@pierre/diffs'
import { Virtualizer } from '@pierre/diffs/react'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useRepo } from './hooks/useRepo'
import { useBranches } from './hooks/useBranches'
import { useGitlabStatus } from './hooks/useGitlab'
import { reconcileMrAvailability, gitlabUnavailableMessage, mrNotFoundReset } from './gitlab'
import { useComments } from './hooks/useComments'
import { useMrComments } from './hooks/useMrComments'
import { DefinitionPopover, type PopoverContent } from './components/DefinitionPopover'
import { FileViewerOverlay } from './components/FileViewerOverlay'
import { SidePanel } from './components/SidePanel'
import { ExplorePanel } from './components/ExplorePanel'
import { createRequestGate } from './requestGate'
import { definitionAction, fetchDefinition, fetchReferences, exploreTitle, type DefinitionAction, type DefinitionRequest, type DefinitionTarget, type DefinitionVersion, type ExploreState, type ExploreItem, type ReferencesRequest } from './definition'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { useFullDiffs, fileKey } from './hooks/useFullDiffs'
import { useReview, type Finding } from './hooks/useReview'
import { Toolbar } from './components/Toolbar'
import { MrCheckout } from './components/MrCheckout'
import { BranchPicker } from './components/BranchPicker'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import { CommentTracker } from './components/CommentTracker'
import { ExcludedFiles } from './components/ExcludedFiles'
import { ReviewPanel } from './components/ReviewPanel'
import { SidebarStorage } from './sidebarStorage'
import { loadExcluded, saveExcluded } from './excludedStorage'
import { excludeFilesFromPatch } from '../review/filterPatch'
import { loadReviewPanel, saveReviewPanel, nextOnReviewButton, openExploreTab, REVIEW_PANEL_MIN } from './reviewPanelStorage'
import { loadReviewInstruction, saveReviewInstruction } from './reviewInstructionStorage'
import { comparisonParams, loadComparison, saveComparison, reconcileComparison, comparisonForMode, type Comparison } from './comparison'

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
  const branchMode = !!repo
  const { branches, branchesError, fetchRemote, fetching, fetchError } = useBranches(branchMode)
  const gitlab = useGitlabStatus(branchMode)
  const queryClient = useQueryClient()
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!repo) return
    if (!branches) {
      if (branchesError) {
        setNotice(`브랜치 목록을 불러오지 못했습니다: ${branchesError}`)
        if (!comparison) setComparison({ mode: 'mr', iid: null })
      }
      return
    }
    const base = comparison ?? loadComparison(repo.root)
    const { comparison: reconciled, missing } = reconcileComparison(base, branches)
    const { comparison: next, notice: mrNotice } = reconcileMrAvailability(reconciled, gitlab.status, branches)
    if (missing.length > 0) {
      setNotice(`저장된 브랜치 ${missing.join(', ')}을 찾지 못해 기본값으로 바꿨습니다`)
    }
    if (mrNotice) setNotice(mrNotice)
    if (JSON.stringify(next) !== JSON.stringify(comparison)) setComparison(next)
  }, [repo, branches, branchesError, gitlab.status])

  const handleComparisonChange = useCallback((next: Comparison) => {
    setNotice(null)
    setComparison(next)
    if (repo) saveComparison(repo.root, next)
  }, [repo])

  const handleModeChange = useCallback((mode: Comparison['mode']) => {
    if (!repo) return
    const next = comparisonForMode(repo.root, mode, branches)
    if (!next) return
    handleComparisonChange(next.comparison)
    if (next.missing.length > 0) setNotice(`저장된 브랜치 ${next.missing.join(', ')}을 찾지 못해 기본값으로 바꿨습니다`)
  }, [repo, branches, handleComparisonChange])

  const params = useMemo(
    () => (comparison ? comparisonParams(comparison) : null),
    [comparison],
  )
  const [diffReloadToken, setDiffReloadToken] = useState(0)
  const handleFetch = useCallback(async () => {
    await fetchRemote()
    setDiffReloadToken((t) => t + 1)
  }, [fetchRemote])
  const { patch, branch, binaryFiles, tabSizeMap, key, identical, loading, error, errorCode, mr: diffMr } = useDiff(params, diffReloadToken)
  useEffect(() => {
    if (!comparison) return
    const reset = mrNotFoundReset(comparison, errorCode)
    if (!reset) return
    handleComparisonChange(reset.comparison)
    setNotice(reset.notice)
  }, [comparison, errorCode, handleComparisonChange])
  const [mrRefreshing, setMrRefreshing] = useState(false)
  const handleRefreshMr = useCallback(async () => {
    setMrRefreshing(true)
    try {
      await gitlab.refresh()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mr-list'] }),
        queryClient.invalidateQueries({ queryKey: ['mr-threads'] }),
      ])
      setDiffReloadToken((t) => t + 1)
    } finally {
      setMrRefreshing(false)
    }
  }, [gitlab.refresh, queryClient])
  const handleRecheckGitlab = useCallback(async () => {
    const next = await gitlab.refresh()
    if (next.available) handleComparisonChange({ mode: 'mr', iid: null })
    else setNotice(gitlabUnavailableMessage(next))
  }, [gitlab.refresh, handleComparisonChange])
  const repoRoot = repo?.root ?? null
  const [excludedEdit, setExcludedEdit] = useState<{ repoRoot: string; key: string; paths: string[] } | null>(null)
  const excluded = useMemo(() => {
    if (!repoRoot || !key) return []
    if (excludedEdit && excludedEdit.repoRoot === repoRoot && excludedEdit.key === key) return excludedEdit.paths
    return loadExcluded(repoRoot, key)
  }, [repoRoot, key, excludedEdit])
  useEffect(() => {
    if (excludedEdit) saveExcluded(excludedEdit.repoRoot, excludedEdit.key, excludedEdit.paths)
  }, [excludedEdit])
  const handleExclude = useCallback((filePath: string) => {
    if (!repoRoot || !key) return
    setExcludedEdit((prev) => {
      const current = prev && prev.repoRoot === repoRoot && prev.key === key ? prev.paths : loadExcluded(repoRoot, key)
      return { repoRoot, key, paths: [...new Set([...current, filePath])] }
    })
  }, [repoRoot, key])
  const handleInclude = useCallback((filePath: string) => {
    if (!repoRoot || !key) return
    setExcludedEdit((prev) => {
      const current = prev && prev.repoRoot === repoRoot && prev.key === key ? prev.paths : loadExcluded(repoRoot, key)
      return { repoRoot, key, paths: current.filter((p) => p !== filePath) }
    })
  }, [repoRoot, key])
  const review = useReview(params, key)
  const [reviewPanel, setReviewPanel] = useState(() => loadReviewPanel())
  const [reviewInstruction, setReviewInstruction] = useState('')
  useEffect(() => {
    if (repoRoot) setReviewInstruction(loadReviewInstruction(repoRoot))
  }, [repoRoot])
  const handleInstructionChange = useCallback((value: string) => {
    setReviewInstruction(value)
    if (repoRoot) saveReviewInstruction(repoRoot, value)
  }, [repoRoot])
  const updateReviewPanel = useCallback((next: typeof reviewPanel) => {
    setReviewPanel(next)
    saveReviewPanel(next)
  }, [])
  const claude = review.providers.find((p) => p.id === 'claude')
  const [highlight, setHighlight] = useState<{ file: string; side: 'additions' | 'deletions'; line: number } | null>(null)
  const isMr = comparison?.mode === 'mr'
  const mrIid = comparison?.mode === 'mr' ? comparison.iid : null
  const localComments = useComments(isMr ? null : key)
  const mrComments = useMrComments(mrIid, diffMr && diffMr.iid === mrIid ? diffMr.headSha : null)
  const comments = isMr ? mrComments.comments : localComments.comments
  const addComment = isMr ? mrComments.addDraft : localComments.addComment
  const removeComment = useCallback((id: string) => {
    if (!isMr) return localComments.removeComment(id)
    mrComments.deleteDraft(id).catch((err) => window.alert(`초안 삭제 실패: ${(err as Error).message}`))
  }, [isMr, localComments.removeComment, mrComments.deleteDraft])
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
            type: bf.type === 'added' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
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

  const excludedSet = useMemo(() => new Set(excluded), [excluded])
  const visibleFiles = useMemo(() => files.filter((f) => !excludedSet.has(f.name)), [files, excludedSet])
  const visibleDisplayFiles = useMemo(() => displayFiles.filter((f) => !excludedSet.has(f.name)), [displayFiles, excludedSet])
  const excludedInDiff = useMemo(() => files.filter((f) => excludedSet.has(f.name)).map((f) => f.name).sort(), [files, excludedSet])

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    for (const line of excludeFilesFromPatch(patch, excludedInDiff).split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }, [patch, excludedInDiff])

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

  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
  }, [])

  const handleFindingClick = useCallback((f: Finding) => {
    handleFileClick(f.file)
    if (f.line !== null) {
      setHighlight({ file: f.file, side: f.side === 'old' ? 'deletions' : 'additions', line: f.line })
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlight(null), 2000)
    }
  }, [handleFileClick])

  const contentQuery = params?.toString() ?? ''
  const [popover, setPopover] = useState<{ anchor: DOMRect; content: PopoverContent } | null>(null)
  const closePopover = useCallback(() => setPopover(null), [])
  const [explore, setExplore] = useState<ExploreState>({ status: 'idle' })
  const [exploreSelected, setExploreSelected] = useState<string | null>(null)
  const exploreGate = useRef(createRequestGate())
  const [overlayEntries, setOverlayEntries] = useState<{ path: string; line: number; version: DefinitionVersion }[]>([])
  const pendingJump = useRef<{ file: string; line: number; side: 'additions' | 'deletions'; version: DefinitionVersion } | null>(null)

  const openOverlay = useCallback((entry: { path: string; line: number; version: DefinitionVersion }) => {
    setOverlayEntries((prev) => [...prev, entry])
  }, [])

  const visibleFileNames = useMemo(() => new Set(visibleFiles.map((f) => f.name)), [visibleFiles])

  const jumpTo = useCallback((target: DefinitionTarget, version: DefinitionVersion, fromOverlay: boolean) => {
    const side = version === 'new' ? 'additions' : 'deletions'
    if (!fromOverlay && visibleFileNames.has(target.path)) {
      pendingJump.current = { file: target.path, line: target.line, side, version }
      handleFileClick(target.path)
      setHighlight({ file: target.path, side, line: target.line })
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlight(null), 2000)
      return
    }
    openOverlay({ path: target.path, line: target.line, version })
  }, [visibleFileNames, handleFileClick, openOverlay])

  const handleHighlightMissing = useCallback((file: string, line: number, side: 'additions' | 'deletions') => {
    const pending = pendingJump.current
    if (!pending || pending.file !== file || pending.line !== line || pending.side !== side) return
    pendingJump.current = null
    openOverlay({ path: file, line, version: pending.version })
  }, [openOverlay])

  const showExplore = useCallback((next: ExploreState) => {
    setExplore(next)
    setExploreSelected(null)
    setReviewPanel((prev) => {
      const nextPanel = openExploreTab(prev)
      saveReviewPanel(nextPanel)
      return nextPanel
    })
  }, [])

  const openReferences = useCallback(async (req: ReferencesRequest, name: string) => {
    const id = exploreGate.current.next()
    const title = 'scope' in req ? exploreTitle.importers(name) : exploreTitle.references(name)
    showExplore({ status: 'loading', title })
    try {
      const res = await fetchReferences(contentQuery, req)
      if (!exploreGate.current.isLatest(id)) return
      if (res.kind === 'not_declaration') {
        setExplore({ status: 'ready', title, items: [], truncated: false, version: req.side === 'additions' ? 'new' : 'old' })
        return
      }
      setExplore({ status: 'ready', title, items: res.references, truncated: res.truncated, version: res.version })
    } catch {
      if (exploreGate.current.isLatest(id)) setExplore({ status: 'error', title })
    }
  }, [contentQuery, showExplore])

  const handleExplorePick = useCallback((item: ExploreItem, version: DefinitionVersion) => {
    setExploreSelected(`${item.path}:${item.line}`)
    jumpTo({ path: item.path, line: item.line }, version, false)
  }, [jumpTo])

  const handleDefinition = useCallback(async (req: DefinitionRequest, anchor: DOMRect, fromOverlay = false) => {
    const requestId = exploreGate.current.next()
    document.body.classList.add('definition-loading')
    let action: DefinitionAction
    try {
      action = definitionAction(await fetchDefinition(contentQuery, req))
    } catch {
      action = definitionAction(null)
    } finally {
      document.body.classList.remove('definition-loading')
    }
    if (!exploreGate.current.isLatest(requestId)) return
    if (action.type === 'jump') {
      jumpTo(action.target, action.version, fromOverlay)
    } else if (action.type === 'choose') {
      showExplore({ status: 'ready', title: exploreTitle.candidates(req.name ?? ''), items: action.targets, truncated: false, version: action.version })
    } else if (action.type === 'references') {
      void openReferences({ path: req.path, side: req.side, line: req.line, col: req.col }, req.name ?? '')
    } else {
      setPopover({ anchor, content: { type: 'message', text: action.text } })
    }
  }, [contentQuery, jumpTo, showExplore, openReferences])

  const closeOverlay = useCallback(() => setOverlayEntries([]), [])
  const backOverlay = useCallback(() => setOverlayEntries((prev) => prev.slice(0, -1)), [])
  const handleOverlayDefinition = useCallback((req: DefinitionRequest, anchor: DOMRect) => {
    void handleDefinition(req, anchor, true)
  }, [handleDefinition])
  useEffect(() => setOverlayEntries([]), [contentQuery])
  useEffect(() => {
    exploreGate.current.next()
    setExplore({ status: 'idle' })
    setExploreSelected(null)
  }, [contentQuery])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
  }, [setViewed])

  const sidebarContent = (
    <div className="sidebar-content">
      <FileTree
        files={visibleFiles}
        activeFile={activeFile}
        commentCounts={commentCounts}
        viewedFiles={viewedFiles}
        onFileClick={handleFileClick}
        onExclude={handleExclude}
        collapsed={sidebar.collapsed}
        onToggleCollapse={handleToggleCollapse}
      />
      {!sidebar.collapsed && <ExcludedFiles paths={excludedInDiff} onInclude={handleInclude} />}
      {!sidebar.collapsed && isMr && diffMr && mrComments.outdatedCount > 0 && (
        <div className="mr-outdated-notice">
          이전 버전에 남은 코멘트 {mrComments.outdatedCount}개는 <a href={diffMr.webUrl} target="_blank" rel="noreferrer">GitLab</a>에서 확인해 주세요
        </div>
      )}
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
        branchPicker={(
          <BranchPicker
            comparison={comparison}
            branches={branches}
            fetching={fetching}
            fetchError={fetchError}
            notice={notice}
            onChange={handleComparisonChange}
            onModeChange={handleModeChange}
            onFetch={handleFetch}
            repoRoot={repo.root}
            gitlab={gitlab.status}
            mrTitle={diffMr?.title ?? null}
            mrRefreshing={mrRefreshing}
            onRefreshMr={handleRefreshMr}
            onRecheckGitlab={handleRecheckGitlab}
          />
        )}
        branch={branch}
        fileCount={visibleFiles.length}
        excludedCount={excludedInDiff.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        diffStyle={settings.diffStyle}
        defaultTabSize={settings.defaultTabSize}
        softWrap={settings.softWrap}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onSoftWrapChange={(softWrap) => updateSettings({ softWrap })}
        terminalApp={settings.terminalApp}
        onTerminalAppChange={(terminalApp) => updateSettings({ terminalApp })}
        reviewOpen={reviewPanel.open && reviewPanel.tab === 'review'}
        onToggleReview={() => updateReviewPanel(nextOnReviewButton(reviewPanel))}
        mrLink={comparison.mode === 'mr' && diffMr ? diffMr : undefined}
        mrCheckout={comparison.mode === 'mr' && diffMr ? <MrCheckout key={diffMr.iid} iid={diffMr.iid} headSha={diffMr.headSha} onReloadDiff={() => void handleRefreshMr()} /> : undefined}
        submitReview={isMr && mrIid !== null ? {
          count: mrComments.draftCount,
          submitting: mrComments.submitting,
          error: mrComments.submitError,
          onSubmit: () => void mrComments.publish(),
        } : undefined}
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
          {comparison.mode === 'mr' && comparison.iid === null ? (
            <div className="empty-state"><p>MR을 선택해 주세요</p></div>
          ) : loading ? (
            <div className="loading"><p>{comparison.mode === 'mr' ? 'MR 커밋을 가져오는 중입니다' : 'Loading diff...'}</p></div>
          ) : error ? (
            <div className="empty-state">
              <p>{error}</p>
              {comparison.mode === 'mr' && (
                <button className="btn btn-sm" onClick={() => setDiffReloadToken((t) => t + 1)}>다시 시도</button>
              )}
            </div>
          ) : identical ? (
            <div className="empty-state"><p>두 브랜치의 내용이 같습니다</p></div>
          ) : (
          <Virtualizer className="main-scroll" contentClassName="main-content">
            <DiffViewer
              files={visibleDisplayFiles}
              diffStyle={settings.diffStyle}
              tabSizeMap={tabSizeMap}
              defaultTabSize={settings.defaultTabSize}
              softWrap={settings.softWrap}
              viewedFiles={viewedFiles}
              binaryFiles={binaryFileMap}
              onViewedChange={handleViewedChange}
              onExclude={handleExclude}
              fileAnnotationsMap={fileAnnotationsMap}
              onAddComment={addComment}
              onDeleteComment={removeComment}
              onReplyComment={isMr ? mrComments.addReply : undefined}
              contentQuery={params?.toString() ?? ''}
              highlight={highlight}
              onDefinition={handleDefinition}
              onHighlightMissing={handleHighlightMissing}
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
                <SidePanel
                  tab={reviewPanel.tab}
                  onTabChange={(tab) => setReviewPanel((prev) => {
                    const nextPanel = { ...prev, tab }
                    saveReviewPanel(nextPanel)
                    return nextPanel
                  })}
                  review={(
                    <ReviewPanel
                      provider={claude}
                      record={review.record}
                      stale={review.stale}
                      state={review.state}
                      instruction={reviewInstruction}
                      onInstructionChange={handleInstructionChange}
                      onStart={() => review.start('claude', excludedInDiff, reviewInstruction)}
                      onCancel={review.cancel}
                      onFindingClick={handleFindingClick}
                    />
                  )}
                  explore={<ExplorePanel state={explore} selected={exploreSelected} onPick={handleExplorePick} />}
                />
              </div>
            </aside>
          </Resizable>
        )}
      </div>
      {overlayEntries.length > 0 && (
        <FileViewerOverlay
          entries={overlayEntries}
          contentQuery={contentQuery}
          onBack={backOverlay}
          onClose={closeOverlay}
          onDefinition={handleOverlayDefinition}
        />
      )}
      {popover && <DefinitionPopover anchor={popover.anchor} content={popover.content} onClose={closePopover} />}
    </div>
  )
}
