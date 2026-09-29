import { describe, it, expect } from 'vitest'
import { findLineElement } from './findLine'

type FakeEl = { attrs: Record<string, string>; children: FakeEl[]; shadowRoot?: { children: FakeEl[] } }

const el = (attrs: Record<string, string>, children: FakeEl[] = [], shadow?: FakeEl[]): FakeEl =>
  ({ attrs, children, shadowRoot: shadow ? { children: shadow } : undefined })

function adapt(node: FakeEl | { children: FakeEl[] }): ParentNode {
  const wrap = (n: FakeEl): Element => ({
    getAttribute: (k: string) => n.attrs[k] ?? null,
    hasAttribute: (k: string) => k in n.attrs,
    get children() { return n.children.map(wrap) as unknown as HTMLCollection },
    get shadowRoot() { return n.shadowRoot ? (adapt(n.shadowRoot) as ShadowRoot) : null },
  }) as unknown as Element
  return { get children() { return node.children.map(wrap) as unknown as HTMLCollection } } as unknown as ParentNode
}

describe('findLineElement', () => {
  it('finds the line on the requested side inside shadow roots', () => {
    const root = { children: [el({}, [], [
      el({ 'data-line': '12', 'data-line-type': 'change-deletion' }),
      el({ 'data-line': '12', 'data-line-type': 'change-addition' }),
    ])] }
    const found = findLineElement(adapt(root), 12, 'additions')
    expect(found?.getAttribute('data-line-type')).toBe('change-addition')
    expect(findLineElement(adapt(root), 12, 'deletions')?.getAttribute('data-line-type')).toBe('change-deletion')
  })

  it('returns null when the line is missing', () => {
    const root = { children: [el({ 'data-line': '3', 'data-line-type': 'context' })] }
    expect(findLineElement(adapt(root), 4, 'additions')).toBeNull()
  })

  it('in split view only accepts context lines inside the requested side column', () => {
    const root = { children: [
      el({ 'data-code': '', 'data-deletions': '' }, [
        el({ 'data-line': '5', 'data-alt-line': '9', 'data-line-type': 'context', id: 'del' }),
      ]),
      el({ 'data-code': '', 'data-additions': '' }, [
        el({ 'data-line': '5', 'data-alt-line': '2', 'data-line-type': 'context', id: 'add' }),
      ]),
    ] }
    expect(findLineElement(adapt(root), 5, 'additions')?.getAttribute('id')).toBe('add')
    expect(findLineElement(adapt(root), 5, 'deletions')?.getAttribute('id')).toBe('del')
    expect(findLineElement(adapt(root), 9, 'additions')).toBeNull()
  })

  it('in unified view matches context by data-line for additions and data-alt-line for deletions', () => {
    const root = { children: [el({ 'data-unified': '' }, [
      el({ 'data-line': '5', 'data-alt-line': '3', 'data-line-type': 'context', id: 'a' }),
      el({ 'data-line': '3', 'data-alt-line': '1', 'data-line-type': 'context', id: 'b' }),
    ])] }
    expect(findLineElement(adapt(root), 3, 'additions')?.getAttribute('id')).toBe('b')
    expect(findLineElement(adapt(root), 3, 'deletions')?.getAttribute('id')).toBe('a')
  })

  it('returns the first match in document order', () => {
    const root = { children: [
      el({ 'data-line': '1', 'data-line-type': 'change-addition', id: 'first' }),
      el({ 'data-line': '1', 'data-line-type': 'change-addition', id: 'second' }),
    ] }
    expect(findLineElement(adapt(root), 1, 'additions')?.getAttribute('id')).toBe('first')
  })

  it('ignores gutter items that only carry data-column-number', () => {
    const root = { children: [el({ 'data-column-number': '7', 'data-line-type': 'change-addition' })] }
    expect(findLineElement(adapt(root), 7, 'additions')).toBeNull()
  })
})
