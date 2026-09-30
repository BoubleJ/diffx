import { useState, useEffect, useCallback } from 'react'

export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap: boolean
  terminalApp: string
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
  softWrap: false,
  terminalApp: '',
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        setSettings({ ...DEFAULTS, ...data })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      return next
    })
  }, [])

  return { settings, loaded, updateSettings }
}
