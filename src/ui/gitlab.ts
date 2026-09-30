import type { GitlabStatus } from '../gitlab/mr'
import { defaultBranchComparison, type BranchInfo, type Comparison } from './comparison'

export function gitlabUnavailableMessage(status: Extract<GitlabStatus, { available: false }>): string {
  switch (status.reason) {
    case 'not_installed':
      return 'glab이 설치되어 있지 않습니다 (brew install glab)'
    case 'auth':
      return `glab 로그인이 필요합니다. 터미널에서 \`glab auth login${status.host ? ` --hostname ${status.host}` : ''}\`를 실행해 주세요`
    case 'not_gitlab':
      return '원격 저장소가 GitLab이 아닙니다'
    default:
      return status.message
  }
}

export function reconcileMrAvailability(c: Comparison, status: GitlabStatus | undefined, branches: BranchInfo): { comparison: Comparison; notice: string | null } {
  if (c.mode !== 'mr' || !status || status.available) return { comparison: c, notice: null }
  return { comparison: defaultBranchComparison(branches), notice: gitlabUnavailableMessage(status) }
}

export function mrTabAction(status: GitlabStatus | undefined): 'open' | 'recheck' | 'none' {
  if (!status) return 'none'
  return status.available ? 'open' : 'recheck'
}

export function mrNotFoundReset(c: Comparison, errorCode: string | null): { comparison: Comparison; notice: string } | null {
  if (errorCode !== 'mr_not_found' || c.mode !== 'mr' || c.iid === null) return null
  return { comparison: { mode: 'mr', iid: null }, notice: `MR !${c.iid}을 찾지 못했습니다` }
}

const STATE_BADGE: Record<string, string> = { merged: '머지됨', closed: '닫힘' }

export function mrStateBadge(state: string): string | null {
  return STATE_BADGE[state] ?? null
}
