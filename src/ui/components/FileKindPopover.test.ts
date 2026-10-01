import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileKindTable } from './FileKindPopover'
import { groupFileKinds } from '../fileKinds'

const noop = () => {}

function render(paths: string[], excluded: string[], viewed: string[]) {
  return renderToStaticMarkup(
    createElement(FileKindTable, {
      groups: groupFileKinds(paths),
      excluded: new Set(excluded),
      viewed: new Set(viewed),
      onExcludeMany: noop,
      onIncludeMany: noop,
      onViewedMany: noop,
    }),
  )
}

function checkbox(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<input[^>]*aria-label="${escaped}"[^>]*>`))
  if (!match) throw new Error(`checkbox not found: ${label}`)
  return match[0]
}

describe('FileKindTable', () => {
  it('renders a row per kind with its file count', () => {
    const html = render(['a.test.ts', 'b.test.ts', 'c.md'], [], [])
    expect(html).toContain('<th scope="row">테스트 파일</th><td class="fk-count">2개</td>')
    expect(html).toContain('<th scope="row">.md</th><td class="fk-count">1개</td>')
  })

  it('checks the exclude box only when every file of the kind is excluded', () => {
    const html = render(['a.md', 'b.md', 'c.ts', 'd.ts'], ['a.md', 'b.md', 'c.ts'], [])
    expect(checkbox(html, '.md 리뷰 제외')).toContain('checked=""')
    expect(checkbox(html, '.ts 리뷰 제외')).not.toContain('checked=""')
  })

  it('keeps kinds whose files are all excluded and disables their Viewed box', () => {
    const html = render(['a.md', 'b.ts'], ['a.md', 'b.ts'], [])
    expect(checkbox(html, '.md 리뷰 제외')).toContain('checked=""')
    expect(checkbox(html, '.md Viewed')).toContain('disabled=""')
    expect(checkbox(html, '.md Viewed')).not.toContain('checked=""')
  })

  it('uses only files that are not excluded for the Viewed box', () => {
    const html = render(['a.ts', 'b.ts'], ['a.ts'], ['b.ts'])
    expect(checkbox(html, '.ts Viewed')).toContain('checked=""')
    expect(checkbox(html, '.ts Viewed')).not.toContain('disabled=""')
  })
})
