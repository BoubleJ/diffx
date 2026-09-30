import type { ReviewWorktreeStatus } from '../gitlab/reviewWorktree'

export type CheckoutState = 'loading' | 'none' | 'outdated' | 'current'

export function checkoutState(worktree: ReviewWorktreeStatus | undefined, mrHeadSha: string): CheckoutState {
  if (!worktree) return 'loading'
  if (!worktree.exists) return 'none'
  return worktree.headSha === mrHeadSha ? 'current' : 'outdated'
}
