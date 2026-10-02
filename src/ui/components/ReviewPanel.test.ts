import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionCard } from './ReviewPanel'

describe('QuestionCard', () => {
  it('shows the selected code location and keeps the code folded', () => {
    const html = renderToStaticMarkup(createElement(QuestionCard, {
      kind: 'question',
      question: '왜?',
      selection: { path: 'src/cart.ts', side: 'additions', startLine: 12, endLine: 13, code: 'const total = 1' },
    }))
    expect(html).toContain('src/cart.ts:12-13 · 선택한 코드')
    expect(html).toContain('<details class="review-question-selection">')
    expect(html).toContain('const total = 1')
    expect(html).toContain('왜?')
  })

  it('renders no selection block without a selection', () => {
    const html = renderToStaticMarkup(createElement(QuestionCard, { kind: 'question', question: '왜?' }))
    expect(html).not.toContain('review-question-selection')
  })
})
