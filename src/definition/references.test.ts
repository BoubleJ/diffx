import { describe, it, expect } from 'vitest'
import { makeRepo, commit } from '../test/gitRepo'
import { worktreeReader } from './reader'
import { findSymbolReferences, findFileReferences, MAX_REFERENCES } from './references'

function setup(files: Record<string, string>) {
  const repo = makeRepo()
  commit(repo, files, 'base')
  return worktreeReader(repo)
}

const at = (text: string, lineNo: number, token: string) => {
  const line = text.split('\n')[lineNo - 1]
  return { line: lineNo, col: line.indexOf(token) }
}

const refs = (r: ReturnType<typeof findSymbolReferences>) => (r.kind === 'found' ? r.references.map((x) => `${x.path}:${x.line}`) : r.kind)

const DATE = 'export function formatDate(d: Date) {\n  return d\n}\nexport default function main() {}\nformatDate(new Date())\n'

describe('findSymbolReferences', () => {
  it('lists uses in the same file without the declaration line', () => {
    const reader = setup({ 'src/date.ts': DATE })
    const { line, col } = at(DATE, 1, 'formatDate')
    const result = findSymbolReferences(reader, 'src/date.ts', line, col)
    expect(result).toMatchObject({ kind: 'found', name: 'formatDate', truncated: false })
    expect(refs(result)).toEqual(['src/date.ts:5'])
  })

  it('follows named, renamed, namespace, default and alias imports', () => {
    const reader = setup({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
      'src/date.ts': DATE,
      'src/a.ts': "import { formatDate } from './date'\nformatDate(1)\n",
      'src/b.ts': "import { formatDate as fmt } from './date'\nfmt(1)\nformatDate(2)\n",
      'src/c.ts': "import * as d from './date'\nd.formatDate(1)\n",
      'src/d.ts': "import { formatDate } from '@/date'\nformatDate(1)\n",
      'src/e.ts': "import run from './date'\nrun()\n",
      'src/f.ts': 'const formatDate = 1\nformatDate\n',
    })
    const named = findSymbolReferences(reader, 'src/date.ts', 1, DATE.indexOf('formatDate'))
    expect(refs(named)).toEqual(['src/a.ts:1', 'src/a.ts:2', 'src/b.ts:1', 'src/b.ts:2', 'src/c.ts:1', 'src/c.ts:2', 'src/d.ts:1', 'src/d.ts:2', 'src/date.ts:5'])

    const def = at(DATE, 4, 'main')
    expect(refs(findSymbolReferences(reader, 'src/date.ts', def.line, def.col))).toEqual(['src/e.ts:1', 'src/e.ts:2'])
  })

  it('follows re-exports through index files', () => {
    const reader = setup({
      'src/utils/date.ts': DATE,
      'src/utils/index.ts': "export { formatDate } from './date'\nexport { formatDate as fd } from './date'\n",
      'src/star/index.ts': "export * from '../utils/date'\n",
      'src/page.ts': "import { formatDate, fd } from './utils'\nformatDate(1)\nfd(2)\n",
      'src/other.ts': "import { formatDate } from './star'\nformatDate(3)\n",
    })
    const result = findSymbolReferences(reader, 'src/utils/date.ts', 1, DATE.indexOf('formatDate'))
    expect(refs(result)).toEqual([
      'src/other.ts:1', 'src/other.ts:2',
      'src/page.ts:1', 'src/page.ts:2', 'src/page.ts:3',
      'src/star/index.ts:1',
      'src/utils/date.ts:5',
      'src/utils/index.ts:1', 'src/utils/index.ts:2',
    ])
  })

  it('searches only the declaring file for declarations that are not exported', () => {
    const text = 'const local = 1\nlocal + 1\n'
    const reader = setup({ 'src/a.ts': text, 'src/b.ts': 'const local = 2\nlocal\n' })
    expect(refs(findSymbolReferences(reader, 'src/a.ts', 1, text.indexOf('local')))).toEqual(['src/a.ts:2'])
  })

  it('finds references of a declaration in a vue file', () => {
    const vue = '<template>\n  <p>{{ count }}</p>\n</template>\n<script setup lang="ts">\nconst count = 1\nconsole.log(count)\n</script>\n'
    const reader = setup({ 'src/Comp.vue': vue })
    const { line, col } = at(vue, 5, 'count')
    expect(refs(findSymbolReferences(reader, 'src/Comp.vue', line, col))).toEqual(['src/Comp.vue:2', 'src/Comp.vue:6'])
  })

  it('returns not_declaration outside a declaration', () => {
    const reader = setup({ 'src/date.ts': DATE })
    const { line, col } = at(DATE, 5, 'formatDate')
    expect(findSymbolReferences(reader, 'src/date.ts', line, col)).toEqual({ kind: 'not_declaration' })
    expect(findSymbolReferences(reader, 'src/date.ts', 1, 0)).toEqual({ kind: 'not_declaration' })
  })

  it('stops on re-export cycles', () => {
    const reader = setup({
      'src/a.ts': "export const value = 1\nexport * from './b'\n",
      'src/b.ts': "export * from './a'\n",
      'src/use.ts': "import { value } from './b'\nvalue\n",
    })
    expect(refs(findSymbolReferences(reader, 'src/a.ts', 1, 'export const '.length))).toEqual(['src/a.ts:2', 'src/b.ts:1', 'src/use.ts:1', 'src/use.ts:2'])
  })

  it('truncates at 200 references', () => {
    const body = Array.from({ length: MAX_REFERENCES + 5 }, () => 'hit()').join('\n')
    const reader = setup({ 'src/a.ts': `export function hit() {}\n${body}\n` })
    const result = findSymbolReferences(reader, 'src/a.ts', 1, 'export function '.length)
    expect(result.kind === 'found' && result.references.length).toBe(MAX_REFERENCES)
    expect(result).toMatchObject({ truncated: true })
  })
})

describe('findFileReferences', () => {
  it('lists lines that import the file', () => {
    const reader = setup({
      'src/utils/date.ts': DATE,
      'src/utils/index.ts': "export * from './date'\n",
      'src/a.ts': "import { formatDate } from './utils/date'\n",
      'src/b.ts': "import './utils/date'\n",
      'src/c.ts': "const m = import('./utils/date')\n",
      'src/d.ts': "import { x } from './date'\n",
      'src/e.ts': "import { formatDate } from './utils'\n",
    })
    const result = findFileReferences(reader, 'src/utils/date.ts')
    expect(result).toMatchObject({ kind: 'found', name: 'date' })
    expect(refs(result)).toEqual(['src/a.ts:1', 'src/b.ts:1', 'src/c.ts:1', 'src/utils/index.ts:1'])
    expect(refs(findFileReferences(reader, 'src/utils/index.ts'))).toEqual(['src/e.ts:1'])
  })
})
