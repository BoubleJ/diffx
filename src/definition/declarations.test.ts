import { describe, it, expect } from 'vitest'
import { findDeclarationLines, findExport } from './declarations'

describe('findDeclarationLines', () => {
  it('finds each declaration form', () => {
    const text = [
      'export async function load() {}',
      'function* gen() {}',
      'export const total = 1',
      'let count = 0',
      'export default class Store {}',
      'interface Props {}',
      'export type Id = string',
      'export const enum Color { Red }',
      'declare namespace NS {}',
      'const { hidden } = obj',
      '  const $store = useStore()',
    ].join('\n')
    expect(findDeclarationLines(text, 'load')).toEqual([1])
    expect(findDeclarationLines(text, 'gen')).toEqual([2])
    expect(findDeclarationLines(text, 'total')).toEqual([3])
    expect(findDeclarationLines(text, 'count')).toEqual([4])
    expect(findDeclarationLines(text, 'Store')).toEqual([5])
    expect(findDeclarationLines(text, 'Props')).toEqual([6])
    expect(findDeclarationLines(text, 'Id')).toEqual([7])
    expect(findDeclarationLines(text, 'Color')).toEqual([8])
    expect(findDeclarationLines(text, 'NS')).toEqual([9])
    expect(findDeclarationLines(text, 'hidden')).toEqual([])
    expect(findDeclarationLines(text, '$store')).toEqual([11])
  })

  it('does not match longer names', () => {
    expect(findDeclarationLines('const totalCount = 1', 'total')).toEqual([])
  })
})

describe('findExport', () => {
  it('finds direct and default exports', () => {
    const text = 'export function formatDate() {}\nexport default function main() {}\n'
    expect(findExport(text, 'formatDate')).toEqual([{ kind: 'line', line: 1 }])
    expect(findExport(text, 'default')).toEqual([{ kind: 'line', line: 2 }])
  })

  it('maps export lists to the local declaration', () => {
    const text = 'function a() {}\nconst b = 1\nexport { a, b as renamed }\n'
    expect(findExport(text, 'a')).toEqual([{ kind: 'line', line: 1 }])
    expect(findExport(text, 'renamed')).toEqual([{ kind: 'line', line: 2 }])
  })

  it('returns re-exports to follow', () => {
    const text = "export { formatDate } from './date'\nexport { x as y } from './x'\nexport * from './math'\n"
    expect(findExport(text, 'formatDate')).toEqual([
      { kind: 'reexport', specifier: './date', name: 'formatDate' },
      { kind: 'reexport', specifier: './math', name: 'formatDate' },
    ])
    expect(findExport(text, 'y')[0]).toEqual({ kind: 'reexport', specifier: './x', name: 'x' })
  })
})
