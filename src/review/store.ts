import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderId, ReviewResult } from './types.js'

export interface ReviewRecord {
  provider: ProviderId
  providerLabel: string
  createdAt: number
  key: string
  fingerprint: string
  result: ReviewResult
  excluded?: string[]
  instruction?: string
}

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex')

export class ReviewStore {
  constructor(private baseDir = join(homedir(), '.config', 'diffx', 'reviews')) {}

  private file(repoPath: string, key: string): string {
    return join(this.baseDir, sha1(repoPath), `${sha1(key)}.json`)
  }

  load(repoPath: string, key: string): ReviewRecord | null {
    try {
      return JSON.parse(readFileSync(this.file(repoPath, key), 'utf-8'))
    } catch {
      return null
    }
  }

  save(repoPath: string, record: ReviewRecord): void {
    const path = this.file(repoPath, record.key)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(record, null, 2))
  }
}
