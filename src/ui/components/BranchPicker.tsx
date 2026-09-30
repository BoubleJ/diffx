import { ArrowRight, RefreshCw } from 'lucide-react'
import type { Comparison } from '../comparison'
import { defaultBranchComparison } from '../comparison'
import type { BranchList } from '../hooks/useBranches'
import { RefSelect } from './RefSelect'
import type { GitlabStatus } from '../../gitlab/mr'
import { gitlabUnavailableMessage, mrTabAction } from '../gitlab'
import { MrSelect } from './MrSelect'

interface BranchPickerProps {
  comparison: Comparison
  branches: BranchList | undefined
  fetching: boolean
  fetchError: string | null
  notice: string | null
  onChange: (c: Comparison) => void
  onFetch: () => void
  repoRoot: string
  gitlab: GitlabStatus | undefined
  mrTitle: string | null
  mrRefreshing: boolean
  onRefreshMr: () => void
  onRecheckGitlab: () => void
}

export function BranchPicker({ comparison, branches, fetching, fetchError, notice, onChange, onFetch, repoRoot, gitlab, mrTitle, mrRefreshing, onRefreshMr, onRecheckGitlab }: BranchPickerProps) {
  const switchToBranch = () => {
    if (comparison.mode === 'branch' || !branches) return
    onChange(defaultBranchComparison(branches))
  }

  const mrUnavailable = gitlab && !gitlab.available ? `${gitlabUnavailableMessage(gitlab)} (클릭 시 다시 확인)` : null

  const handleMrTab = () => {
    const action = mrTabAction(gitlab)
    if (action === 'recheck') onRecheckGitlab()
    else if (action === 'open' && comparison.mode !== 'mr') onChange({ mode: 'mr', iid: null })
  }

  return (
    <div className="branch-picker">
      <div className="toolbar-toggle">
        <button
          className={`btn btn-sm ${comparison.mode === 'branch' ? 'btn-active' : ''}`}
          onClick={switchToBranch}
          disabled={!branches}
        >
          브랜치 비교
        </button>
        <button
          className={`btn btn-sm ${comparison.mode === 'mr' ? 'btn-active' : ''} ${mrUnavailable ? 'btn-unavailable' : ''}`}
          onClick={handleMrTab}
          disabled={!gitlab}
          title={mrUnavailable ?? undefined}
        >
          MR
        </button>
      </div>
      {comparison.mode === 'branch' && branches && (
        <div className="branch-picker-refs">
          <RefSelect
            label="소스"
            value={comparison.source}
            local={branches.local}
            remote={branches.remote}
            onChange={(source) => onChange({ ...comparison, source })}
          />
          <ArrowRight size={14} className="branch-picker-arrow" />
          <RefSelect
            label="타겟"
            value={comparison.target}
            local={branches.local}
            remote={branches.remote}
            onChange={(target) => onChange({ ...comparison, target })}
          />
          <button
            className="btn btn-sm"
            onClick={onFetch}
            disabled={fetching}
            title="원격 브랜치 가져오기 (git fetch --all --prune)"
          >
            <RefreshCw size={14} className={fetching ? 'spin' : ''} />
          </button>
        </div>
      )}
      {comparison.mode === 'mr' && (
        <div className="branch-picker-refs">
          <MrSelect
            repoRoot={repoRoot}
            value={comparison.iid}
            title={mrTitle}
            onChange={(iid) => onChange({ mode: 'mr', iid })}
          />
          <button
            className="btn btn-sm"
            onClick={onRefreshMr}
            disabled={mrRefreshing}
            title="MR 목록, diff, 코멘트 새로고침"
          >
            <RefreshCw size={14} className={mrRefreshing ? 'spin' : ''} />
          </button>
        </div>
      )}
      {(fetchError || notice) && (
        <div className="branch-picker-message">{fetchError ? `fetch 실패: ${fetchError}` : notice}</div>
      )}
    </div>
  )
}
