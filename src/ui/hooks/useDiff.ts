import { useState, useEffect } from 'react'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
  key: string
  mode: 'worktree' | 'branch' | 'custom'
  sourceSha?: string
  targetSha?: string
  mergeBase?: string
  identical: boolean
}

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

export function useDiff(params: URLSearchParams | null, reloadToken = 0) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const query = params?.toString() ?? null

  useEffect(() => {
    if (query === null) return
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
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? [],
    tabSizeMap: data?.tabSizeMap ?? {},
    untrackedFiles: data?.untrackedFiles ?? [],
    key: data?.key ?? null,
    mode: data?.mode ?? null,
    sourceSha: data?.sourceSha,
    targetSha: data?.targetSha,
    identical: data?.identical ?? false,
    loading,
    error,
    errorCode,
  }
}
