const STORAGE_KEY = 'diffx-review-with-locations'

export function loadWithLocations(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveWithLocations(value: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, String(value))
  } catch {}
}
