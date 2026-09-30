export interface DefinitionRequest {
  path: string
  side: 'additions' | 'deletions'
  line: number
  col: number
}

export type DefinitionVersion = 'new' | 'old'

export interface DefinitionTarget {
  path: string
  line: number
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

export function definitionAction(res: DefinitionResponse | null): DefinitionAction {
  if (!res) return { type: 'message', text: '정의를 찾는 중 오류가 났습니다' }
  if (res.kind === 'self') return { type: 'message', text: '이미 정의 위치입니다' }
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
