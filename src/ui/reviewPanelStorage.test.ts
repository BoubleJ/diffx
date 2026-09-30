import { describe, it, expect } from 'vitest'
import { loadReviewPanel, saveReviewPanel, nextOnReviewButton, openExploreTab, REVIEW_PANEL_MIN } from './reviewPanelStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('reviewPanelStorage', () => {
  it('defaults to closed with 400px on the review tab', () => {
    expect(loadReviewPanel(memoryStorage())).toEqual({ open: false, size: 400, tab: 'review' })
  })

  it('round-trips and clamps the minimum size', () => {
    const s = memoryStorage()
    saveReviewPanel({ open: true, size: 100, tab: 'explore' }, s)
    expect(loadReviewPanel(s)).toEqual({ open: true, size: REVIEW_PANEL_MIN, tab: 'explore' })
  })

  it('reads prefs saved before tabs existed as the review tab', () => {
    const s = memoryStorage()
    s.setItem('diffx-review-panel', JSON.stringify({ open: true, size: 500 }))
    expect(loadReviewPanel(s)).toEqual({ open: true, size: 500, tab: 'review' })
  })
})

describe('panel tab switching', () => {
  const base = { size: 400 }
  it('opens, switches to, or closes the review tab from the toolbar button', () => {
    expect(nextOnReviewButton({ ...base, open: false, tab: 'explore' })).toEqual({ ...base, open: true, tab: 'review' })
    expect(nextOnReviewButton({ ...base, open: true, tab: 'explore' })).toEqual({ ...base, open: true, tab: 'review' })
    expect(nextOnReviewButton({ ...base, open: true, tab: 'review' })).toEqual({ ...base, open: false, tab: 'review' })
  })

  it('opens the explore tab', () => {
    expect(openExploreTab({ ...base, open: false, tab: 'review' })).toEqual({ ...base, open: true, tab: 'explore' })
  })
})
