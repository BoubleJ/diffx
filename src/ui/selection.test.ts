import { describe, it, expect } from 'vitest'
import { formatSelectionLocation, lineInfoFrom, selectedLines, sideLabel, trimSelectedCode, type ElementLike, type LineInfo } from './selection'

const info = (type: string, line: number, column: LineInfo['column'], altLine: number | null = null): LineInfo => ({ type, line, altLine, column })

function el(attrs: Record<string, string>, parent: ElementLike | null = null): ElementLike {
  return {
    parentElement: parent,
    hasAttribute: (name) => name in attrs,
    getAttribute: (name) => attrs[name] ?? null,
  }
}

describe('selectedLines', () => {
  it('uses the line numbers of added and deleted lines', () => {
    expect(selectedLines(info('change-addition', 12, 'unified'), info('change-addition', 13, 'unified'))).toEqual({ side: 'additions', startLine: 12, endLine: 13 })
    expect(selectedLines(info('change-deletion', 4, 'deletions'), info('change-deletion', 6, 'deletions'))).toEqual({ side: 'deletions', startLine: 4, endLine: 6 })
  })

  it('takes the side of context lines from the split column', () => {
    expect(selectedLines(info('context', 7, 'deletions', 9), info('context', 8, 'deletions', 10))).toEqual({ side: 'deletions', startLine: 7, endLine: 8 })
    expect(selectedLines(info('context-expanded', 9, 'additions', 7), info('context', 10, 'additions', 8))).toEqual({ side: 'additions', startLine: 9, endLine: 10 })
  })

  it('reads unified context lines as the additions side', () => {
    expect(selectedLines(info('context', 20, 'unified', 18), info('context', 21, null, 19))).toEqual({ side: 'additions', startLine: 20, endLine: 21 })
  })

  it('uses the additions side across a deletion and an addition in unified view', () => {
    expect(selectedLines(info('change-deletion', 5, 'unified', 6), info('change-addition', 7, 'unified'))).toEqual({ side: 'additions', startLine: 6, endLine: 7 })
    expect(selectedLines(info('change-deletion', 5, 'unified'), info('change-addition', 7, 'unified'))).toEqual({ side: 'additions', startLine: 7, endLine: 7 })
  })

  it('returns null across the two split columns', () => {
    expect(selectedLines(info('context', 3, 'deletions'), info('context', 3, 'additions'))).toBeNull()
  })

  it('orders lines when dragging upward', () => {
    expect(selectedLines(info('change-addition', 30, 'unified'), info('context', 25, 'unified'))).toEqual({ side: 'additions', startLine: 25, endLine: 30 })
  })
})

describe('lineInfoFrom', () => {
  it('reads the nearest line element and its column from a text node', () => {
    const column = el({ 'data-deletions': '' })
    const line = el({ 'data-line-type': 'context', 'data-line': '7', 'data-alt-line': '9' }, column)
    const span = el({}, line)
    const text = { parentElement: span }
    expect(lineInfoFrom(text)).toEqual({ type: 'context', line: 7, altLine: 9, column: 'deletions' })
  })

  it('returns null outside a line element', () => {
    const header = el({ 'data-diffs-header': '' })
    expect(lineInfoFrom({ parentElement: header })).toBeNull()
    expect(lineInfoFrom(null)).toBeNull()
  })
})

describe('selection labels', () => {
  it('formats the location and the side', () => {
    expect(formatSelectionLocation({ path: 'src/cart.ts', startLine: 12, endLine: 13 })).toBe('src/cart.ts:12-13')
    expect(formatSelectionLocation({ path: 'src/cart.ts', startLine: 12, endLine: 12 })).toBe('src/cart.ts:12')
    expect(sideLabel('additions')).toBe('변경 후 코드')
    expect(sideLabel('deletions')).toBe('변경 전 코드')
  })

  it('removes blank lines around the selected code', () => {
    expect(trimSelectedCode('\n  \nconst a = 1\n  b()\n\n')).toBe('const a = 1\n  b()')
  })
})
