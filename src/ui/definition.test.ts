import { describe, it, expect } from 'vitest'
import { definitionAction, groupByFile, exploreTitle } from './definition'

describe('definitionAction', () => {
  it('jumps to a single target and lets the user choose among several', () => {
    expect(definitionAction({ kind: 'found', version: 'new', targets: [{ path: 'a.ts', line: 3 }] }))
      .toEqual({ type: 'jump', target: { path: 'a.ts', line: 3 }, version: 'new' })
    expect(definitionAction({ kind: 'found', version: 'old', targets: [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }] }))
      .toEqual({ type: 'choose', targets: [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }], version: 'old' })
  })

  it('shows a message for the other results', () => {
    expect(definitionAction({ kind: 'external', module: 'react' })).toEqual({ type: 'message', text: '외부 패키지는 이동하지 않습니다' })
    expect(definitionAction({ kind: 'not_found' })).toEqual({ type: 'message', text: '정의를 찾지 못했습니다' })
    expect(definitionAction({ kind: 'found', version: 'new', targets: [] })).toEqual({ type: 'message', text: '정의를 찾지 못했습니다' })
    expect(definitionAction(null)).toEqual({ type: 'message', text: '정의를 찾는 중 오류가 났습니다' })
  })

  it('opens references on the declaration itself', () => {
    expect(definitionAction({ kind: 'self' })).toEqual({ type: 'references' })
  })
})

describe('groupByFile', () => {
  it('groups items by path in first-seen order', () => {
    expect(groupByFile([{ path: 'b.ts', line: 1 }, { path: 'a.ts', line: 2 }, { path: 'b.ts', line: 5 }])).toEqual([
      { path: 'b.ts', items: [{ path: 'b.ts', line: 1 }, { path: 'b.ts', line: 5 }] },
      { path: 'a.ts', items: [{ path: 'a.ts', line: 2 }] },
    ])
  })
})

describe('exploreTitle', () => {
  it('builds panel titles', () => {
    expect(exploreTitle.references('useComments')).toBe('useComments 사용처')
    expect(exploreTitle.candidates('format')).toBe('format 정의 후보')
    expect(exploreTitle.importers('App')).toBe('App을 import하는 곳')
  })
})
