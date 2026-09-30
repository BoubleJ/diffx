import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewStore, type ReviewMessage } from './store'

const key = 'branch:origin/main...feature/x'
const sha1 = (v: string) => createHash('sha1').update(v).digest('hex')

const message = (id: string, overrides: Partial<ReviewMessage> = {}): ReviewMessage => ({
  id,
  createdAt: 1,
  kind: 'question',
  question: '질문',
  fingerprint: 'a:b',
  result: { answer: '답변', locations: [] },
  ...overrides,
})

const appendInput = (m: ReviewMessage, sessionId = 's-1') => ({ provider: 'claude' as const, providerLabel: 'Claude Code', sessionId, message: m })

function writeLegacy(dir: string, repo: string, record: unknown) {
  mkdirSync(join(dir, sha1(repo)), { recursive: true })
  writeFileSync(join(dir, sha1(repo), `${sha1(key)}.json`), JSON.stringify(record))
}

const legacy = {
  provider: 'claude',
  providerLabel: 'Claude Code',
  createdAt: 5,
  key,
  fingerprint: 'a:b',
  result: { summary: '이전 요약', findings: [{ severity: 'major', file: 'a.ts', line: 3, side: 'new', title: 't', body: 'b' }] },
  excluded: ['x.ts'],
}

describe('ReviewStore', () => {
  it('appends messages per repo and key and keeps the latest session id', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    expect(store.load('/repo', key)).toBeNull()
    store.append('/repo', key, appendInput(message('m1'), 's-1'))
    store.append('/repo', key, appendInput(message('m2'), 's-2'))
    const loaded = store.load('/repo', key)!
    expect(loaded).toMatchObject({ version: 2, key, provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-2' })
    expect(loaded.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(store.load('/other', key)).toBeNull()
  })

  it('append reads the file again so a removed message stays removed', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', key, appendInput(message('m1')))
    store.append('/repo', key, appendInput(message('m2')))
    expect(store.removeMessage('/repo', key, 'm1')).toBe(true)
    store.append('/repo', key, appendInput(message('m3')))
    expect(store.load('/repo', key)!.messages.map((m) => m.id)).toEqual(['m2', 'm3'])
  })

  it('removes a message but keeps the session', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', key, appendInput(message('m1')))
    expect(store.removeMessage('/repo', key, 'nope')).toBe(false)
    expect(store.removeMessage('/repo', key, 'm1')).toBe(true)
    expect(store.load('/repo', key)).toMatchObject({ sessionId: 's-1', messages: [] })
    expect(store.removeMessage('/other', key, 'm1')).toBe(false)
  })

  it('clears the conversation', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', key, appendInput(message('m1')))
    store.clear('/repo', key)
    expect(store.load('/repo', key)).toBeNull()
    expect(() => store.clear('/repo', key)).not.toThrow()
  })

  it('converts a legacy review record into one review message without a session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', legacy)
    const loaded = new ReviewStore(dir).load('/repo', key)!
    expect(loaded).toMatchObject({ version: 2, key, provider: 'claude', sessionId: null })
    expect(loaded.messages).toHaveLength(1)
    expect(loaded.messages[0]).toMatchObject({
      createdAt: 5,
      kind: 'review',
      question: null,
      fingerprint: 'a:b',
      excluded: ['x.ts'],
      result: { answer: '이전 요약', locations: [{ file: 'a.ts', line: 3, side: 'new', title: 't', body: 'b' }] },
    })
    expect(loaded.messages[0].result.locations[0]).not.toHaveProperty('severity')
  })

  it('converts a legacy record with an instruction into a question message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', { ...legacy, instruction: '성능 위주로' })
    expect(new ReviewStore(dir).load('/repo', key)!.messages[0]).toMatchObject({ kind: 'question', question: '성능 위주로' })
  })

  it('gives a legacy message a stable id so it can be removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', legacy)
    const store = new ReviewStore(dir)
    const id = store.load('/repo', key)!.messages[0].id
    expect(store.load('/repo', key)!.messages[0].id).toBe(id)
    expect(store.removeMessage('/repo', key, id)).toBe(true)
    expect(store.load('/repo', key)).toMatchObject({ version: 2, messages: [] })
  })

  it('returns null for an unreadable file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', { something: 'else' })
    expect(new ReviewStore(dir).load('/repo', key)).toBeNull()
  })
})
