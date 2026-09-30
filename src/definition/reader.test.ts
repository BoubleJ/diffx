import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, commit } from '../test/gitRepo'
import { worktreeReader, commitReader } from './reader'

function setup() {
  const repo = makeRepo()
  const sha = commit(repo, {
    'src/a.ts': 'export const alpha = 1\n',
    'node_modules/pkg/index.ts': 'export const alpha = 2\n',
    'README.md': 'const alpha = 3\n',
  }, 'base')
  writeFileSync(join(repo, 'src/a.ts'), '// changed\nexport const alpha = 1\n')
  mkdirSync(join(repo, 'src/new'), { recursive: true })
  writeFileSync(join(repo, 'src/new/b.ts'), 'export const alpha = 4\n')
  return { repo, sha }
}

describe('worktreeReader', () => {
  it('reads working tree files and treats folders as missing', () => {
    const { repo } = setup()
    const reader = worktreeReader(repo)
    expect(reader.readFile('src/a.ts')).toBe('// changed\nexport const alpha = 1\n')
    expect(reader.exists('src/a.ts')).toBe(true)
    expect(reader.exists('src')).toBe(false)
    expect(reader.readFile('../outside.ts')).toBeNull()
  })

  it('greps tracked and untracked source files outside build folders', () => {
    const { repo } = setup()
    const hits = worktreeReader(repo).grep('const alpha')
    expect(hits.map((h) => `${h.path}:${h.line}`).sort()).toEqual(['src/a.ts:2', 'src/new/b.ts:1'])
    expect(hits.find((h) => h.path === 'src/a.ts')!.text).toBe('export const alpha = 1')
  })
})

describe('commitReader', () => {
  it('reads files at the commit and treats folders as missing', () => {
    const { repo, sha } = setup()
    const reader = commitReader(repo, sha)
    expect(reader.readFile('src/a.ts')).toBe('export const alpha = 1\n')
    expect(reader.readFile('src/new/b.ts')).toBeNull()
    expect(reader.exists('src/a.ts')).toBe(true)
    expect(reader.exists('src')).toBe(false)
  })

  it('greps the commit and strips the sha prefix', () => {
    const { repo, sha } = setup()
    expect(commitReader(repo, sha).grep('const alpha')).toEqual([{ path: 'src/a.ts', line: 1, text: 'export const alpha = 1' }])
  })
})
