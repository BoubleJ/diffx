import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DATA_DIR } from '../appData.js'
import type { ProviderId, ReviewLocation, ReviewResult, CodeSelection } from './types.js'

export type MessageKind = 'question' | 'review'

export interface ReviewMessage {
  id: string
  createdAt: number
  kind: MessageKind
  question: string | null
  fingerprint: string
  excluded?: string[]
  selection?: CodeSelection
  result: ReviewResult
}

export interface ReviewConversation {
  version: 2
  key: string
  provider: ProviderId
  providerLabel: string
  sessionId: string | null
  messages: ReviewMessage[]
}

export interface AppendInput {
  provider: ProviderId
  providerLabel: string
  sessionId: string
  message: ReviewMessage
}

export interface ConversationSummary {
  key: string
  questionCount: number
  lastAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function lastQuestionAt(conversation: ReviewConversation): number | null {
  if (conversation.messages.length === 0) return null
  return Math.max(...conversation.messages.map((m) => m.createdAt))
}

interface LegacyRecord {
  provider: ProviderId
  providerLabel: string
  createdAt: number
  key: string
  fingerprint: string
  result: { summary: string; findings: (ReviewLocation & { severity?: string })[] }
  excluded?: string[]
  instruction?: string
}

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex')

function isLegacy(value: unknown): value is LegacyRecord {
  const result = (value as { result?: { summary?: unknown; findings?: unknown } } | null)?.result
  return typeof result?.summary === 'string' && Array.isArray(result.findings)
}

function fromLegacy(r: LegacyRecord): ReviewConversation {
  return {
    version: 2,
    key: r.key,
    provider: r.provider,
    providerLabel: r.providerLabel,
    sessionId: null,
    messages: [{
      id: `legacy-${r.createdAt}`,
      createdAt: r.createdAt,
      kind: r.instruction ? 'question' : 'review',
      question: r.instruction ?? null,
      fingerprint: r.fingerprint,
      ...(!r.instruction && r.excluded && r.excluded.length > 0 ? { excluded: r.excluded } : {}),
      result: {
        answer: r.result.summary,
        locations: r.result.findings.map(({ file, line, side, title, body }) => ({ file, line, side, title, body })),
      },
    }],
  }
}

export class ReviewStore {
  constructor(private baseDir = join(APP_DATA_DIR, 'reviews')) {}

  private file(repoPath: string, key: string): string {
    return join(this.baseDir, sha1(repoPath), `${sha1(key)}.json`)
  }

  private write(repoPath: string, conversation: ReviewConversation): void {
    const path = this.file(repoPath, conversation.key)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(conversation, null, 2))
  }

  private read(path: string): ReviewConversation | null {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return null
    }
    const candidate = data as { version?: unknown; messages?: unknown } | null
    if (candidate?.version === 2) return Array.isArray(candidate.messages) ? (data as ReviewConversation) : null
    if (isLegacy(data)) return fromLegacy(data)
    return null
  }

  load(repoPath: string, key: string): ReviewConversation | null {
    return this.read(this.file(repoPath, key))
  }

  append(repoPath: string, key: string, { provider, providerLabel, sessionId, message }: AppendInput): ReviewConversation {
    const current = this.load(repoPath, key)
    const next: ReviewConversation = { version: 2, key, provider, providerLabel, sessionId, messages: [...(current?.messages ?? []), message] }
    this.write(repoPath, next)
    return next
  }

  removeMessage(repoPath: string, key: string, messageId: string): boolean {
    const current = this.load(repoPath, key)
    if (!current) return false
    const messages = current.messages.filter((m) => m.id !== messageId)
    if (messages.length === current.messages.length) return false
    this.write(repoPath, { ...current, messages })
    return true
  }

  clear(repoPath: string, key: string): void {
    rmSync(this.file(repoPath, key), { force: true })
  }

  list(repoPath: string): ConversationSummary[] {
    const dir = join(this.baseDir, sha1(repoPath))
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    const summaries: ConversationSummary[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const conversation = this.read(join(dir, name))
      const lastAt = conversation ? lastQuestionAt(conversation) : null
      if (!conversation || lastAt === null) continue
      summaries.push({ key: conversation.key, questionCount: conversation.messages.length, lastAt })
    }
    return summaries.sort((a, b) => b.lastAt - a.lastAt)
  }

  prune(retentionDays: number | null, now = Date.now()): number {
    if (retentionDays === null) return 0
    const cutoff = now - retentionDays * DAY_MS
    let repoDirs: string[]
    try {
      repoDirs = readdirSync(this.baseDir)
    } catch {
      return 0
    }
    let removed = 0
    for (const repoDir of repoDirs) {
      const dir = join(this.baseDir, repoDir)
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const path = join(dir, name)
        try {
          const conversation = this.read(path)
          const lastAt = (conversation ? lastQuestionAt(conversation) : null) ?? statSync(path).mtimeMs
          if (lastAt < cutoff) {
            rmSync(path, { force: true })
            removed++
          }
        } catch {}
      }
      try {
        if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true })
      } catch {}
    }
    return removed
  }
}
