import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export interface BranchList {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

const BRANCHES_KEY = ['branches']

export function useBranches(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data: branches, refetch } = useQuery({
    queryKey: BRANCHES_KEY,
    queryFn: async (): Promise<BranchList> => {
      const res = await fetch('/api/branches')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled,
  })
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchRemote = useCallback(async () => {
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/fetch', { method: 'POST' })
      const body = await res.json()
      if (!body.ok) setFetchError(body.error)
      await queryClient.invalidateQueries({ queryKey: BRANCHES_KEY })
    } catch (err) {
      setFetchError((err as Error).message)
    } finally {
      setFetching(false)
    }
  }, [queryClient])

  return { branches, refetch, fetchRemote, fetching, fetchError }
}
