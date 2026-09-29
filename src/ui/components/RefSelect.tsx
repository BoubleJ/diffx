import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface RefSelectProps {
  label: string
  value: string
  local: string[]
  remote: string[]
  onChange: (ref: string) => void
}

export function RefSelect({ label, value, local, remote, onChange }: RefSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const filter = (list: string[]) => {
    const q = query.trim().toLowerCase()
    return q ? list.filter((b) => b.toLowerCase().includes(q)) : list
  }
  const groups = useMemo(
    () => [
      { title: '로컬', items: filter(local) },
      { title: '원격', items: filter(remote) },
    ],
    [local, remote, query],
  )

  const select = (ref: string) => {
    onChange(ref)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="ref-select" ref={rootRef}>
      <button className="btn btn-sm ref-select-button" onClick={() => setOpen(!open)} title={label}>
        <span className="ref-select-label">{label}</span>
        <span className="ref-select-value">{value || '선택'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ref-select-menu">
          <input
            className="ref-select-search"
            autoFocus
            placeholder="브랜치 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ref-select-list">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="ref-select-group">{g.title}</div>
                {g.items.length === 0 && <div className="ref-select-empty">없음</div>}
                {g.items.map((b) => (
                  <button
                    key={`${g.title}:${b}`}
                    className={`ref-select-item ${b === value ? 'ref-select-item-active' : ''}`}
                    onClick={() => select(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
