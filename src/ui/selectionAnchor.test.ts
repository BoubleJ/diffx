import { describe, it, expect } from 'vitest'
import { pointVisible, scrolledPoint } from './selectionAnchor'

describe('scrolledPoint', () => {
  it('moves the point opposite to how far every scroller scrolled', () => {
    const origin = [{ top: 100, left: 0 }, { top: 0, left: 0 }]
    const current = [{ top: 250, left: 30 }, { top: 10, left: 0 }]
    expect(scrolledPoint({ x: 200, y: 400 }, origin, current)).toEqual({ x: 170, y: 240 })
  })

  it('keeps the point when nothing scrolled', () => {
    expect(scrolledPoint({ x: 1, y: 2 }, [{ top: 5, left: 5 }], [{ top: 5, left: 5 }])).toEqual({ x: 1, y: 2 })
  })
})

describe('pointVisible', () => {
  const main = { top: 50, bottom: 800, left: 300, right: 1200 }
  const viewport = { top: 0, bottom: 900, left: 0, right: 1400 }

  it('is visible only inside every clipping rect', () => {
    expect(pointVisible({ x: 500, y: 400 }, [main, viewport])).toBe(true)
    expect(pointVisible({ x: 500, y: 40 }, [main, viewport])).toBe(false)
    expect(pointVisible({ x: 500, y: 801 }, [main, viewport])).toBe(false)
    expect(pointVisible({ x: 250, y: 400 }, [main, viewport])).toBe(false)
  })
})
