import { useEffect, useMemo, useRef, useState } from 'react'
import { ListFilter } from 'lucide-react'
import { checkState, groupFileKinds, type CheckState, type FileKindGroup } from '../fileKinds'

export interface FileKindActions {
  excluded: Set<string>
  viewed: Set<string>
  onExcludeMany: (paths: string[]) => void
  onIncludeMany: (paths: string[]) => void
  onViewedMany: (paths: string[], viewed: boolean) => void
}

function TriCheckbox({ label, state, disabled, onChange }: { label: string; state: CheckState; disabled?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === 'all'} disabled={disabled} onChange={onChange} />
}

function FileKindRow({ group, excluded, viewed, onExcludeMany, onIncludeMany, onViewedMany }: FileKindActions & { group: FileKindGroup }) {
  const excludeState = checkState(group.paths, excluded)
  const viewTargets = group.paths.filter((path) => !excluded.has(path))
  const viewState = checkState(viewTargets, viewed)
  return (
    <tr>
      <th scope="row">{group.label}</th>
      <td className="fk-count">{group.paths.length}개</td>
      <td className="fk-check">
        <TriCheckbox
          label={`${group.label} 리뷰 제외`}
          state={excludeState}
          onChange={() => (excludeState === 'all' ? onIncludeMany(group.paths) : onExcludeMany(group.paths))}
        />
      </td>
      <td className="fk-check">
        <TriCheckbox
          label={`${group.label} Viewed`}
          state={viewState}
          disabled={viewTargets.length === 0}
          onChange={() =>
            viewState === 'all'
              ? onViewedMany(viewTargets, false)
              : onViewedMany(viewTargets.filter((path) => !viewed.has(path)), true)
          }
        />
      </td>
    </tr>
  )
}

export function FileKindTable({ groups, ...actions }: FileKindActions & { groups: FileKindGroup[] }) {
  return (
    <table className="fk-table">
      <thead>
        <tr>
          <th className="fk-title" colSpan={2}>파일 종류</th>
          <th className="fk-check">리뷰 제외</th>
          <th className="fk-check">Viewed</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <FileKindRow key={group.kind} group={group} {...actions} />
        ))}
      </tbody>
    </table>
  )
}

export function FileKindPopover({ paths, ...actions }: FileKindActions & { paths: string[] }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupFileKinds(paths), [paths])

  useEffect(() => {
    if (!anchor) return
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAnchor(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnchor(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchor])

  return (
    <div className="fk" ref={ref}>
      <button
        type="button"
        className={`sidebar-toggle ${anchor ? 'fk-btn-open' : ''}`}
        title="파일 종류별 처리"
        aria-label="파일 종류별 처리"
        aria-expanded={anchor !== null}
        disabled={paths.length === 0}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <ListFilter size={16} />
      </button>
      {anchor && (
        <div className="fk-popover" style={{ top: anchor.bottom + 4, left: anchor.left }}>
          <FileKindTable groups={groups} {...actions} />
        </div>
      )}
    </div>
  )
}
