import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReviewWorktreeStatus } from '../../gitlab/reviewWorktree'

const KEY = ['review-worktree']
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type CheckoutResponse =
  | { kind: 'done'; path: string; headSha: string; copiedEnvFiles: string[] }
  | { kind: 'dirty'; files: string[] }

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return body?.message ?? `HTTP ${res.status}`
}

export function useReviewWorktree() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ReviewWorktreeStatus> => {
      const res = await fetch('/api/review-worktree')
      if (!res.ok) throw new Error(await errorMessage(res))
      return res.json()
    },
  })

  const checkout = useCallback(async (iid: number, force: boolean): Promise<CheckoutResponse> => {
    const res = await fetch(`/api/gitlab/mrs/${iid}/checkout`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ force }) })
    if (res.status === 409) return { kind: 'dirty', files: (await res.json()).files }
    if (!res.ok) throw new Error(await errorMessage(res))
    const body: { path: string; headSha: string; copiedEnvFiles: string[] } = await res.json()
    queryClient.setQueryData<ReviewWorktreeStatus>(KEY, { exists: true, path: body.path, headSha: body.headSha })
    return { kind: 'done', ...body }
  }, [queryClient])

  const openTerminal = useCallback(async () => {
    const res = await fetch('/api/review-worktree/open-terminal', { method: 'POST', headers: JSON_HEADERS, body: '{}' })
    if (!res.ok) throw new Error(await errorMessage(res))
  }, [])

  const listChanges = useCallback(async (): Promise<string[]> => {
    const res = await fetch('/api/review-worktree/changes')
    if (!res.ok) throw new Error(await errorMessage(res))
    return (await res.json()).files
  }, [])

  const remove = useCallback(async () => {
    const res = await fetch('/api/review-worktree', { method: 'DELETE' })
    if (!res.ok) throw new Error(await errorMessage(res))
    queryClient.setQueryData<ReviewWorktreeStatus>(KEY, { exists: false })
  }, [queryClient])

  return { worktree: data, error: error ? (error as Error).message : null, checkout, openTerminal, listChanges, remove }
}
