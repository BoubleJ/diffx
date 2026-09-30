import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnswerMarkdown } from './AnswerMarkdown'

const render = (text: string) => renderToStaticMarkup(createElement(AnswerMarkdown, { text }))

describe('AnswerMarkdown', () => {
  it('renders markdown lists, emphasis and inline code', () => {
    const html = render('- **굵게** 항목\n- `code` 항목')
    expect(html).toContain('<li><strong>굵게</strong> 항목</li>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders a fenced block as plain code before it is highlighted', () => {
    const html = render('```ts\nconst a = 1 < 2\n```')
    expect(html).toContain('<pre class="answer-code"><code>const a = 1 &lt; 2</code></pre>')
  })

  it('renders a fenced block without a language as plain code', () => {
    expect(render('```\nplain\n```')).toContain('<pre class="answer-code"><code>plain</code></pre>')
  })

  it('does not render raw HTML', () => {
    const html = render('<img src=x onerror="alert(1)"> 본문')
    expect(html).not.toContain('<img')
    expect(html).toContain('본문')
  })
})
