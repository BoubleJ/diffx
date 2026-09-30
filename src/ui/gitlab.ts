import type { GitlabStatus } from '../gitlab/mr'
import type { Comparison } from './comparison'

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

export function reconcileMrAvailability(c: Comparison, status: GitlabStatus | undefined): { comparison: Comparison; notice: string | null } {
  if (c.mode !== 'mr' || !status || status.available) return { comparison: c, notice: null }
  return { comparison: { mode: 'worktree' }, notice: gitlabUnavailableMessage(status) }
}
