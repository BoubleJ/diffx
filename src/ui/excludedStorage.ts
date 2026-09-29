const STORAGE_PREFIX = 'diffx-excluded:'

function storageKey(repoRoot: string, key: string): string {
  return `${STORAGE_PREFIX}${repoRoot}\0${key}`
}

export function loadExcluded(repoRoot: string, key: string, storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  try {
    const raw = storage.getItem(storageKey(repoRoot, key))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((p): p is string => typeof p === 'string'))].sort()
  } catch {}
  return []
}

export function saveExcluded(repoRoot: string, key: string, paths: string[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(storageKey(repoRoot, key), JSON.stringify([...new Set(paths)].sort()))
  } catch {}
}
