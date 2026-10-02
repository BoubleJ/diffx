import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { makeRepo, commit, git } from '../test/gitRepo'
import { worktreeReader, commitReader, runGit, type GitFn, type SpawnFn } from './reader'

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
  it('reads working tree files and treats folders as missing', async () => {
    const { repo } = setup()
    const reader = worktreeReader(repo)
    expect(await reader.readFile('src/a.ts')).toBe('// changed\nexport const alpha = 1\n')
    expect(await reader.exists('src/a.ts')).toBe(true)
    expect(await reader.exists('src')).toBe(false)
    expect(await reader.readFile('../outside.ts')).toBeNull()
  })

  it('greps tracked and untracked source files outside build folders', async () => {
    const { repo } = setup()
    const hits = await worktreeReader(repo).grep('const alpha')
    expect(hits.map((h) => `${h.path}:${h.line}`).sort()).toEqual(['src/a.ts:2', 'src/new/b.ts:1'])
    expect(hits.find((h) => h.path === 'src/a.ts')!.text).toBe('export const alpha = 1')
  })
})

describe('commitReader', () => {
  it('reads files at the commit and treats folders as missing', async () => {
    const { repo, sha } = setup()
    const reader = commitReader(repo, sha)
    expect(await reader.readFile('src/a.ts')).toBe('export const alpha = 1\n')
    expect(await reader.readFile('src/new/b.ts')).toBeNull()
    expect(await reader.exists('src/a.ts')).toBe(true)
    expect(await reader.exists('src')).toBe(false)
  })

  it('greps the commit and strips the sha prefix', async () => {
    const { repo, sha } = setup()
    expect(await commitReader(repo, sha).grep('const alpha')).toEqual([{ path: 'src/a.ts', line: 1, text: 'export const alpha = 1' }])
  })
})

describe('commitReader with batched git', () => {
  const big = `${'x'.repeat(99)}\n`.repeat(2000)

  function counted(repo: string, sha: string) {
    const calls = { spawn: 0, lsTree: 0 }
    const procs: ChildProcessWithoutNullStreams[] = []
    const spawnFn: SpawnFn = (command, args, options) => {
      calls.spawn++
      const proc = spawn(command, args, options)
      procs.push(proc)
      return proc
    }
    const gitFn: GitFn = (dir, args, timeout) => {
      if (args[0] === 'ls-tree') calls.lsTree++
      return runGit(dir, args, timeout)
    }
    return { reader: commitReader(repo, sha, { spawn: spawnFn, git: gitFn }), calls, procs }
  }

  function setupBatch() {
    const repo = makeRepo()
    const sha = commit(repo, {
      'src/a.ts': 'export const a = 1\nexport const b = 2\n',
      'src/한글 파일.ts': 'export const 한 = 1\n',
      'src/empty/index.ts': '',
      'src/big.ts': big,
    }, 'base')
    return { repo, sha }
  }

  it('reads several files with one cat-file process and caches repeated reads', async () => {
    const { repo, sha } = setupBatch()
    const { reader, calls } = counted(repo, sha)
    const [a, korean, empty, large, again] = await Promise.all([
      reader.readFile('src/a.ts'),
      reader.readFile('src/한글 파일.ts'),
      reader.readFile('src/empty/index.ts'),
      reader.readFile('src/big.ts'),
      reader.readFile('src/a.ts'),
    ])
    expect(a).toBe('export const a = 1\nexport const b = 2\n')
    expect(korean).toBe('export const 한 = 1\n')
    expect(empty).toBe('')
    expect(large).toBe(big)
    expect(again).toBe(a)
    expect(calls.spawn).toBe(1)
    reader.close()
  })

  it('returns null for missing files, folders and paths with a newline', async () => {
    const { repo, sha } = setupBatch()
    const { reader } = counted(repo, sha)
    expect(await reader.readFile('src/none.ts')).toBeNull()
    expect(await reader.readFile('src')).toBeNull()
    expect(await reader.readFile('src/a\nb.ts')).toBeNull()
    expect(await reader.readFile('src/a.ts')).toBe('export const a = 1\nexport const b = 2\n')
    reader.close()
  })

  it('lists the tree once for many exists calls', async () => {
    const { repo, sha } = setupBatch()
    const { reader, calls } = counted(repo, sha)
    const results = await Promise.all([
      reader.exists('src/a.ts'),
      reader.exists('src/한글 파일.ts'),
      reader.exists('src/empty/index.ts'),
      reader.exists('src'),
      reader.exists('src/none.ts'),
      reader.exists('../outside.ts'),
    ])
    expect(results).toEqual([true, true, true, false, false, false])
    expect(await reader.exists('src/big.ts')).toBe(true)
    expect(calls.lsTree).toBe(1)
    reader.close()
  })

  it('stops the cat-file process on close and returns null afterwards', async () => {
    const { repo, sha } = setupBatch()
    const { reader, procs } = counted(repo, sha)
    expect(await reader.readFile('src/a.ts')).not.toBeNull()
    const pending = reader.readFile('src/big.ts')
    const closed = once(procs[0], 'close')
    reader.close()
    await closed
    expect(await pending).toBeNull()
    expect(await reader.readFile('src/empty/index.ts')).toBeNull()
  })
})

describe('commitReader with submodules', () => {
  it('treats a submodule entry as missing', async () => {
    const repo = makeRepo()
    const base = commit(repo, { 'src/a.ts': 'export const a = 1\n' }, 'base')
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${base},sub`)
    git(repo, 'commit', '-q', '-m', 'add submodule')
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    const reader = commitReader(repo, sha)
    expect(await reader.exists('sub')).toBe(false)
    expect(await reader.exists('src/a.ts')).toBe(true)
    expect(await reader.readFile('sub')).toBeNull()
    reader.close()
  })
})
