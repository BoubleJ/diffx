import type { MrState } from '../gitlab/mr'

export interface MrFilter {
  state: MrState
  mine: boolean
}

export const DEFAULT_MR_FILTER: MrFilter = { state: 'opened', mine: false }

const STORAGE_PREFIX = 'diffx-mr-filter:'
const STATES: MrState[] = ['opened', 'merged', 'all']

export function loadMrFilter(repoRoot: string, storage: Pick<Storage, 'getItem'> = localStorage): MrFilter {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_PREFIX + repoRoot) ?? 'null')
    if (parsed && STATES.includes(parsed.state) && typeof parsed.mine === 'boolean') {
      return { state: parsed.state, mine: parsed.mine }
    }
  } catch {}
  return DEFAULT_MR_FILTER
}

export function saveMrFilter(repoRoot: string, filter: MrFilter, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify(filter))
  } catch {}
}
