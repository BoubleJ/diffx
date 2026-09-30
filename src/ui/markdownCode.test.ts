import { describe, it, expect } from 'vitest'
import { codeLanguage, hastText } from './markdownCode'

describe('codeLanguage', () => {
  it('reads the language from the code class name', () => {
    expect(codeLanguage('language-ts')).toBe('ts')
    expect(codeLanguage('foo language-TypeScript bar')).toBe('typescript')
    expect(codeLanguage('language-c++')).toBe('c++')
  })

  it('returns null without a language', () => {
    expect(codeLanguage(undefined)).toBeNull()
    expect(codeLanguage('')).toBeNull()
    expect(codeLanguage('hljs')).toBeNull()
  })
})

describe('hastText', () => {
  it('joins nested text values', () => {
    expect(hastText({ type: 'element', tagName: 'code', children: [{ type: 'text', value: 'a' }, { type: 'element', children: [{ type: 'text', value: 'b\n' }] }] })).toBe('ab\n')
    expect(hastText(undefined)).toBe('')
  })
})
