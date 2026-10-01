const STORAGE_KEY = 'diffx-review-panel'

export type ReviewPanelTab = 'review' | 'explore' | 'conversations'

export interface ReviewPanelPrefs {
  open: boolean
  size: number
  tab: ReviewPanelTab
}

export const REVIEW_PANEL_MIN = 280
const DEFAULTS: ReviewPanelPrefs = { open: false, size: 400, tab: 'review' }

export function loadReviewPanel(storage: Pick<Storage, 'getItem'> = localStorage): ReviewPanelPrefs {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof parsed?.open === 'boolean' && typeof parsed?.size === 'number') {
      const tab: ReviewPanelTab = parsed.tab === 'explore' || parsed.tab === 'conversations' ? parsed.tab : 'review'
      return { open: parsed.open, size: Math.max(REVIEW_PANEL_MIN, parsed.size), tab }
    }
  } catch {}
  return { ...DEFAULTS }
}

export function saveReviewPanel(prefs: ReviewPanelPrefs, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {}
}

export function togglePanel(p: ReviewPanelPrefs): ReviewPanelPrefs {
  return { ...p, open: !p.open }
}

export function openExploreTab(p: ReviewPanelPrefs): ReviewPanelPrefs {
  return { ...p, open: true, tab: 'explore' }
}
