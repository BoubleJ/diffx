import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { GitlabStatus, MrSummary } from '../../gitlab/mr'
import type { MrFilter } from '../mrFilterStorage'

const STATUS_KEY = ['gitlab-status']

export function useGitlabStatus(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async (): Promise<GitlabStatus> => (await fetch('/api/gitlab/status')).json(),
    enabled,
    staleTime: Infinity,
  })
  const refresh = useCallback(async () => {
    const next: GitlabStatus = await (await fetch('/api/gitlab/status?refresh=true')).json()
    queryClient.setQueryData(STATUS_KEY, next)
    return next
  }, [queryClient])
  return { status: data, refresh }
}

export function useMrList(filter: MrFilter, search: string, enabled: boolean) {
  const { data, isFetching, error } = useQuery({
    queryKey: ['mr-list', filter.state, filter.mine, search],
    queryFn: async (): Promise<MrSummary[]> => {
      const params = new URLSearchParams({ state: filter.state, mine: String(filter.mine), search })
      const res = await fetch(`/api/gitlab/mrs?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      return body
    },
    enabled,
  })
  return { mrs: data ?? [], loading: isFetching, error: error ? (error as Error).message : null }
}
