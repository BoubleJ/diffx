type Side = 'additions' | 'deletions'

function matches(el: Element, target: string, side: Side): boolean {
  const type = el.getAttribute('data-line-type')
  if (type === 'change-addition') return side === 'additions' && el.getAttribute('data-line') === target
  if (type === 'change-deletion') return side === 'deletions' && el.getAttribute('data-line') === target
  if (type !== 'context' && type !== 'context-expanded') return false
  if (el.getAttribute('data-line') === target) return true
  return side === 'deletions' && el.getAttribute('data-alt-line') === target
}

export function findLineElement(root: ParentNode, line: number, side: Side): Element | null {
  const stack: ParentNode[] = [root]
  const target = String(line)
  while (stack.length > 0) {
    const node = stack.pop()!
    for (const child of Array.from(node.children)) {
      if (matches(child, target, side)) return child
      if (child.shadowRoot) stack.push(child.shadowRoot)
      stack.push(child)
    }
  }
  return null
}
