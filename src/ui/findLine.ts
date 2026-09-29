type Side = 'additions' | 'deletions'
type Column = Side | 'unified' | null

function columnOf(el: Element, inherited: Column): Column {
  if (el.hasAttribute('data-deletions')) return 'deletions'
  if (el.hasAttribute('data-additions')) return 'additions'
  if (el.hasAttribute('data-unified')) return 'unified'
  return inherited
}

// data-line은 그 요소가 속한 컬럼의 줄 번호이고 data-alt-line은 반대쪽 번호다.
// unified 보기의 context 줄은 추가 쪽 정보로 그려져 data-line이 새 번호, data-alt-line이 옛 번호다.
function matches(el: Element, target: string, side: Side, column: Column): boolean {
  const type = el.getAttribute('data-line-type')
  const line = el.getAttribute('data-line')
  if (type === 'change-addition') return side === 'additions' && line === target
  if (type === 'change-deletion') return side === 'deletions' && line === target
  if (type !== 'context' && type !== 'context-expanded') return false
  if (column === 'additions' || column === 'deletions') return column === side && line === target
  return side === 'additions' ? line === target : el.getAttribute('data-alt-line') === target
}

export function findLineElement(root: ParentNode, line: number, side: Side): Element | null {
  const target = String(line)
  const stack: { el: Element; column: Column }[] = []
  const pushChildren = (node: ParentNode, column: Column) => {
    const children = Array.from(node.children)
    for (let i = children.length - 1; i >= 0; i--) stack.push({ el: children[i], column })
  }
  pushChildren(root, null)
  while (stack.length > 0) {
    const { el, column: inherited } = stack.pop()!
    const column = columnOf(el, inherited)
    if (matches(el, target, side, column)) return el
    pushChildren(el, column)
    if (el.shadowRoot) pushChildren(el.shadowRoot, column)
  }
  return null
}
