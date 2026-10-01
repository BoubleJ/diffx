import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationRows } from './ConversationList'

const noop = () => {}
const at = new Date(2026, 8, 30, 18, 20).getTime()

const render = (items: { key: string; questionCount: number; lastAt: number; running: boolean }[], currentKey: string | null = null) =>
  renderToStaticMarkup(createElement(ConversationRows, { items, currentKey, onOpen: noop, onDelete: noop }))

describe('ConversationRows', () => {
  it('renders the label, question count and time and marks the current conversation', () => {
    const html = render([
      { key: 'branch:develop...feature/login', questionCount: 4, lastAt: at, running: false },
      { key: 'mr:128', questionCount: 1, lastAt: at, running: false },
    ], 'mr:128')
    expect(html).toContain('feature/login → develop')
    expect(html).toContain('질문 4개 · 2026-09-30 18:20')
    expect(html).toMatch(/<li class="conv-item conv-item-current">.*MR !128/)
  })

  it('disables delete for a running conversation', () => {
    const html = render([{ key: 'mr:1', questionCount: 1, lastAt: at, running: true }])
    expect(html).toContain('disabled=""')
  })

  it('shows a message when there is no conversation', () => {
    expect(render([])).toContain('저장된 대화가 없습니다')
  })
})
