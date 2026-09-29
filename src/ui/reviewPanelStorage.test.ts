import { describe, it, expect } from 'vitest'
import { loadReviewPanel, saveReviewPanel, REVIEW_PANEL_MIN } from './reviewPanelStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('reviewPanelStorage', () => {
  it('defaults to closed with 400px', () => {
    expect(loadReviewPanel(memoryStorage())).toEqual({ open: false, size: 400 })
  })

  it('round-trips and clamps the minimum size', () => {
    const s = memoryStorage()
    saveReviewPanel({ open: true, size: 100 }, s)
    expect(loadReviewPanel(s)).toEqual({ open: true, size: REVIEW_PANEL_MIN })
  })
})
