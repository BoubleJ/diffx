import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MrState } from '../../gitlab/mr'
import { useMrList } from '../hooks/useGitlab'
import { loadMrFilter, saveMrFilter, type MrFilter } from '../mrFilterStorage'
import { mrStateBadge } from '../gitlab'

const STATE_OPTIONS: { value: MrState; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'opened', label: '열린 MR' },
  { value: 'merged', label: '머지된 MR' },
]

interface MrSelectProps {
  repoRoot: string
  value: number | null
  title: string | null
  onChange: (iid: number) => void
}

export function MrSelect({ repoRoot, value, title, onChange }: MrSelectProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MrFilter>(() => loadMrFilter(repoRoot))
  const rootRef = useRef<HTMLDivElement>(null)
  const { mrs, loading, error } = useMrList(filter, search, open)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input])

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const updateFilter = (next: MrFilter) => {
    setFilter(next)
    saveMrFilter(repoRoot, next)
  }

  const select = (iid: number) => {
    onChange(iid)
    setOpen(false)
  }

  return (
    <div className="ref-select" ref={rootRef}>
      <button className="btn btn-sm ref-select-button mr-select-button" onClick={() => setOpen(!open)} title={title ?? 'MR 선택'}>
        <span className="ref-select-value">{value === null ? 'MR 선택' : `!${value} ${title ?? ''}`}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ref-select-menu mr-select-menu">
          <input
            className="ref-select-search"
            autoFocus
            placeholder="MR 제목 검색"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="mr-select-filters">
            <div className="toolbar-toggle">
              {STATE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`btn btn-sm ${filter.state === o.value ? 'btn-active' : ''}`}
                  onClick={() => updateFilter({ ...filter, state: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <label className="mr-select-mine">
              <input
                type="checkbox"
                checked={filter.mine}
                onChange={(e) => updateFilter({ ...filter, mine: e.target.checked })}
              />
              내가 올린 MR
            </label>
          </div>
          <div className="ref-select-list">
            {error && <div className="ref-select-empty mr-select-error">{error}</div>}
            {!error && loading && mrs.length === 0 && <div className="ref-select-empty">불러오는 중</div>}
            {!error && !loading && mrs.length === 0 && <div className="ref-select-empty">MR이 없습니다</div>}
            {mrs.map((mr) => (
              <button
                key={mr.iid}
                className={`mr-select-item ${mr.iid === value ? 'ref-select-item-active' : ''}`}
                onClick={() => select(mr.iid)}
              >
                <span className="mr-select-title">
                  !{mr.iid} {mr.title}
                  {mrStateBadge(mr.state) && <span className="mr-badge">{mrStateBadge(mr.state)}</span>}
                </span>
                <span className="mr-select-meta">
                  <span>{mr.sourceBranch} → {mr.targetBranch}</span>
                  <span>{mr.author}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
