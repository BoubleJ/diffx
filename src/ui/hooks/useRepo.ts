import { useEffect, useState } from 'react'

export interface RepoInfo {
  root: string
  name: string
  customMode: boolean
}

export function useRepo() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/repo')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(setRepo)
      .catch((err) => setError(err.message))
  }, [])

  return { repo, error }
}
