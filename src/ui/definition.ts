export interface DefinitionRequest {
  path: string
  side: 'additions' | 'deletions'
  line: number
  col: number
  name?: string
}

export type DefinitionVersion = 'new' | 'old'

export interface DefinitionTarget {
  path: string
  line: number
  text?: string
}

export type DefinitionResponse =
  | { kind: 'found'; version: DefinitionVersion; targets: DefinitionTarget[] }
  | { kind: 'self' }
  | { kind: 'external'; module: string }
  | { kind: 'not_found' }

export type DefinitionAction =
  | { type: 'jump'; target: DefinitionTarget; version: DefinitionVersion }
  | { type: 'choose'; targets: DefinitionTarget[]; version: DefinitionVersion }
  | { type: 'message'; text: string }
  | { type: 'references' }

export function definitionAction(res: DefinitionResponse | null): DefinitionAction {
  if (!res) return { type: 'message', text: '정의를 찾는 중 오류가 났습니다' }
  if (res.kind === 'self') return { type: 'references' }
  if (res.kind === 'external') return { type: 'message', text: '외부 패키지는 이동하지 않습니다' }
  if (res.kind === 'not_found' || res.targets.length === 0) return { type: 'message', text: '정의를 찾지 못했습니다' }
  if (res.targets.length === 1) return { type: 'jump', target: res.targets[0], version: res.version }
  return { type: 'choose', targets: res.targets, version: res.version }
}

export async function fetchDefinition(contentQuery: string, req: DefinitionRequest): Promise<DefinitionResponse> {
  const q = new URLSearchParams(contentQuery)
  q.set('path', req.path)
  q.set('side', req.side)
  q.set('line', String(req.line))
  q.set('col', String(req.col))
  const res = await fetch(`/api/definition?${q}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export type ReferencesRequest =
  | { path: string; side: 'additions' | 'deletions'; line: number; col: number }
  | { path: string; side: 'additions' | 'deletions'; scope: 'file' }

export type ReferencesResponse =
  | { kind: 'found'; name: string; version: DefinitionVersion; references: { path: string; line: number; text: string }[]; truncated: boolean }
  | { kind: 'not_declaration' }

export async function fetchReferences(contentQuery: string, req: ReferencesRequest): Promise<ReferencesResponse> {
  const q = new URLSearchParams(contentQuery)
  q.set('path', req.path)
  q.set('side', req.side)
  if ('scope' in req) {
    q.set('scope', req.scope)
  } else {
    q.set('line', String(req.line))
    q.set('col', String(req.col))
  }
  const res = await fetch(`/api/references?${q}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface ExploreItem {
  path: string
  line: number
  text?: string
}

export type ExploreState =
  | { status: 'idle' }
  | { status: 'loading'; title: string }
  | { status: 'error'; title: string }
  | { status: 'ready'; title: string; items: ExploreItem[]; truncated: boolean; version: DefinitionVersion }

export function groupByFile(items: ExploreItem[]): { path: string; items: ExploreItem[] }[] {
  const groups = new Map<string, ExploreItem[]>()
  for (const item of items) {
    const list = groups.get(item.path) ?? []
    list.push(item)
    groups.set(item.path, list)
  }
  return [...groups].map(([path, list]) => ({ path, items: list }))
}

export const exploreTitle = {
  references: (name: string) => `${name} 사용처`,
  candidates: (name: string) => `${name} 정의 후보`,
  importers: (name: string) => `${name}을 import하는 곳`,
}
