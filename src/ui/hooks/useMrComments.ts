import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReviewComment } from '../../types'
import type { MrThreads } from '../../gitlab/notes'

const EMPTY: MrThreads = { comments: [], outdatedCount: 0, draftCount: 0 }

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init)
  if (res.ok) return
  const body = await res.json().catch(() => null)
  throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`)
}

function postJson(payload: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}

export function useMrComments(iid: number | null) {
  const queryClient = useQueryClient()
  const { data = EMPTY } = useQuery({
    queryKey: ['mr-threads', iid],
    queryFn: async (): Promise<MrThreads> => {
      const res = await fetch(`/api/gitlab/mrs/${iid}/threads`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      return body
    },
    enabled: iid !== null,
    refetchInterval: 30_000,
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const base = `/api/gitlab/mrs/${iid}`
  const refetch = useCallback(() => queryClient.invalidateQueries({ queryKey: ['mr-threads', iid] }), [queryClient, iid])

  const addDraft = useCallback(
    async (filePath: string, side: ReviewComment['side'], lineNumber: number, _lineContent: string, body: string) => {
      await send(`${base}/drafts`, postJson({ filePath, side, lineNumber, body }))
      await refetch()
    },
    [base, refetch],
  )

  const addReply = useCallback(
    async (discussionId: string, body: string) => {
      await send(`${base}/drafts`, postJson({ discussionId, body }))
      await refetch()
    },
    [base, refetch],
  )

  const deleteDraft = useCallback(
    async (id: string) => {
      await send(`${base}/drafts/${id.replace(/^draft:/, '')}`, { method: 'DELETE' })
      await refetch()
    },
    [base, refetch],
  )

  const publish = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await send(`${base}/publish`, { method: 'POST' })
      await refetch()
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }, [base, refetch])

  return { ...data, addDraft, addReply, deleteDraft, publish, submitting, submitError }
}
