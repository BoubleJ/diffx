import { describe, it, expect } from 'vitest'
import type { FileDiffMetadata } from '@pierre/diffs'
import { buildRepoTree, changeMarks, expandedDirsFor, filterRepoPaths } from './repoTree'

const diffFile = (name: string, prevObjectId: string, newObjectId: string, prevName?: string) =>
  ({ name, prevObjectId, newObjectId, prevName }) as FileDiffMetadata

describe('buildRepoTree', () => {
  it('nests paths with directories first, each level sorted by name', () => {
    const tree = buildRepoTree(['src/b.ts', 'README.md', 'src/a/x.ts', 'package.json', 'docs/guide.md'])
    expect(tree.map((n) => n.path)).toEqual(['docs', 'src', 'package.json', 'README.md'])
    const src = tree.find((n) => n.path === 'src')!
    expect(src.children.map((n) => [n.path, n.isDir])).toEqual([['src/a', true], ['src/b.ts', false]])
    expect(src.children[0].children.map((n) => n.path)).toEqual(['src/a/x.ts'])
  })
})

describe('changeMarks', () => {
  it('marks added files A and other changes M, skipping deleted files', () => {
    const marks = changeMarks([
      diffFile('new.ts', '0000000', 'abc1234'),
      diffFile('edit.ts', 'abc1234', 'def5678'),
      diffFile('moved.ts', 'abc1234', 'abc1234', 'old.ts'),
      diffFile('gone.ts', 'abc1234', '0000000'),
    ])
    expect([...marks]).toEqual([['new.ts', 'A'], ['edit.ts', 'M'], ['moved.ts', 'M']])
  })
})

describe('expandedDirsFor', () => {
  it('lists every ancestor directory of the given paths', () => {
    expect([...expandedDirsFor(['src/ui/App.tsx', 'src/git.ts', 'README.md'])].sort()).toEqual(['src', 'src/ui'])
  })
})

describe('filterRepoPaths', () => {
  const paths = ['src/ui/App.tsx', 'src/git.ts', 'docs/APP.md']

  it('matches case-insensitively and caps the result', () => {
    expect(filterRepoPaths(paths, 'app', 10)).toEqual({ paths: ['src/ui/App.tsx', 'docs/APP.md'], truncated: false })
    expect(filterRepoPaths(paths, 'a', 1)).toEqual({ paths: ['src/ui/App.tsx'], truncated: true })
  })

  it('ignores surrounding whitespace', () => {
    expect(filterRepoPaths(paths, '  git ', 10).paths).toEqual(['src/git.ts'])
  })
})
