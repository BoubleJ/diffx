export const TEST_KIND = 'test'

export type CheckState = 'all' | 'some' | 'none'

export interface FileKindGroup {
  kind: string
  label: string
  paths: string[]
}

export function fileKind(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (/\.(test|spec)\./.test(name) || /(^|\/)__tests__\//.test(path)) return TEST_KIND
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function kindLabel(kind: string): string {
  if (kind === TEST_KIND) return '테스트 파일'
  if (kind === '') return '확장자 없음'
  return kind
}

function kindRank(kind: string): number {
  if (kind === TEST_KIND) return 0
  if (kind === '') return 2
  return 1
}

export function groupFileKinds(paths: string[]): FileKindGroup[] {
  const byKind = new Map<string, string[]>()
  for (const path of paths) {
    const kind = fileKind(path)
    const list = byKind.get(kind)
    if (list) list.push(path)
    else byKind.set(kind, [path])
  }
  return [...byKind]
    .map(([kind, list]) => ({ kind, label: kindLabel(kind), paths: list }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.paths.length - a.paths.length || a.label.localeCompare(b.label))
}

export function checkState(paths: string[], selected: Set<string>): CheckState {
  const count = paths.filter((path) => selected.has(path)).length
  if (count === 0) return 'none'
  return count === paths.length ? 'all' : 'some'
}
