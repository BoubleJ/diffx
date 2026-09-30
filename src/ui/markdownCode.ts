export type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export function codeLanguage(className: string | undefined): string | null {
  const match = /(?:^|\s)language-(\S+)/.exec(className ?? '')
  return match ? match[1].toLowerCase() : null
}

export function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}
