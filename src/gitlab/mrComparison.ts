import { getRangeDiff, listRemotes } from '../git.js'
import type { RangeDiff, ResolvedComparison } from '../comparison.js'
import { GlabError, type GlabClient } from './glab.js'
import { ensureMrCommits, findGitlabRemote, getMrDetail, type GitlabStatus, type MrDetail } from './mr.js'

export class MrRequestError extends Error {}

export function parseIid(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text)) throw new MrRequestError('MR 번호가 올바르지 않습니다')
  return Number(text)
}

export type MrResolved = ResolvedComparison & { mode: 'mr'; mr: MrDetail }

export class MrComparisons {
  private details = new Map<number, MrDetail>()

  constructor(
    private repo: string,
    private glab: GlabClient,
    private getStatus: () => Promise<GitlabStatus>,
    private rangeDiff: RangeDiff = getRangeDiff,
  ) {}

  async resolve(iid: number, options: { refresh: boolean }): Promise<MrResolved> {
    let mr = options.refresh ? undefined : this.details.get(iid)
    if (!mr) {
      mr = await getMrDetail(this.glab, iid)
      this.details.set(iid, mr)
    }
    await ensureMrCommits(this.repo, await this.remote(), mr)
    return {
      key: `mr:${iid}`,
      mode: 'mr',
      patch: this.rangeDiff(this.repo, mr.baseSha, mr.headSha),
      source: mr.headSha,
      target: mr.baseSha,
      sourceSha: mr.headSha,
      targetSha: mr.baseSha,
      mergeBase: mr.baseSha,
      mr,
    }
  }

  private async remote(): Promise<string> {
    const status = await this.getStatus()
    if (!status.available) throw new GlabError(status.reason, status.message)
    return findGitlabRemote(listRemotes(this.repo), status.host, status.project) ?? 'origin'
  }
}
