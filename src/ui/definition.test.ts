import { describe, it, expect } from 'vitest'
import { definitionAction } from './definition'

describe('definitionAction', () => {
  it('jumps to a single target and lets the user choose among several', () => {
    expect(definitionAction({ kind: 'found', version: 'new', targets: [{ path: 'a.ts', line: 3 }] }))
      .toEqual({ type: 'jump', target: { path: 'a.ts', line: 3 }, version: 'new' })
    expect(definitionAction({ kind: 'found', version: 'old', targets: [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }] }))
      .toEqual({ type: 'choose', targets: [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }], version: 'old' })
  })

  it('shows a message for the other results', () => {
    expect(definitionAction({ kind: 'self' })).toEqual({ type: 'message', text: '이미 정의 위치입니다' })
    expect(definitionAction({ kind: 'external', module: 'react' })).toEqual({ type: 'message', text: '외부 패키지는 이동하지 않습니다' })
    expect(definitionAction({ kind: 'not_found' })).toEqual({ type: 'message', text: '정의를 찾지 못했습니다' })
    expect(definitionAction({ kind: 'found', version: 'new', targets: [] })).toEqual({ type: 'message', text: '정의를 찾지 못했습니다' })
    expect(definitionAction(null)).toEqual({ type: 'message', text: '정의를 찾는 중 오류가 났습니다' })
  })
})
