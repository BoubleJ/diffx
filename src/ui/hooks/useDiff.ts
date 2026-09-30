import { useState, useEffect } from 'react'
import type { MrDetail } from '../../gitlab/mr'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  key: string
  mode: 'branch' | 'mr'
  sourceSha?: string
  targetSha?: string
  mergeBase?: string
  identical: boolean
  mr?: MrDetail
}

export function useDiff(params: URLSearchParams | null, reloadToken = 0) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const query = params?.toString() ?? null

  useEffect(() => {
    if (query === null) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setErrorCode(null)

    fetch(`/api/diff?${query}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          const err = new Error(body?.message ?? `HTTP ${res.status}`) as Error & { code?: string }
          err.code = body?.error
          throw err
        }
        return body as DiffData
      })
      .then((json) => { if (!cancelled) setData(json) })
      .catch((err) => {
        if (cancelled) return
        setData(null)
        setError(err.message)
        setErrorCode(err.code ?? null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, reloadToken])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    binaryFiles: data?.binaryFiles ?? [],
    tabSizeMap: data?.tabSizeMap ?? {},
    key: data?.key ?? null,
    mode: data?.mode ?? null,
    sourceSha: data?.sourceSha,
    targetSha: data?.targetSha,
    identical: data?.identical ?? false,
    mr: data?.mr,
    loading,
    error,
    errorCode,
  }
}
