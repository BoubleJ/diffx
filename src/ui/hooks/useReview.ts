import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CodeSelection } from '../../review/types'

export type ProviderId = 'claude'
export type MessageKind = 'question' | 'review'

export interface ReviewLocation {
  file: string
  line: number | null
  side: 'old' | 'new'
  title: string
  body: string
}

export interface ProviderInfo {
  id: ProviderId
  label: string
  installed: boolean
  version?: string
  verified: boolean
  installHint: string
  loginHint: string
}

export interface ReviewMessage {
  id: string
  createdAt: number
  kind: MessageKind
  question: string | null
  fingerprint: string
  excluded?: string[]
  selection?: CodeSelection
  result: { answer: string; locations: ReviewLocation[] }
  stale: boolean
}

export interface PendingQuestion {
  kind: MessageKind
  question: string | null
  excluded?: string[]
  selection?: CodeSelection
}

export type ReviewState =
  | { status: 'idle' }
  | { status: 'running'; pending: PendingQuestion; progress: string | null; startedAt: number }
  | { status: 'error'; pending: PendingQuestion; kind: string; message: string; rawOutput?: string }

export interface SavedConversation {
  key: string
  sessionId: string | null
  messages: ReviewMessage[]
  running: { id: string; provider: ProviderId; startedAt: number; kind: MessageKind; question: string | null; selection?: CodeSelection | null } | null
}

export async function fetchProviders(fetchFn: typeof fetch = fetch): Promise<ProviderInfo[]> {
  const res = await fetchFn('/api/review/providers')
  if (!res.ok) return []
  return res.json()
}

export function savedReviewKey(key: string | null): [string, string | null] {
  return ['review', key]
}

export function questionToRefill(state: ReviewState, input: string): string | null {
  if (state.status !== 'error' || state.pending.kind !== 'question' || input.trim() !== '') return null
  return state.pending.question
}

export function appendMessage(saved: SavedConversation | undefined, message: Omit<ReviewMessage, 'stale'>): SavedConversation | undefined {
  if (!saved || saved.messages.some((m) => m.id === message.id)) return saved
  return { ...saved, messages: [...saved.messages, { ...message, stale: false }], running: null }
}

export function useReview(params: URLSearchParams | null, key: string | null) {
  const queryClient = useQueryClient()
  const query = params?.toString() ?? ''
  const [state, setState] = useState<ReviewState>({ status: 'idle' })
  const jobRef = useRef<{ id: string; source: EventSource } | null>(null)
  const startingRef = useRef(false)
  const keyRef = useRef(key)
  keyRef.current = key

  const { data: providers = [] } = useQuery({
    queryKey: ['review-providers'],
    queryFn: () => fetchProviders(),
    staleTime: 60_000,
  })

  const { data: saved, isFetching } = useQuery({
    queryKey: savedReviewKey(key),
    queryFn: async (): Promise<SavedConversation> => (await fetch(`/api/review?${query}`)).json(),
    enabled: key !== null && params !== null,
  })

  const detach = () => {
    jobRef.current?.source.close()
    jobRef.current = null
  }

  const attach = useCallback((id: string, startedAt: number, pending: PendingQuestion, fromSaved = false) => {
    detach()
    setState({ status: 'running', pending, progress: null, startedAt })
    const attachedKey = keyRef.current
    const source = new EventSource(`/api/review/${id}/events`)
    jobRef.current = { id, source }
    source.addEventListener('progress', (e) => {
      setState((prev) => (prev.status === 'running' ? { ...prev, progress: (e as MessageEvent).data } : prev))
    })
    source.addEventListener('done', (e) => {
      detach()
      queryClient.setQueryData<SavedConversation>(savedReviewKey(attachedKey), (prev) => appendMessage(prev, JSON.parse((e as MessageEvent).data)))
      setState({ status: 'idle' })
      queryClient.invalidateQueries({ queryKey: ['review'] })
    })
    source.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data
      detach()
      if (!data) {
        setState({ status: 'error', pending, kind: 'process', message: '서버와 연결이 끊겼습니다' })
        return
      }
      const err = JSON.parse(data)
      if (fromSaved && err.message === '리뷰 작업을 찾지 못했습니다') {
        setState({ status: 'idle' })
        queryClient.invalidateQueries({ queryKey: ['review'] })
        return
      }
      setState({ status: 'error', pending, kind: err.kind, message: err.kind === 'cancelled' ? '취소했습니다' : err.message, rawOutput: err.rawOutput })
    })
  }, [queryClient])

  useEffect(() => {
    detach()
    setState({ status: 'idle' })
  }, [key])

  useEffect(() => {
    if (!isFetching && saved?.running && saved.key === key && jobRef.current?.id !== saved.running.id) {
      const { id, startedAt, kind, question, selection } = saved.running
      attach(id, startedAt, { kind, question, ...(selection ? { selection } : {}) }, true)
    }
  }, [saved, key, isFetching, attach])

  useEffect(() => detach, [])

  const send = useCallback(async (pending: PendingQuestion) => {
    if (!params || startingRef.current) return
    startingRef.current = true
    const startKey = keyRef.current
    const startedAt = Date.now()
    setState({ status: 'running', pending, progress: null, startedAt })
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude', ...Object.fromEntries(params), kind: pending.kind, question: pending.question ?? '', exclude: pending.excluded ?? [], ...(pending.selection ? { selection: pending.selection } : {}) }),
      })
      const body = await res.json()
      if (keyRef.current !== startKey) return
      if (!res.ok) {
        setState({ status: 'error', pending, kind: 'process', message: body.message ?? body.error ?? `HTTP ${res.status}` })
        return
      }
      attach(body.id, startedAt, pending)
    } catch {
      if (keyRef.current === startKey) {
        setState({ status: 'error', pending, kind: 'process', message: '요청을 보내지 못했습니다' })
      }
    } finally {
      startingRef.current = false
    }
  }, [params, attach])

  const ask = useCallback((question: string, selection?: CodeSelection) => send({ kind: 'question', question, ...(selection ? { selection } : {}) }), [send])
  const review = useCallback((exclude: string[]) => send({ kind: 'review', question: null, excluded: exclude }), [send])

  const cancel = useCallback(async () => {
    const id = jobRef.current?.id
    if (!id) return
    try {
      await fetch(`/api/review/${id}`, { method: 'DELETE' })
    } catch {}
  }, [])

  const removeMessage = useCallback(async (id: string) => {
    try {
      await fetch(`/api/review/messages/${encodeURIComponent(id)}?${query}`, { method: 'DELETE' })
    } catch {}
    queryClient.invalidateQueries({ queryKey: ['review'] })
  }, [query, queryClient])

  const newConversation = useCallback(async () => {
    try {
      await fetch(`/api/review/conversation?${query}`, { method: 'DELETE' })
    } catch {}
    setState({ status: 'idle' })
    queryClient.invalidateQueries({ queryKey: ['review'] })
  }, [query, queryClient])

  return {
    providers,
    messages: saved?.key === key ? saved.messages : [],
    state,
    ask,
    review,
    cancel,
    removeMessage,
    newConversation,
  }
}
