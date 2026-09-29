import { useState } from 'react'
import { ChevronRight, EyeOff } from 'lucide-react'

interface ExcludedFilesProps {
  paths: string[]
  onInclude: (filePath: string) => void
}

export function ExcludedFiles({ paths, onInclude }: ExcludedFilesProps) {
  const [open, setOpen] = useState(false)
  if (paths.length === 0) return null

  return (
    <div className="ex">
      <button className="ex-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={14} className={`ft-chevron ${open ? 'ft-chevron-expanded' : ''}`} />
        <EyeOff size={14} />
        <span>제외된 파일 {paths.length}개</span>
      </button>
      {open && (
        <ul className="ex-list">
          {paths.map((path) => (
            <li key={path} className="ex-item">
              <span className="ex-path" title={path}>{path}</span>
              <button className="btn btn-sm" onClick={() => onInclude(path)}>다시 포함</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
