import { ArrowRight, RefreshCw } from 'lucide-react'
import type { Comparison } from '../comparison'
import { defaultBranchComparison } from '../comparison'
import type { BranchList } from '../hooks/useBranches'
import { RefSelect } from './RefSelect'

interface BranchPickerProps {
  comparison: Comparison
  branches: BranchList | undefined
  fetching: boolean
  fetchError: string | null
  notice: string | null
  onChange: (c: Comparison) => void
  onFetch: () => void
}

export function BranchPicker({ comparison, branches, fetching, fetchError, notice, onChange, onFetch }: BranchPickerProps) {
  const switchToBranch = () => {
    if (comparison.mode === 'branch' || !branches) return
    onChange(defaultBranchComparison(branches))
  }

  return (
    <div className="branch-picker">
      <div className="toolbar-toggle">
        <button
          className={`btn btn-sm ${comparison.mode === 'worktree' ? 'btn-active' : ''}`}
          onClick={() => onChange({ mode: 'worktree' })}
        >
          작업 중 변경사항
        </button>
        <button
          className={`btn btn-sm ${comparison.mode === 'branch' ? 'btn-active' : ''}`}
          onClick={switchToBranch}
          disabled={!branches}
        >
          브랜치 비교
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
      {(fetchError || notice) && (
        <div className="branch-picker-message">{fetchError ? `fetch 실패: ${fetchError}` : notice}</div>
      )}
    </div>
  )
}
