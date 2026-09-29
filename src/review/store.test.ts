import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewStore, type ReviewRecord } from './store'

const record: ReviewRecord = {
  provider: 'claude',
  providerLabel: 'Claude Code',
  createdAt: 1,
  key: 'branch:origin/main...feature/x',
  fingerprint: 'a:b',
  result: { summary: 's', findings: [] },
}

describe('ReviewStore', () => {
  it('saves and loads per repo and key, keeping only the latest', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    expect(store.load('/repo', record.key)).toBeNull()
    store.save('/repo', record)
    store.save('/repo', { ...record, createdAt: 2 })
    expect(store.load('/repo', record.key)?.createdAt).toBe(2)
    expect(store.load('/other', record.key)).toBeNull()
    expect(store.load('/repo', 'worktree')).toBeNull()
  })
})
