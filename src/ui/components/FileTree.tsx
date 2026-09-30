import { useState, useMemo } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  FilePlus,
  FileMinus,
  FileDiff,
  FileEdit,
  FileCheck,
  MessageSquare,
  EyeOff,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { FileDiffMetadata } from '@pierre/diffs'

interface FileTreeProps {
  files: FileDiffMetadata[]
  activeFile: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  onFileClick: (filePath: string) => void
  onExclude: (filePath: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
  file?: FileDiffMetadata
}

function buildTree(files: FileDiffMetadata[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const file of files) {
    const parts = file.name.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const path = parts.slice(0, i + 1).join('/')
      const isDir = i < parts.length - 1

      let existing = current.find((n) => n.name === name && n.isDir === isDir)
      if (!existing) {
        existing = { name, path, isDir, children: [] }
        if (!isDir) existing.file = file
        current.push(existing)
      }
      current = existing.children
    }
  }

  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.isDir) sortNodes(node.children)
    }
  }
  sortNodes(root)

  return root
}

function inferChangeType(file: FileDiffMetadata): string {
  // parsePatchFiles doesn't always set changeType, infer from object IDs
  if (file.prevName) return 'rename-changed'
  const prev = file.prevObjectId
  const next = file.newObjectId
  if (prev === '0000000' || prev === '0000000000000000000000000000000000000000') return 'new'
  if (next === '0000000' || next === '0000000000000000000000000000000000000000') return 'deleted'
  return 'change'
}

function getFileIcon(file: FileDiffMetadata | undefined, viewed: boolean) {
  const size = 16
  if (viewed) {
    return <FileCheck size={size} className="ft-icon icon-viewed" />
  }
  const changeType = file ? inferChangeType(file) : 'change'
  switch (changeType) {
    case 'new':
      return <FilePlus size={size} className="ft-icon icon-added" />
    case 'deleted':
      return <FileMinus size={size} className="ft-icon icon-deleted" />
    case 'rename-pure':
    case 'rename-changed':
      return <FileEdit size={size} className="ft-icon icon-renamed" />
    default:
      return <FileDiff size={size} className="ft-icon icon-modified" />
  }
}

function TreeDir({
  node,
  activeFile,
  commentCounts,
  viewedFiles,
  onFileClick,
  onExclude,
  depth,
  defaultExpanded,
}: {
  node: TreeNode
  activeFile: string | null
  commentCounts: Record<string, number>
  viewedFiles: Set<string>
  onFileClick: (filePath: string) => void
  onExclude: (filePath: string) => void
  depth: number
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <li>
      <div
        className="ft-row ft-dir"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={14}
          className={`ft-chevron ${expanded ? 'ft-chevron-expanded' : ''}`}
        />
        {expanded ? (
          <FolderOpen size={16} className="ft-icon ft-folder-icon" />
        ) : (
          <Folder size={16} className="ft-icon ft-folder-icon" />
        )}
        <span className="ft-dir-name">{node.name}</span>
      </div>
      {expanded && (
        <ul className="ft-list">
          {node.children.map((child) =>
            child.isDir ? (
              <TreeDir
                key={child.path}
                node={child}
                activeFile={activeFile}
                commentCounts={commentCounts}
                viewedFiles={viewedFiles}
                onFileClick={onFileClick}
                onExclude={onExclude}
                depth={depth + 1}
                defaultExpanded={true}
              />
            ) : (
              <TreeFile
                key={child.path}
                node={child}
                activeFile={activeFile}
                commentCount={commentCounts[child.file?.name ?? ''] ?? 0}
                viewed={viewedFiles.has(child.file?.name ?? '')}
                onFileClick={onFileClick}
                onExclude={onExclude}
                depth={depth + 1}
              />
            ),
          )}
        </ul>
      )}
    </li>
  )
}

function TreeFile({
  node,
  activeFile,
  commentCount,
  viewed,
  onFileClick,
  onExclude,
  depth,
}: {
  node: TreeNode
  activeFile: string | null
  commentCount: number
  viewed: boolean
  onFileClick: (filePath: string) => void
  onExclude: (filePath: string) => void
  depth: number
}) {
  const filePath = node.file?.name ?? node.path
  const isActive = activeFile === filePath

  return (
    <li>
      <div
        className={`ft-row ft-file ${isActive ? 'ft-file-active' : ''} ${viewed ? 'ft-file-viewed' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16 + 20}px` }}
        onClick={() => onFileClick(filePath)}
        title={filePath}
      >
        {getFileIcon(node.file, viewed)}
        <span className="ft-file-name">{node.name}</span>
        {commentCount > 0 && (
          <span className="ft-comment-count">
            <MessageSquare size={14} />
            {commentCount}
          </span>
        )}
        <button
          className="ft-exclude-btn"
          title="제외"
          aria-label="제외"
          onClick={(e) => {
            e.stopPropagation()
            onExclude(filePath)
          }}
        >
          <EyeOff size={14} />
        </button>
      </div>
    </li>
  )
}

export function FileTree({ files, activeFile, commentCounts, viewedFiles, onFileClick, onExclude, collapsed, onToggleCollapse }: FileTreeProps) {
  const [filter, setFilter] = useState('')

  const filteredFiles = useMemo(() => {
    if (!filter) return files
    const lower = filter.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(lower))
  }, [files, filter])

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles])

  if (collapsed) {
    return (
      <div className="ft">
        <div className="ft-search">
          {onToggleCollapse && (
            <button
              className="sidebar-toggle"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="ft">
      <div className="ft-search">
        {onToggleCollapse && (
          <button
            className="sidebar-toggle"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
        <div className="ft-search-wrapper">
          <Search size={14} className="ft-search-icon" />
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ft-search-input"
          />
        </div>
      </div>
      <ul className="ft-list ft-root">
        {tree.map((node) =>
          node.isDir ? (
            <TreeDir
              key={node.path}
              node={node}
              activeFile={activeFile}
              commentCounts={commentCounts}
              viewedFiles={viewedFiles}
              onFileClick={onFileClick}
              onExclude={onExclude}
              depth={0}
              defaultExpanded={true}
            />
          ) : (
            <TreeFile
              key={node.path}
              node={node}
              activeFile={activeFile}
              commentCount={commentCounts[node.file?.name ?? ''] ?? 0}
              viewed={viewedFiles.has(node.file?.name ?? '')}
              onFileClick={onFileClick}
              onExclude={onExclude}
              depth={0}
            />
          ),
        )}
      </ul>
    </div>
  )
}
