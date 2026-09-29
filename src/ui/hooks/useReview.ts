import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export type ProviderId = 'claude' | 'codex' | 'cursor' | 'gemini'
export type Severity = 'critical' | 'major' | 'minor' | 'info'

export interface Finding {
  severity: Severity
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

export interface ReviewRecord {
  provider: ProviderId
  providerLabel: string
  createdAt: number
  key: string
  fingerprint: string
  result: { summary: string; findings: Finding[] }
}

export type ReviewState =
  | { status: 'idle' }
  | { status: 'running'; progress: string | null; startedAt: number }
  | { status: 'error'; kind: string; message: string; rawOutput?: string }

interface SavedReview {
  key: string
  record: ReviewRecord | null
  stale: boolean
  running: { id: string; provider: ProviderId; startedAt: number } | null
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
    queryFn: async (): Promise<ProviderInfo[]> => (await fetch('/api/review/providers')).json(),
    staleTime: 60_000,
  })

  const savedKey = ['review', key]
  const { data: saved, isFetching } = useQuery({
    queryKey: savedKey,
    queryFn: async (): Promise<SavedReview> => (await fetch(`/api/review?${query}`)).json(),
    enabled: key !== null && params !== null,
  })

  const detach = () => {
    jobRef.current?.source.close()
    jobRef.current = null
  }

  const attach = useCallback((id: string, startedAt: number, fromSaved = false) => {
    detach()
    setState({ status: 'running', progress: null, startedAt })
    const source = new EventSource(`/api/review/${id}/events`)
    jobRef.current = { id, source }
    source.addEventListener('progress', (e) => {
      setState((prev) => (prev.status === 'running' ? { ...prev, progress: (e as MessageEvent).data } : prev))
    })
    source.addEventListener('done', () => {
      detach()
      setState({ status: 'idle' })
      queryClient.invalidateQueries({ queryKey: ['review'] })
    })
    source.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data
      detach()
      if (!data) {
        setState({ status: 'error', kind: 'process', message: '서버와 연결이 끊겼습니다' })
        return
      }
      const err = JSON.parse(data)
      if (fromSaved && err.message === '리뷰 작업을 찾지 못했습니다') {
        setState({ status: 'idle' })
        queryClient.invalidateQueries({ queryKey: ['review'] })
        return
      }
      setState(err.kind === 'cancelled' ? { status: 'idle' } : { status: 'error', ...err })
    })
  }, [queryClient])

  useEffect(() => {
    detach()
    setState({ status: 'idle' })
  }, [key])

  useEffect(() => {
    if (!isFetching && saved?.running && saved.key === key && jobRef.current?.id !== saved.running.id) {
      attach(saved.running.id, saved.running.startedAt, true)
    }
  }, [saved, key, isFetching, attach])

  useEffect(() => detach, [])

  const start = useCallback(async (provider: ProviderId) => {
    if (!params || startingRef.current) return
    startingRef.current = true
    const startKey = keyRef.current
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...Object.fromEntries(params), staged: params.get('staged') === 'true', untracked: params.get('untracked') === 'true' }),
      })
      const body = await res.json()
      if (keyRef.current !== startKey) return
      if (!res.ok) {
        setState({ status: 'error', kind: 'process', message: body.message ?? body.error ?? `HTTP ${res.status}` })
        return
      }
      attach(body.id, Date.now())
    } catch {
      if (keyRef.current === startKey) {
        setState({ status: 'error', kind: 'process', message: '리뷰 요청을 보내지 못했습니다' })
      }
    } finally {
      startingRef.current = false
    }
  }, [params, attach])

  const cancel = useCallback(async () => {
    const id = jobRef.current?.id
    if (!id) return
    try {
      await fetch(`/api/review/${id}`, { method: 'DELETE' })
    } catch {}
  }, [])

  return {
    providers,
    record: saved?.key === key ? saved.record : null,
    stale: saved?.key === key ? saved.stale : false,
    state,
    start,
    cancel,
  }
}
