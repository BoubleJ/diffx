import { isSafePath } from '../path.js'
import { MAX_SELECTION_CHARS, type CodeSelection } from './types.js'

export type SelectionParse =
  | { ok: true; selection: CodeSelection | undefined }
  | { ok: false; error: 'invalid_selection' | 'selection_too_long'; message: string }

const INVALID: SelectionParse = { ok: false, error: 'invalid_selection', message: '선택한 코드 정보가 올바르지 않습니다' }

const isLine = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

export function parseSelection(value: unknown, repo: string): SelectionParse {
  if (value === undefined || value === null) return { ok: true, selection: undefined }
  if (typeof value !== 'object') return INVALID
  const { path, side, startLine, endLine, code } = value as Record<string, unknown>
  if (typeof path !== 'string' || !path || !isSafePath(path, repo)) return INVALID
  if (side !== 'additions' && side !== 'deletions') return INVALID
  if (!isLine(startLine) || !isLine(endLine) || startLine > endLine) return INVALID
  if (typeof code !== 'string' || !code.trim()) return INVALID
  if (code.length > MAX_SELECTION_CHARS) return { ok: false, error: 'selection_too_long', message: '선택한 코드는 4000자까지 보낼 수 있습니다' }
  return { ok: true, selection: { path, side, startLine, endLine, code } }
}
