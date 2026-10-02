import { describe, it, expect } from 'vitest'
import { makeRepo, commit } from '../test/gitRepo'
import { worktreeReader } from './reader'
import { resolveModule, parseJsonc } from './modules'

function setup() {
  const repo = makeRepo()
  commit(repo, {
    'tsconfig.base.json': '{ "compilerOptions": { "baseUrl": "." } }',
    'tsconfig.json': '{\n  // 주석\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "paths": { "#lib/*": ["lib/*"] }, },\n}\n',
    'lib/helper.ts': 'export function helper() {}\n',
    'src/utils/date.ts': 'export const d = 1\n',
    'src/utils/index.ts': "export * from './date'\n",
    'src/esm.ts': 'export const e = 1\n',
    'src/components/Comp.vue': '<script setup lang="ts"></script>\n',
    'src/page.ts': '',
    'apps/web/tsconfig.json': '{ "compilerOptions": {} }',
    'apps/web/src/store.ts': 'export const s = 1\n',
    'apps/web/pages/index.ts': '',
  }, 'base')
  return worktreeReader(repo)
}

describe('parseJsonc', () => {
  it('allows comments and trailing commas but keeps strings intact', async () => {
    expect(parseJsonc('{ /* a */ "url": "http://x//y", "list": [1, 2,], }')).toEqual({ url: 'http://x//y', list: [1, 2] })
  })
})

describe('resolveModule', () => {
  it('resolves relative paths with extensions, index files, vue files and .js written for .ts', async () => {
    const reader = setup()
    expect(await resolveModule(reader, 'src/page.ts', './utils/date')).toEqual({ kind: 'file', path: 'src/utils/date.ts' })
    expect(await resolveModule(reader, 'src/page.ts', './utils')).toEqual({ kind: 'file', path: 'src/utils/index.ts' })
    expect(await resolveModule(reader, 'src/page.ts', './components/Comp.vue')).toEqual({ kind: 'file', path: 'src/components/Comp.vue' })
    expect(await resolveModule(reader, 'src/page.ts', './esm.js')).toEqual({ kind: 'file', path: 'src/esm.ts' })
    expect(await resolveModule(reader, 'src/page.ts', './nope')).toEqual({ kind: 'missing' })
  })

  it('uses tsconfig paths and baseUrl from extends', async () => {
    const reader = setup()
    expect(await resolveModule(reader, 'src/page.ts', '#lib/helper')).toEqual({ kind: 'file', path: 'lib/helper.ts' })
    expect(await resolveModule(reader, 'src/page.ts', 'src/utils/date')).toEqual({ kind: 'file', path: 'src/utils/date.ts' })
  })

  it('falls back to src/ for @/ and ~/', async () => {
    const reader = setup()
    expect(await resolveModule(reader, 'src/page.ts', '@/utils/date')).toEqual({ kind: 'file', path: 'src/utils/date.ts' })
    expect(await resolveModule(reader, 'src/page.ts', '~/components/Comp.vue')).toEqual({ kind: 'file', path: 'src/components/Comp.vue' })
  })

  it('resolves @/ against the nearest config folder in a monorepo', async () => {
    const reader = setup()
    expect(await resolveModule(reader, 'apps/web/pages/index.ts', '@/store')).toEqual({ kind: 'file', path: 'apps/web/src/store.ts' })
  })

  it('treats bare package names as external', async () => {
    const reader = setup()
    expect(await resolveModule(reader, 'src/page.ts', 'react')).toEqual({ kind: 'external' })
    expect(await resolveModule(reader, 'src/page.ts', '@tanstack/react-query')).toEqual({ kind: 'external' })
  })
})
