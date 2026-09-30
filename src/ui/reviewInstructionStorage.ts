const STORAGE_PREFIX = 'diffx-review-instruction:'

export function loadReviewInstruction(repoRoot: string, storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    return storage.getItem(STORAGE_PREFIX + repoRoot) ?? ''
  } catch {
    return ''
  }
}

export function saveReviewInstruction(repoRoot: string, instruction: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + repoRoot, instruction)
  } catch {}
}
