import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, commit } from '../test/gitRepo'
import { worktreeReader, commitReader } from './reader'
import { resolveDefinition } from './resolve'

const PAGE = [
  "import main, { formatDate as fmt } from './utils/date'",
  "import { sum } from './utils'",
  "import * as utils from './utils'",
  "import React from 'react'",
  "import Comp from '@/components/Comp.vue'",
  "import { helper } from '#lib/helper'",
  'const local = 1',
  'export function run() {',
  '  return fmt(new Date()) + sum(local, 2) + main() + helper() + globalThing + missing() + $store',
  '}',
]

function chain(prefix: string, length: number): Record<string, string> {
  const files: Record<string, string> = {}
  for (let i = 0; i < length; i++) files[`src/chain/${prefix}${i}.ts`] = `export * from './${prefix}${i + 1}'\n`
  files[`src/chain/${prefix}${length}.ts`] = `export const ${prefix}Deep = 1\n`
  return files
}

function setup() {
  const repo = makeRepo()
  const sha = commit(repo, {
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "#lib/*": ["lib/*"] } } }',
    'src/utils/date.ts': 'export function formatDate(d: Date) {\n  return d\n}\nexport default function main() {}\n',
    'src/utils/index.ts': "export { formatDate } from './date'\nexport * from './math'\n",
    'src/utils/math.ts': 'export const sum = (a: number, b: number) => a + b\n',
    'src/page.ts': PAGE.join('\n') + '\n',
    'src/components/Comp.vue': '<template>\n  <p>{{ count }}</p>\n</template>\n<script setup lang="ts">\nimport { sum } from \'@/utils\'\nconst count = sum(1, 2)\n</script>\n',
    'lib/helper.ts': 'export function helper() {}\n',
    'src/global.ts': 'export const globalThing = 1\n',
    'src/other.ts': 'export const globalThing = 2\n',
    'src/store.ts': 'export const $store = {}\n',
    'README.md': 'const sum = 1\n',
    ...chain('a', 5),
    ...chain('b', 6),
    'src/chain/use.ts': "import { aDeep } from './a0'\nimport { bDeep } from './b0'\naDeep + bDeep\n",
  }, 'base')
  return { repo, sha }
}

function click(reader: ReturnType<typeof worktreeReader>, path: string, lineText: string, line: number, token: string) {
  return resolveDefinition(reader, path, line, lineText.indexOf(token))
}

describe('resolveDefinition', () => {
  it('opens import paths', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await click(reader, 'src/page.ts', PAGE[0], 1, "'./utils/date'")).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 1 }] })
    expect(await click(reader, 'src/page.ts', PAGE[4], 5, "'@/components")).toEqual({ kind: 'found', targets: [{ path: 'src/components/Comp.vue', line: 1 }] })
    expect(await click(reader, 'src/page.ts', PAGE[3], 4, "'react'")).toEqual({ kind: 'external', module: 'react' })
  })

  it('follows imported names to their export', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'fmt')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 1 }] })
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'sum')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/math.ts', line: 1 }] })
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'main')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 4 }] })
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'helper')).toEqual({ kind: 'found', targets: [{ path: 'lib/helper.ts', line: 1 }] })
    expect(await click(reader, 'src/page.ts', PAGE[2], 3, 'utils')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/index.ts', line: 1 }] })
    expect(await click(reader, 'src/page.ts', PAGE[3], 4, 'React')).toEqual({ kind: 'external', module: 'react' })
  })

  it('follows up to five re-exports and falls back to the imported file', async () => {
    const reader = worktreeReader(setup().repo)
    const use = ['', '', 'aDeep + bDeep']
    expect(await click(reader, 'src/chain/use.ts', use[2], 3, 'aDeep')).toEqual({ kind: 'found', targets: [{ path: 'src/chain/a5.ts', line: 1 }] })
    expect(await click(reader, 'src/chain/use.ts', use[2], 3, 'bDeep')).toEqual({ kind: 'found', targets: [{ path: 'src/chain/b0.ts', line: 1 }] })
  })

  it('finds local declarations and reports the declaration line itself', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'local')).toEqual({ kind: 'found', targets: [{ path: 'src/page.ts', line: 7 }] })
    expect(await click(reader, 'src/page.ts', PAGE[7], 8, 'run')).toEqual({ kind: 'self' })
  })

  it('searches the repository for other names', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'globalThing')).toEqual({
      kind: 'found',
      targets: [{ path: 'src/global.ts', line: 1 }, { path: 'src/other.ts', line: 1 }],
    })
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, 'missing')).toEqual({ kind: 'not_found' })
  })

  it('searches names containing $', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await click(reader, 'src/page.ts', PAGE[8], 9, '$store')).toEqual({ kind: 'found', targets: [{ path: 'src/store.ts', line: 1 }] })
  })

  it('handles names inside a vue file', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await resolveDefinition(reader, 'src/components/Comp.vue', 2, '  <p>{{ count }}</p>'.indexOf('count'))).toEqual({ kind: 'found', targets: [{ path: 'src/components/Comp.vue', line: 6 }] })
    expect(await resolveDefinition(reader, 'src/components/Comp.vue', 6, 'const count = sum(1, 2)'.indexOf('sum'))).toEqual({ kind: 'found', targets: [{ path: 'src/utils/math.ts', line: 1 }] })
  })

  it('returns not_found for non-source files and positions outside the file', async () => {
    const reader = worktreeReader(setup().repo)
    expect(await resolveDefinition(reader, 'README.md', 1, 6)).toEqual({ kind: 'not_found' })
    expect(await resolveDefinition(reader, 'src/page.ts', 999, 0)).toEqual({ kind: 'not_found' })
  })

  it('reads the requested version', async () => {
    const { repo, sha } = setup()
    writeFileSync(join(repo, 'src/utils/date.ts'), '// moved\n\nexport function formatDate(d: Date) {\n  return d\n}\n')
    expect(await click(commitReader(repo, sha), 'src/page.ts', PAGE[8], 9, 'fmt')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 1 }] })
    expect(await click(worktreeReader(repo), 'src/page.ts', PAGE[8], 9, 'fmt')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 3 }] })
  })
})

describe('repository search pattern', () => {
  it('anchors the git grep pattern at the start of a line so minified code is not returned', async () => {
    const patterns: string[] = []
    const reader = {
      readFile: async (path: string) => (path === 'src/x.ts' ? 'use(thing)\n' : null),
      exists: async () => false,
      grep: async (pattern: string) => {
        patterns.push(pattern)
        return []
      },
      close: () => {},
    }
    expect(await resolveDefinition(reader, 'src/x.ts', 1, 4)).toEqual({ kind: 'not_found' })
    expect(patterns).toHaveLength(1)
    expect(patterns[0].startsWith('^[[:space:]]*')).toBe(true)
  })
})
