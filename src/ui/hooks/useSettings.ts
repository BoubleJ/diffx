import { useState, useEffect, useCallback, useRef } from 'react'

export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap: boolean
  terminalApp: string
  reviewRetentionDays: number | null
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
  softWrap: false,
  terminalApp: '',
  reviewRetentionDays: 30,
}

export async function putSettings(patch: Partial<Settings>, fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const settingsRef = useRef<Settings>(DEFAULTS)

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        const next = { ...DEFAULTS, ...data }
        settingsRef.current = next
        setSettings(next)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    try {
      await putSettings(patch)
    } catch {}
  }, [])

  return { settings, loaded, updateSettings }
}
