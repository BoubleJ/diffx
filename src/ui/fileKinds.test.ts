import { describe, it, expect } from 'vitest'
import { checkState, fileKind, groupFileKinds } from './fileKinds'

describe('fileKind', () => {
  it('detects test files by .test., .spec. and __tests__', () => {
    expect(fileKind('src/App.test.tsx')).toBe('test')
    expect(fileKind('e2e/login.spec.ts')).toBe('test')
    expect(fileKind('src/__tests__/util.ts')).toBe('test')
    expect(fileKind('src/testing.ts')).toBe('.ts')
  })

  it('uses the last extension in lower case', () => {
    expect(fileKind('docs/guide.md')).toBe('.md')
    expect(fileKind('README.MD')).toBe('.md')
    expect(fileKind('src/types.d.ts')).toBe('.ts')
  })

  it('returns an empty kind for files without an extension', () => {
    expect(fileKind('Makefile')).toBe('')
    expect(fileKind('.gitignore')).toBe('')
    expect(fileKind('src/.env')).toBe('')
  })
})

describe('groupFileKinds', () => {
  it('puts test files first and does not count them under their extension', () => {
    const groups = groupFileKinds(['src/a.ts', 'src/b.ts', 'src/a.test.ts'])
    expect(groups).toEqual([
      { kind: 'test', label: '테스트 파일', paths: ['src/a.test.ts'] },
      { kind: '.ts', label: '.ts', paths: ['src/a.ts', 'src/b.ts'] },
    ])
  })

  it('orders the other kinds by file count then label', () => {
    const groups = groupFileKinds(['a.md', 'b.json', 'c.ts', 'd.ts', 'e.css'])
    expect(groups.map((g) => g.label)).toEqual(['.ts', '.css', '.json', '.md'])
  })

  it('puts files without an extension last', () => {
    const groups = groupFileKinds(['Makefile', 'Dockerfile', 'LICENSE', 'a.md'])
    expect(groups.map((g) => g.label)).toEqual(['.md', '확장자 없음'])
    expect(groups[1].paths).toEqual(['Makefile', 'Dockerfile', 'LICENSE'])
  })
})

describe('checkState', () => {
  it('reports whether all, some or none of the paths are selected', () => {
    const selected = new Set(['a', 'b'])
    expect(checkState(['a', 'b'], selected)).toBe('all')
    expect(checkState(['a', 'c'], selected)).toBe('some')
    expect(checkState(['c'], selected)).toBe('none')
    expect(checkState([], selected)).toBe('none')
  })
})
