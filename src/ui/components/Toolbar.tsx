import { useState, useRef, useEffect, type ReactNode } from 'react'
import { GitBranch, PanelRight, RefreshCw, Settings } from 'lucide-react'
import { mrStateBadge } from '../gitlab'

interface ToolbarProps {
  branch: string
  fileCount: number
  excludedCount?: number
  additions: number
  deletions: number
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap: boolean
  branchPicker?: ReactNode
  panelOpen: boolean
  onTogglePanel: () => void
  onDiffStyleChange: (style: 'split' | 'unified') => void
  onDefaultTabSizeChange: (size: number) => void
  onSoftWrapChange: (softWrap: boolean) => void
  terminalApp: string
  onTerminalAppChange: (app: string) => void
  mrLink?: { iid: number; title: string; webUrl: string; state: string }
  mrCheckout?: ReactNode
  submitReview?: { count: number; submitting: boolean; error: string | null; onSubmit: () => void }
}

export function Toolbar({
  branch,
  fileCount,
  excludedCount = 0,
  additions,
  deletions,
  diffStyle,
  defaultTabSize,
  softWrap,
  branchPicker,
  panelOpen,
  onTogglePanel,
  onDiffStyleChange,
  onDefaultTabSizeChange,
  onSoftWrapChange,
  terminalApp,
  onTerminalAppChange,
  mrLink,
  mrCheckout,
  submitReview,
}: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    if (settingsOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [settingsOpen])

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {mrLink && (
          <a className="toolbar-mr-link" href={mrLink.webUrl} target="_blank" rel="noreferrer" title="GitLab에서 열기">
            !{mrLink.iid} {mrLink.title}
          </a>
        )}
        {mrLink && mrStateBadge(mrLink.state) && <span className="mr-badge">{mrStateBadge(mrLink.state)}</span>}
        {mrCheckout}
        {branchPicker ?? (branch && (
          <span className="toolbar-branch">
            <GitBranch size={12} />
            {branch}
          </span>
        ))}
        <span className="toolbar-stat">
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
          {excludedCount > 0 && ` (제외 ${excludedCount}개)`}
          {additions > 0 && <span className="stat-additions"> +{additions}</span>}
          {deletions > 0 && <span className="stat-deletions"> -{deletions}</span>}
        </span>
      </div>
      <div className="toolbar-right">
        <div className="toolbar-toggle">
          <button
            className={`btn btn-sm ${diffStyle === 'split' ? 'btn-active' : ''}`}
            onClick={() => onDiffStyleChange('split')}
          >
            Split
          </button>
          <button
            className={`btn btn-sm ${diffStyle === 'unified' ? 'btn-active' : ''}`}
            onClick={() => onDiffStyleChange('unified')}
          >
            Unified
          </button>
        </div>
        <div className="settings-wrapper" ref={settingsRef}>
          <button
            className={`btn btn-sm settings-btn ${settingsOpen ? 'btn-active' : ''}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Settings"
          >
            <Settings size={14} />
          </button>
          {settingsOpen && (
            <div className="settings-menu">
              <label className="settings-item">
                <input
                  type="checkbox"
                  checked={softWrap}
                  onChange={(e) => onSoftWrapChange(e.target.checked)}
                />
                Soft wrap
              </label>
              <div className="settings-item settings-item-spaced">
                <span>Default tab size</span>
                <select
                  className="settings-select"
                  value={defaultTabSize}
                  onChange={(e) => onDefaultTabSizeChange(Number(e.target.value))}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                </select>
              </div>
              <label className="settings-item settings-item-spaced">
                <span>Terminal</span>
                <input
                  className="settings-input"
                  value={terminalApp}
                  placeholder="Terminal"
                  onChange={(e) => onTerminalAppChange(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
        <button
          className={`btn btn-sm panel-toggle-btn ${panelOpen ? 'btn-active' : ''}`}
          onClick={onTogglePanel}
          title="사이드 패널 열기/닫기"
          aria-label="사이드 패널 열기/닫기"
        >
          <PanelRight size={14} />
        </button>
        {submitReview && (
          <div className="toolbar-submit">
            <button
              className="btn btn-primary btn-sm"
              onClick={submitReview.onSubmit}
              disabled={submitReview.count === 0 || submitReview.submitting}
            >
              {submitReview.submitting && <RefreshCw size={14} className="spin" />}
              리뷰 제출 ({submitReview.count})
            </button>
            {submitReview.error && <div className="toolbar-submit-error">{submitReview.error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
