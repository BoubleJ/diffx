import type { FileDiffMetadata } from '@pierre/diffs'

export interface RepoTreeNode {
  name: string
  path: string
  isDir: boolean
  children: RepoTreeNode[]
}

export type ChangeMark = 'A' | 'M'

export function buildRepoTree(paths: string[]): RepoTreeNode[] {
  const root: RepoTreeNode[] = []
  const dirs = new Map<string, RepoTreeNode>()

  for (const filePath of paths) {
    const parts = filePath.split('/')
    let siblings = root
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let dir = dirs.get(path)
      if (!dir) {
        dir = { name: parts[i], path, isDir: true, children: [] }
        dirs.set(path, dir)
        siblings.push(dir)
      }
      siblings = dir.children
    }
    siblings.push({ name: parts[parts.length - 1], path: filePath, isDir: false, children: [] })
  }

  const sortNodes = (nodes: RepoTreeNode[]) => {
    nodes.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
    for (const node of nodes) if (node.isDir) sortNodes(node.children)
  }
  sortNodes(root)
  return root
}

const ZERO_OID = /^0+$/

export function changeMarks(files: FileDiffMetadata[]): Map<string, ChangeMark> {
  const marks = new Map<string, ChangeMark>()
  for (const file of files) {
    if (file.newObjectId && ZERO_OID.test(file.newObjectId)) continue
    const added = !file.prevName && !!file.prevObjectId && ZERO_OID.test(file.prevObjectId)
    marks.set(file.name, added ? 'A' : 'M')
  }
  return marks
}

export function expandedDirsFor(paths: Iterable<string>): Set<string> {
  const dirs = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return dirs
}

export function filterRepoPaths(paths: string[], query: string, limit: number): { paths: string[]; truncated: boolean } {
  const lower = query.trim().toLowerCase()
  const matched: string[] = []
  for (const path of paths) {
    if (!path.toLowerCase().includes(lower)) continue
    if (matched.length === limit) return { paths: matched, truncated: true }
    matched.push(path)
  }
  return { paths: matched, truncated: false }
}
