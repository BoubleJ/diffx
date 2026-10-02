export type LineSide = 'additions' | 'deletions'

export interface LineInfo {
  type: string
  line: number
  altLine: number | null
  column: 'additions' | 'deletions' | 'unified' | null
}

export interface ElementLike {
  parentElement: ElementLike | null
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
}

function startElement(node: unknown): ElementLike | null {
  if (!node || typeof node !== 'object') return null
  if (typeof (node as ElementLike).getAttribute === 'function') return node as ElementLike
  return (node as { parentElement?: ElementLike | null }).parentElement ?? null
}

export function lineInfoFrom(node: unknown): LineInfo | null {
  let lineEl: ElementLike | null = null
  let column: LineInfo['column'] = null
  for (let cur = startElement(node); cur; cur = cur.parentElement) {
    if (!lineEl) {
      if (cur.hasAttribute('data-line-type')) lineEl = cur
      continue
    }
    if (cur.hasAttribute('data-deletions')) column = 'deletions'
    else if (cur.hasAttribute('data-additions')) column = 'additions'
    else if (cur.hasAttribute('data-unified')) column = 'unified'
    if (column) break
  }
  if (!lineEl) return null
  const line = Number(lineEl.getAttribute('data-line'))
  if (!Number.isInteger(line) || line < 1) return null
  const alt = Number(lineEl.getAttribute('data-alt-line'))
  return { type: lineEl.getAttribute('data-line-type') ?? '', line, altLine: Number.isInteger(alt) && alt > 0 ? alt : null, column }
}

function sideOf(info: LineInfo): LineSide | null {
  if (info.type === 'change-addition') return 'additions'
  if (info.type === 'change-deletion') return 'deletions'
  if (info.type === 'context' || info.type === 'context-expanded') return info.column === 'deletions' ? 'deletions' : 'additions'
  return null
}

function lineOn(info: LineInfo, side: LineSide): number | null {
  return sideOf(info) === side ? info.line : info.altLine
}

const isSplit = (column: LineInfo['column']) => column === 'additions' || column === 'deletions'

export function selectedLines(start: LineInfo, end: LineInfo): { side: LineSide; startLine: number; endLine: number } | null {
  if (isSplit(start.column) && isSplit(end.column) && start.column !== end.column) return null
  const startSide = sideOf(start)
  const endSide = sideOf(end)
  if (!startSide || !endSide) return null
  const side: LineSide = startSide === endSide ? startSide : 'additions'
  const first = lineOn(start, side) ?? lineOn(end, side)
  const last = lineOn(end, side) ?? lineOn(start, side)
  if (first === null || last === null) return null
  return { side, startLine: Math.min(first, last), endLine: Math.max(first, last) }
}

export function formatSelectionLocation(s: { path: string; startLine: number; endLine: number }): string {
  return s.startLine === s.endLine ? `${s.path}:${s.startLine}` : `${s.path}:${s.startLine}-${s.endLine}`
}

export function sideLabel(side: LineSide): string {
  return side === 'additions' ? '변경 후 코드' : '변경 전 코드'
}

export function trimSelectedCode(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}
