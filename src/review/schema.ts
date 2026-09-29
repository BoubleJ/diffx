import type { Finding, ReviewResult, Severity } from './types.js'

const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'info']

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'line', 'side', 'title', 'body'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          side: { type: 'string', enum: ['old', 'new'] },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
} as const

function toFinding(value: unknown): Finding | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!SEVERITIES.includes(v.severity as Severity)) return null
  if (typeof v.file !== 'string' || typeof v.title !== 'string' || typeof v.body !== 'string') return null
  if (v.side !== 'old' && v.side !== 'new') return null
  if (v.line !== null && !Number.isInteger(v.line)) return null
  return { severity: v.severity as Severity, file: v.file, line: v.line as number | null, side: v.side, title: v.title, body: v.body }
}

export function validateResult(value: unknown): ReviewResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.summary !== 'string' || !Array.isArray(v.findings)) return null
  const findings: Finding[] = []
  for (const item of v.findings) {
    const f = toFinding(item)
    if (!f) return null
    findings.push(f)
  }
  return { summary: v.summary, findings }
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function extractJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct

  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fence) {
    const fenced = tryParse(fence[1])
    if (fenced !== undefined) return fenced
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    return tryParse(trimmed.slice(start, end + 1))
  }
  return undefined
}
