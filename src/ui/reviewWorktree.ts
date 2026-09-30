import type { ReviewWorktreeStatus } from '../gitlab/reviewWorktree'

export type CheckoutState = 'loading' | 'none' | 'outdated' | 'current'

export function checkoutState(worktree: ReviewWorktreeStatus | undefined, mrHeadSha: string): CheckoutState {
  if (!worktree) return 'loading'
  if (!worktree.exists) return 'none'
  return worktree.headSha === mrHeadSha ? 'current' : 'outdated'
}

export function checkoutOutcome(result: { headSha: string; copiedEnvFiles: string[] }, displayedHeadSha: string): { notice: string | null; reloadDiff: boolean } {
  return {
    notice: result.copiedEnvFiles.length > 0 ? `env 파일 ${result.copiedEnvFiles.length}개를 복사했습니다` : null,
    reloadDiff: result.headSha !== displayedHeadSha,
  }
}
