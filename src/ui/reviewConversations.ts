import { comparisonFromKey } from './comparison'

export interface ConversationItem {
  key: string
  questionCount: number
  lastAt: number
  running: boolean
}

export function conversationLabel(key: string): string {
  const comparison = comparisonFromKey(key)
  if (!comparison) return key
  return comparison.mode === 'mr' ? `MR !${comparison.iid}` : `${comparison.source} → ${comparison.target}`
}

export function formatLastAt(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseRetentionInput(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const days = Number(trimmed)
  return days === 0 ? null : days
}
