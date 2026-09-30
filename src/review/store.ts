import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderId, ReviewLocation, ReviewResult } from './types.js'

export type MessageKind = 'question' | 'review'

export interface ReviewMessage {
  id: string
  createdAt: number
  kind: MessageKind
  question: string | null
  fingerprint: string
  excluded?: string[]
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
      ...(r.excluded && r.excluded.length > 0 ? { excluded: r.excluded } : {}),
      result: {
        answer: r.result.summary,
        locations: r.result.findings.map(({ file, line, side, title, body }) => ({ file, line, side, title, body })),
      },
    }],
  }
}

export class ReviewStore {
  constructor(private baseDir = join(homedir(), '.config', 'diffx', 'reviews')) {}

  private file(repoPath: string, key: string): string {
    return join(this.baseDir, sha1(repoPath), `${sha1(key)}.json`)
  }

  private write(repoPath: string, conversation: ReviewConversation): void {
    const path = this.file(repoPath, conversation.key)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(conversation, null, 2))
  }

  load(repoPath: string, key: string): ReviewConversation | null {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(this.file(repoPath, key), 'utf-8'))
    } catch {
      return null
    }
    if ((data as { version?: unknown } | null)?.version === 2) return data as ReviewConversation
    if (isLegacy(data)) return fromLegacy(data)
    return null
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
}
