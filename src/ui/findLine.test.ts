import { describe, it, expect } from 'vitest'
import { findLineElement } from './findLine'

type FakeEl = { attrs: Record<string, string>; children: FakeEl[]; shadowRoot?: { children: FakeEl[] } }

const el = (attrs: Record<string, string>, children: FakeEl[] = [], shadow?: FakeEl[]): FakeEl =>
  ({ attrs, children, shadowRoot: shadow ? { children: shadow } : undefined })

function adapt(node: FakeEl | { children: FakeEl[] }): ParentNode {
  const wrap = (n: FakeEl): Element => ({
    getAttribute: (k: string) => n.attrs[k] ?? null,
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

  it('accepts context lines by data-line and returns null when missing', () => {
    const root = { children: [el({ 'data-line': '3', 'data-line-type': 'context' })] }
    expect(findLineElement(adapt(root), 3, 'deletions')).not.toBeNull()
    expect(findLineElement(adapt(root), 4, 'deletions')).toBeNull()
  })

  it('matches unified context lines on the deletions side by data-alt-line', () => {
    const root = { children: [el({ 'data-line': '5', 'data-alt-line': '3', 'data-line-type': 'context' })] }
    expect(findLineElement(adapt(root), 3, 'deletions')).not.toBeNull()
    expect(findLineElement(adapt(root), 3, 'additions')).toBeNull()
  })

  it('ignores gutter items that only carry data-column-number', () => {
    const root = { children: [el({ 'data-column-number': '7', 'data-line-type': 'change-addition' })] }
    expect(findLineElement(adapt(root), 7, 'additions')).toBeNull()
  })
})
