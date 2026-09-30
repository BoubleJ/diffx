import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export type ProviderId = 'claude'
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
  excluded?: string[]
  instruction?: string
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

export async function fetchProviders(fetchFn: typeof fetch = fetch): Promise<ProviderInfo[]> {
  const res = await fetchFn('/api/review/providers')
  if (!res.ok) return []
  return res.json()
}

// 작업 트리 모드는 staged, untracked 설정을 바꿔도 key가 같으므로 요청 파라미터까지 키에 넣어 stale을 다시 계산한다.
export function savedReviewKey(key: string | null, query: string): [string, string | null, string] {
  return ['review', key, query]
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
    queryKey: savedReviewKey(key, query),
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

  const start = useCallback(async (provider: ProviderId, exclude: string[] = [], instruction = '') => {
    if (!params || startingRef.current) return
    startingRef.current = true
    const startKey = keyRef.current
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...Object.fromEntries(params), staged: params.get('staged') === 'true', untracked: params.get('untracked') === 'true', exclude, instruction }),
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
