import { useMemo, useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen, PanelLeftClose, Search } from 'lucide-react'
import { buildRepoTree, expandedDirsFor, filterRepoPaths, type ChangeMark, type RepoTreeNode } from '../repoTree'

const FILTER_LIMIT = 300

export type RepoTreeState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; files: string[] }

interface RepoFileTreeProps {
  state: RepoTreeState
  marks: Map<string, ChangeMark>
  activePath: string | null
  onOpen: (path: string) => void
  onToggleCollapse: () => void
}

function FileRow({ path, label, depth, mark, active, onOpen }: { path: string; label: string; depth: number; mark?: ChangeMark; active: boolean; onOpen: (path: string) => void }) {
  return (
    <li>
      <div
        className={`ft-row ft-file ${active ? 'ft-file-active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16 + 20}px` }}
        onClick={() => onOpen(path)}
        title={path}
      >
        <File size={16} className="ft-icon" />
        <span className="ft-file-name">{label}</span>
        {mark && <span className={`rft-mark ${mark === 'A' ? 'rft-mark-added' : 'rft-mark-modified'}`}>{mark}</span>}
      </div>
    </li>
  )
}

function TreeNodes({ nodes, depth, expanded, onToggle, marks, activePath, onOpen }: {
  nodes: RepoTreeNode[]
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  marks: Map<string, ChangeMark>
  activePath: string | null
  onOpen: (path: string) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        if (!node.isDir) {
          return <FileRow key={node.path} path={node.path} label={node.name} depth={depth} mark={marks.get(node.path)} active={activePath === node.path} onOpen={onOpen} />
        }
        const open = expanded.has(node.path)
        return (
          <li key={node.path}>
            <div className="ft-row ft-dir" style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => onToggle(node.path)}>
              <ChevronRight size={14} className={`ft-chevron ${open ? 'ft-chevron-expanded' : ''}`} />
              {open ? <FolderOpen size={16} className="ft-icon ft-folder-icon" /> : <Folder size={16} className="ft-icon ft-folder-icon" />}
              <span className="ft-dir-name">{node.name}</span>
            </div>
            {open && (
              <ul className="ft-list">
                <TreeNodes nodes={node.children} depth={depth + 1} expanded={expanded} onToggle={onToggle} marks={marks} activePath={activePath} onOpen={onOpen} />
              </ul>
            )}
          </li>
        )
      })}
    </>
  )
}

export function RepoFileTree({ state, marks, activePath, onOpen, onToggleCollapse }: RepoFileTreeProps) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(() => expandedDirsFor(marks.keys()))
  const files = state.status === 'ready' ? state.files : null
  const tree = useMemo(() => (files ? buildRepoTree(files) : []), [files])
  const filtered = useMemo(() => (files && filter.trim() ? filterRepoPaths(files, filter, FILTER_LIMIT) : null), [files, filter])

  const toggle = (path: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  return (
    <div className="ft">
      <div className="ft-search">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title="Collapse sidebar" aria-label="Collapse sidebar">
          <PanelLeftClose size={16} />
        </button>
        <div className="ft-search-wrapper">
          <Search size={14} className="ft-search-icon" />
          <input type="text" placeholder="파일 경로 검색" value={filter} onChange={(e) => setFilter(e.target.value)} className="ft-search-input" />
        </div>
      </div>
      {state.status === 'loading' && <p className="rft-message">파일 목록을 불러오는 중입니다</p>}
      {state.status === 'error' && <p className="rft-message">파일 목록을 불러오지 못했습니다</p>}
      {filtered ? (
        <>
          <ul className="ft-list ft-root">
            {filtered.paths.map((path) => (
              <FileRow key={path} path={path} label={path} depth={0} mark={marks.get(path)} active={activePath === path} onOpen={onOpen} />
            ))}
          </ul>
          {filtered.paths.length === 0 && <p className="rft-message">일치하는 파일이 없습니다</p>}
          {filtered.truncated && <p className="rft-message">검색 결과가 많아 {FILTER_LIMIT}개까지만 보여줍니다</p>}
        </>
      ) : (
        <ul className="ft-list ft-root">
          <TreeNodes nodes={tree} depth={0} expanded={expanded} onToggle={toggle} marks={marks} activePath={activePath} onOpen={onOpen} />
        </ul>
      )}
    </div>
  )
}
