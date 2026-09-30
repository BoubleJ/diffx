# 코드 사용처 보기와 코드 탐색 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정의 자리나 파일 경로를 Cmd+클릭하면 사용처 목록을 오른쪽 패널의 `코드 탐색` 탭에 보여주고, 정의 후보 목록도 같은 탭으로 옮긴다.

**Architecture:** 서버에 `src/definition/references.ts`(import 확인 기반 사용처 검색)와 `GET /api/references`를 추가한다. 화면은 오른쪽 패널을 `AI 리뷰 | 코드 탐색` 탭으로 나누고, `handleDefinition`이 후보 목록과 사용처 목록을 `코드 탐색` 탭 상태로 넣는다. 파일 경로 Cmd+클릭은 카드 헤더의 `data-title` 요소를 `composedPath()`로 찾아 처리한다.

**Tech Stack:** TypeScript, Hono, React 19, `@pierre/diffs`, vitest, git grep

**Spec:** `docs/superpowers/specs/2026-09-30-code-references-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 최대 개수: 200곳 (`MAX_REFERENCES = 200`)
- 다시 내보내기 추적 깊이: 5단계 (`resolve.ts`의 `MAX_REEXPORT_DEPTH`와 같은 값)
- `git grep` 시간 제한은 `reader.ts`의 기존 10초를 그대로 쓴다.
- 탭 이름: `AI 리뷰`, `코드 탐색`
- 화면 문구: "`<이름>` 사용처", "`<이름>` 정의 후보", "`<파일 이름>`을 import하는 곳", "사용처를 찾는 중입니다", "사용처를 찾지 못했습니다", "사용처를 찾는 중 오류가 났습니다", "200곳까지만 표시합니다", 개수 "`N`곳"
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 빌드: `pnpm run build:electron`. 작업 시작 시점에 테스트 278개가 통과한다.

## Review Focus

1. `.vue` 파일의 `<script setup>` 안 선언을 Cmd+클릭해도 사용처가 나와야 한다. Task 1 `finds references of a declaration in a vue file`이 확인한다.
2. 파일끼리 서로 다시 내보내는 순환(`a.ts` ↔ `b.ts`)이 있어도 검색이 끝나야 한다. Task 1 `stops on re-export cycles`가 확인한다.
3. `format`처럼 흔한 이름을 export한 선언은 결과가 200곳을 넘을 수 있다. 200곳에서 자르고 `truncated`를 붙여야 한다. Task 1 `truncates at 200 references`가 확인한다.
4. 삭제된 줄 쪽에서 Cmd+클릭하면 이전 버전(merge-base)의 사용처를 보여줘야 한다. Task 2 `reads the merge-base for deleted lines`가 확인한다.
5. 검색 중에 다른 곳을 Cmd+클릭하면 이전 요청의 결과가 나중에 도착해도 화면을 덮어쓰지 않아야 한다. Task 3 `createRequestGate`의 테스트가 확인한다.

---

### Task 1: 사용처 검색 (`src/definition/references.ts`)

**Files:**
- Create: `src/definition/references.ts`
- Test: `src/definition/references.test.ts`

**Interfaces:**
- Consumes: `SourceReader`(`src/definition/reader.ts`: `readFile`, `exists`, `grep(pattern)` → `{ path, line, text }[]`, `git grep -E` 문법), `classifyToken`(`token.ts`), `findDeclarationLines`, `findExport`(`declarations.ts`), `parseImports`(`imports.ts`: `Map<로컬 이름, { specifier, imported }>`, `imported`는 이름, `'default'`, `'*'`), `resolveModule`(`modules.ts`), `isSourceFile`(`sourceFiles.ts`)
- Produces:
  - `export interface Reference { path: string; line: number; text: string }`
  - `export type ReferencesResult = { kind: 'found'; name: string; references: Reference[]; truncated: boolean } | { kind: 'not_declaration' }`
  - `export const MAX_REFERENCES = 200`
  - `export function findSymbolReferences(reader: SourceReader, filePath: string, line: number, col: number): ReferencesResult`
  - `export function findFileReferences(reader: SourceReader, filePath: string): ReferencesResult` (`name`은 확장자를 뺀 파일 이름)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/definition/references.test.ts`:

```ts
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
```

순환 테스트에서 `a.ts:2`(`export * from './b'`)는 순환 때문에 `b.ts`를 다시 내보내는 줄이라 사용처에 들어간다. 같은 대상을 두 번 따라가지 않으므로 검색은 끝난다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/definition/references.test.ts`
Expected: FAIL (`./references` 모듈 없음)

- [ ] **Step 3: 구현**

`src/definition/references.ts`:

```ts
import { posix } from 'node:path'
import { classifyToken } from './token.js'
import { findDeclarationLines, findExport } from './declarations.js'
import { parseImports } from './imports.js'
import { resolveModule } from './modules.js'
import type { SourceReader } from './reader.js'

export interface Reference {
  path: string
  line: number
  text: string
}

export type ReferencesResult =
  | { kind: 'found'; name: string; references: Reference[]; truncated: boolean }
  | { kind: 'not_declaration' }

export const MAX_REFERENCES = 200
const MAX_REEXPORT_DEPTH = 5
const IDENT = 'A-Za-z0-9_$'
const SPECIFIER_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g

const escapeJs = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function wordRegex(word: string): RegExp {
  return new RegExp(`(^|[^${IDENT}])${escapeJs(word)}(?![${IDENT}])`)
}

function matchingLines(path: string, text: string, re: RegExp): Reference[] {
  const out: Reference[] = []
  text.split('\n').forEach((lineText, i) => {
    if (re.test(lineText)) out.push({ path, line: i + 1, text: lineText })
  })
  return out
}

function moduleName(path: string): string {
  const base = posix.basename(path).replace(/\.[^.]+$/, '')
  return base === 'index' ? posix.basename(posix.dirname(path)) : base
}

interface Importer {
  path: string
  text: string
  specifierLines: Reference[]
  specifiers: Set<string>
}

function createResolver(reader: SourceReader) {
  const cache = new Map<string, string | null>()
  return (from: string, specifier: string): string | null => {
    const key = `${from}\n${specifier}`
    if (!cache.has(key)) {
      const r = resolveModule(reader, from, specifier)
      cache.set(key, r.kind === 'file' ? r.path : null)
    }
    return cache.get(key)!
  }
}

function findImporters(reader: SourceReader, target: string, resolve: ReturnType<typeof createResolver>): Importer[] {
  const name = moduleName(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hits = reader.grep(`['"/]${name}(/index)?(\\.[A-Za-z]+)?['"]`)
  const paths = [...new Set(hits.map((h) => h.path))].filter((p) => p !== target)
  const importers: Importer[] = []
  for (const path of paths) {
    const text = reader.readFile(path)
    if (text === null) continue
    const specifierLines: Reference[] = []
    const specifiers = new Set<string>()
    text.split('\n').forEach((lineText, i) => {
      for (const m of lineText.matchAll(SPECIFIER_RE)) {
        if (resolve(path, m[1]) !== target) continue
        specifiers.add(m[1])
        if (!specifierLines.some((r) => r.line === i + 1)) specifierLines.push({ path, line: i + 1, text: lineText })
      }
    })
    if (specifierLines.length > 0) importers.push({ path, text, specifierLines, specifiers })
  }
  return importers
}

function reexportedNames(text: string, specifiers: Set<string>, exported: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!specifiers.has(m[2])) continue
    for (const part of m[1].split(',')) {
      const pm = part.trim().replace(/^type\s+/, '').match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
      if (pm && pm[1] === exported) names.push(pm[2] ?? pm[1])
    }
  }
  if (exported !== 'default') {
    for (const m of text.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
      if (specifiers.has(m[1])) names.push(exported)
    }
  }
  return names
}

function finish(name: string, list: Reference[]): ReferencesResult {
  const seen = new Set<string>()
  const unique = list.filter((r) => {
    const key = `${r.path}:${r.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
  return { kind: 'found', name, references: unique.slice(0, MAX_REFERENCES), truncated: unique.length > MAX_REFERENCES }
}

export function findSymbolReferences(reader: SourceReader, filePath: string, line: number, col: number): ReferencesResult {
  const text = reader.readFile(filePath)
  const lineText = text?.split('\n')[line - 1]
  if (text === null || lineText === undefined) return { kind: 'not_declaration' }
  const token = classifyToken(lineText, col, { vue: filePath.endsWith('.vue') })
  if (token?.kind !== 'identifier' || !findDeclarationLines(text, token.name).includes(line)) return { kind: 'not_declaration' }
  const name = token.name

  const found = matchingLines(filePath, text, wordRegex(name)).filter((r) => r.line !== line)
  const exported = /^\s*export\s+default\b/.test(lineText)
    ? 'default'
    : findExport(text, name).some((m) => m.kind === 'line') ? name : null
  if (!exported) return finish(name, found)

  const resolve = createResolver(reader)
  const visited = new Set<string>()
  const queue: { file: string; exported: string; depth: number }[] = [{ file: filePath, exported, depth: 0 }]
  while (queue.length > 0) {
    const current = queue.shift()!
    const key = `${current.file}#${current.exported}`
    if (visited.has(key)) continue
    visited.add(key)
    for (const importer of findImporters(reader, current.file, resolve)) {
      for (const [local, binding] of parseImports(importer.text)) {
        if (!importer.specifiers.has(binding.specifier)) continue
        if (binding.imported === '*') {
          if (current.exported === 'default') continue
          found.push(...importer.specifierLines, ...matchingLines(importer.path, importer.text, wordRegex(`${local}.${current.exported}`)))
        } else if (binding.imported === current.exported) {
          found.push(...importer.specifierLines, ...matchingLines(importer.path, importer.text, wordRegex(local)))
        }
      }
      if (current.depth >= MAX_REEXPORT_DEPTH) continue
      for (const next of reexportedNames(importer.text, importer.specifiers, current.exported)) {
        found.push(...importer.specifierLines)
        queue.push({ file: importer.path, exported: next, depth: current.depth + 1 })
      }
    }
  }
  return finish(name, found)
}

export function findFileReferences(reader: SourceReader, filePath: string): ReferencesResult {
  const importers = findImporters(reader, filePath, createResolver(reader))
  return finish(posix.basename(filePath).replace(/\.[^.]+$/, ''), importers.flatMap((i) => i.specifierLines))
}
```

`wordRegex('d.formatDate')`는 `.`을 이스케이프하므로 `d.formatDate`만 찾는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/definition/references.test.ts`
Expected: PASS. 기대값의 줄 목록이 다르면 테스트 입력을 다시 읽고 구현을 고친다. 기대값을 구현에 맞춰 바꾸지 않는다. 테스트 입력 자체가 spec과 맞지 않는다고 판단되면 보고에 적는다.

- [ ] **Step 5: 커밋**

```bash
git add src/definition/references.ts src/definition/references.test.ts
git commit -m "feat: import를 따라가 함수와 파일의 사용처를 찾는 검색 추가"
```

---

### Task 2: `/api/references`와 정의 후보의 코드 줄

**Files:**
- Modify: `src/server.ts` (`/api/definition` 근처, `readerFor` 재사용)
- Test: `src/server.definition.test.ts`

**Interfaces:**
- Consumes: `findSymbolReferences`, `findFileReferences`(Task 1), `readerFor(c, side)`(기존)
- Produces:
  - `GET /api/references?<비교 조합>&path&side&line&col` → `{ kind: 'found', name, version: 'new' | 'old', references: [{ path, line, text }], truncated }` 또는 `{ kind: 'not_declaration' }`
  - `GET /api/references?<비교 조합>&path&side&scope=file` → 같은 형태
  - `/api/definition`의 `found` 응답 `targets` 항목에 `text: string`(그 줄의 코드, 읽지 못하면 `''`) 추가

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server.definition.test.ts`에서 기존 `found` 기대값의 `targets` 항목에 `text`를 넣는다. `setup()`의 `feature/x` 커밋에서 `src/a.ts` 2번째 줄은 `export function greet() {}`, merge-base의 1번째 줄도 같다:

```ts
    expect(body).toEqual({ kind: 'found', version: 'new', targets: [{ path: 'src/a.ts', line: 2, text: 'export function greet() {}' }] })
```

```ts
    expect(body).toEqual({ kind: 'found', version: 'old', targets: [{ path: 'src/a.ts', line: 1, text: 'export function greet() {}' }] })
```

파일 끝에 추가:

```ts
describe('GET /api/references', () => {
  it('lists uses of the declaration from the source commit', async () => {
    const app = setup()
    const body = await (await app.request(`/api/references?${branch}&side=additions&path=src/a.ts&line=2&col=16`)).json()
    expect(body).toEqual({ kind: 'found', name: 'greet', version: 'new', truncated: false, references: [
      { path: 'src/b.ts', line: 1, text: "import { greet } from './a'" },
      { path: 'src/b.ts', line: 2, text: 'greet()' },
    ] })
  })

  it('reads the merge-base for deleted lines', async () => {
    const app = setup()
    const body = await (await app.request(`/api/references?${branch}&side=deletions&path=src/a.ts&line=1&col=16`)).json()
    expect(body).toMatchObject({ kind: 'found', version: 'old', references: [{ path: 'src/b.ts', line: 1 }, { path: 'src/b.ts', line: 2 }] })
  })

  it('lists files that import a file', async () => {
    const app = setup()
    const body = await (await app.request(`/api/references?${branch}&side=additions&path=src/a.ts&scope=file`)).json()
    expect(body).toEqual({ kind: 'found', name: 'a', version: 'new', truncated: false, references: [{ path: 'src/b.ts', line: 1, text: "import { greet } from './a'" }] })
  })

  it('returns not_declaration and rejects invalid queries', async () => {
    const app = setup()
    expect(await (await app.request(`/api/references?${branch}&side=additions&path=src/b.ts&line=2&col=0`)).json()).toEqual({ kind: 'not_declaration' })
    for (const q of ['side=additions&path=src/a.ts&line=2&col=16', `${branch}&side=x&path=src/a.ts&line=2&col=16`, `${branch}&side=additions&path=../x&line=2&col=16`, `${branch}&side=additions&path=src/a.ts&line=0&col=0`]) {
      expect((await app.request(`/api/references?${q}`)).status).toBe(400)
    }
  })
})
```

`col=16`은 `export function greet`에서 `greet`의 시작 위치다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/server.definition.test.ts`
Expected: FAIL (`text` 없음, `/api/references` 404)

- [ ] **Step 3: 구현**

`src/server.ts` import에 추가:

```ts
import { findSymbolReferences, findFileReferences } from './definition/references.js'
```

`/api/definition` 핸들러의 마지막 줄을 바꾼다:

```ts
    const result = resolveDefinition(reader, path, Number(line), Number(col))
    if (result.kind !== 'found') return c.json(result)
    const targets = result.targets.map((t) => ({ ...t, text: reader.readFile(t.path)?.split('\n')[t.line - 1] ?? '' }))
    return c.json({ kind: 'found', version: side === 'additions' ? 'new' : 'old', targets })
```

`/api/definition` 핸들러 바로 뒤에 추가:

```ts
  app.get('/api/references', async (c) => {
    const path = c.req.query('path')
    const side = c.req.query('side')
    const line = c.req.query('line') ?? ''
    const col = c.req.query('col') ?? ''
    const fileTarget = c.req.query('scope') === 'file'
    if (!path || !isSafePath(path, repo) || (side !== 'additions' && side !== 'deletions')) {
      return c.json({ error: 'invalid_query' }, 400)
    }
    if (!fileTarget && (!/^[1-9]\d*$/.test(line) || !/^\d+$/.test(col))) {
      return c.json({ error: 'invalid_query' }, 400)
    }
    let reader: SourceReader
    try {
      reader = await readerFor(c, side)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const result = fileTarget ? findFileReferences(reader, path) : findSymbolReferences(reader, path, Number(line), Number(col))
    return c.json(result.kind === 'found' ? { ...result, version: side === 'additions' ? 'new' : 'old' } : result)
  })
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/server.definition.test.ts src/definition`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/server.ts src/server.definition.test.ts
git commit -m "feat: 사용처 조회 API 추가와 정의 후보에 코드 줄 포함"
```

---

### Task 3: 화면 데이터 처리 (정의 결과, 사용처 요청, 패널 탭 상태)

**Files:**
- Modify: `src/ui/definition.ts`, `src/ui/reviewPanelStorage.ts`
- Create: `src/ui/requestGate.ts`
- Test: `src/ui/definition.test.ts`, `src/ui/reviewPanelStorage.test.ts`, `src/ui/requestGate.test.ts`

**Interfaces:**
- Consumes: `/api/references` 응답(Task 2), `/api/definition`의 `targets[].text`(Task 2)
- Produces (`src/ui/definition.ts`):
  - `DefinitionRequest`에 `name?: string` 추가 (Cmd+클릭한 토큰의 글자, 요청 쿼리에는 넣지 않는다)
  - `DefinitionTarget = { path: string; line: number; text?: string }`
  - `DefinitionAction`에 `{ type: 'references' }` 추가. `definitionAction({ kind: 'self' })`가 이것을 돌려준다
  - `export type ReferencesRequest = { path: string; side: 'additions' | 'deletions'; line: number; col: number } | { path: string; side: 'additions' | 'deletions'; scope: 'file' }`
  - `export type ReferencesResponse = { kind: 'found'; name: string; version: DefinitionVersion; references: { path: string; line: number; text: string }[]; truncated: boolean } | { kind: 'not_declaration' }`
  - `export async function fetchReferences(contentQuery: string, req: ReferencesRequest): Promise<ReferencesResponse>`
  - `export interface ExploreItem { path: string; line: number; text?: string }`
  - `export type ExploreState = { status: 'idle' } | { status: 'loading'; title: string } | { status: 'error'; title: string } | { status: 'ready'; title: string; items: ExploreItem[]; truncated: boolean; version: DefinitionVersion }`
  - `export function groupByFile(items: ExploreItem[]): { path: string; items: ExploreItem[] }[]` (처음 나온 순서 유지)
  - `export const exploreTitle = { references: (name: string) => \`${name} 사용처\`, candidates: (name: string) => \`${name} 정의 후보\`, importers: (name: string) => \`${name}을 import하는 곳\` }`
- Produces (`src/ui/reviewPanelStorage.ts`):
  - `ReviewPanelPrefs = { open: boolean; size: number; tab: 'review' | 'explore' }`
  - `export function nextOnReviewButton(p: ReviewPanelPrefs): ReviewPanelPrefs`
  - `export function openExploreTab(p: ReviewPanelPrefs): ReviewPanelPrefs`
- Produces (`src/ui/requestGate.ts`): `export function createRequestGate(): { next(): number; isLatest(id: number): boolean }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/ui/definition.test.ts`의 `shows a message for the other results`에서 `self` 줄을 지우고 테스트를 추가한다:

```ts
import { definitionAction, groupByFile, exploreTitle } from './definition'
```

```ts
  it('opens references on the declaration itself', () => {
    expect(definitionAction({ kind: 'self' })).toEqual({ type: 'references' })
  })
})

describe('groupByFile', () => {
  it('groups items by path in first-seen order', () => {
    expect(groupByFile([{ path: 'b.ts', line: 1 }, { path: 'a.ts', line: 2 }, { path: 'b.ts', line: 5 }])).toEqual([
      { path: 'b.ts', items: [{ path: 'b.ts', line: 1 }, { path: 'b.ts', line: 5 }] },
      { path: 'a.ts', items: [{ path: 'a.ts', line: 2 }] },
    ])
  })
})

describe('exploreTitle', () => {
  it('builds panel titles', () => {
    expect(exploreTitle.references('useComments')).toBe('useComments 사용처')
    expect(exploreTitle.candidates('format')).toBe('format 정의 후보')
    expect(exploreTitle.importers('App')).toBe('App을 import하는 곳')
  })
})
```

`src/ui/reviewPanelStorage.test.ts`를 다음으로 바꾼다:

```ts
import { describe, it, expect } from 'vitest'
import { loadReviewPanel, saveReviewPanel, nextOnReviewButton, openExploreTab, REVIEW_PANEL_MIN } from './reviewPanelStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('reviewPanelStorage', () => {
  it('defaults to closed with 400px on the review tab', () => {
    expect(loadReviewPanel(memoryStorage())).toEqual({ open: false, size: 400, tab: 'review' })
  })

  it('round-trips and clamps the minimum size', () => {
    const s = memoryStorage()
    saveReviewPanel({ open: true, size: 100, tab: 'explore' }, s)
    expect(loadReviewPanel(s)).toEqual({ open: true, size: REVIEW_PANEL_MIN, tab: 'explore' })
  })

  it('reads prefs saved before tabs existed as the review tab', () => {
    const s = memoryStorage()
    s.setItem('diffx-review-panel', JSON.stringify({ open: true, size: 500 }))
    expect(loadReviewPanel(s)).toEqual({ open: true, size: 500, tab: 'review' })
  })
})

describe('panel tab switching', () => {
  const base = { size: 400 }
  it('opens, switches to, or closes the review tab from the toolbar button', () => {
    expect(nextOnReviewButton({ ...base, open: false, tab: 'explore' })).toEqual({ ...base, open: true, tab: 'review' })
    expect(nextOnReviewButton({ ...base, open: true, tab: 'explore' })).toEqual({ ...base, open: true, tab: 'review' })
    expect(nextOnReviewButton({ ...base, open: true, tab: 'review' })).toEqual({ ...base, open: false, tab: 'review' })
  })

  it('opens the explore tab', () => {
    expect(openExploreTab({ ...base, open: false, tab: 'review' })).toEqual({ ...base, open: true, tab: 'explore' })
  })
})
```

`src/ui/requestGate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRequestGate } from './requestGate'

describe('createRequestGate', () => {
  it('treats only the most recent request as current', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    expect(gate.isLatest(first)).toBe(false)
    expect(gate.isLatest(second)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/ui/definition.test.ts src/ui/reviewPanelStorage.test.ts src/ui/requestGate.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/ui/definition.ts`:
- `DefinitionRequest`에 `name?: string`을 추가한다. `fetchDefinition`은 지금처럼 `path`, `side`, `line`, `col`만 쿼리에 넣는다.
- `DefinitionTarget`에 `text?: string`을 추가한다.
- `DefinitionAction`에 `| { type: 'references' }`를 추가하고, `definitionAction`의 `self` 줄을 `if (res.kind === 'self') return { type: 'references' }`로 바꾼다.
- 파일 끝에 추가:

```ts
export type ReferencesRequest =
  | { path: string; side: 'additions' | 'deletions'; line: number; col: number }
  | { path: string; side: 'additions' | 'deletions'; scope: 'file' }

export type ReferencesResponse =
  | { kind: 'found'; name: string; version: DefinitionVersion; references: { path: string; line: number; text: string }[]; truncated: boolean }
  | { kind: 'not_declaration' }

export async function fetchReferences(contentQuery: string, req: ReferencesRequest): Promise<ReferencesResponse> {
  const q = new URLSearchParams(contentQuery)
  q.set('path', req.path)
  q.set('side', req.side)
  if ('scope' in req) {
    q.set('scope', req.scope)
  } else {
    q.set('line', String(req.line))
    q.set('col', String(req.col))
  }
  const res = await fetch(`/api/references?${q}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface ExploreItem {
  path: string
  line: number
  text?: string
}

export type ExploreState =
  | { status: 'idle' }
  | { status: 'loading'; title: string }
  | { status: 'error'; title: string }
  | { status: 'ready'; title: string; items: ExploreItem[]; truncated: boolean; version: DefinitionVersion }

export function groupByFile(items: ExploreItem[]): { path: string; items: ExploreItem[] }[] {
  const groups = new Map<string, ExploreItem[]>()
  for (const item of items) {
    const list = groups.get(item.path) ?? []
    list.push(item)
    groups.set(item.path, list)
  }
  return [...groups].map(([path, list]) => ({ path, items: list }))
}

export const exploreTitle = {
  references: (name: string) => `${name} 사용처`,
  candidates: (name: string) => `${name} 정의 후보`,
  importers: (name: string) => `${name}을 import하는 곳`,
}
```

`src/ui/reviewPanelStorage.ts`를 다음으로 바꾼다:

```ts
const STORAGE_KEY = 'diffx-review-panel'

export interface ReviewPanelPrefs {
  open: boolean
  size: number
  tab: 'review' | 'explore'
}

export const REVIEW_PANEL_MIN = 280
const DEFAULTS: ReviewPanelPrefs = { open: false, size: 400, tab: 'review' }

export function loadReviewPanel(storage: Pick<Storage, 'getItem'> = localStorage): ReviewPanelPrefs {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof parsed?.open === 'boolean' && typeof parsed?.size === 'number') {
      return { open: parsed.open, size: Math.max(REVIEW_PANEL_MIN, parsed.size), tab: parsed.tab === 'explore' ? 'explore' : 'review' }
    }
  } catch {}
  return { ...DEFAULTS }
}

export function saveReviewPanel(prefs: ReviewPanelPrefs, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {}
}

export function nextOnReviewButton(p: ReviewPanelPrefs): ReviewPanelPrefs {
  if (!p.open) return { ...p, open: true, tab: 'review' }
  if (p.tab === 'explore') return { ...p, tab: 'review' }
  return { ...p, open: false }
}

export function openExploreTab(p: ReviewPanelPrefs): ReviewPanelPrefs {
  return { ...p, open: true, tab: 'explore' }
}
```

`src/ui/requestGate.ts`:

```ts
export function createRequestGate() {
  let latest = 0
  return {
    next: () => ++latest,
    isLatest: (id: number) => id === latest,
  }
}
```

- [ ] **Step 4: 테스트와 타입 검사**

Run: `pnpm exec vitest run src/ui && pnpm exec tsc --noEmit -p .`
Expected: 테스트 PASS. `tsc`는 `App.tsx`의 `definitionAction` 분기(`references` 미처리)에서 오류가 날 수 있다. 오류가 나면 `App.tsx`의 `handleDefinition`에 `else if (action.type === 'references') { setPopover({ anchor, content: { type: 'message', text: '이미 정의 위치입니다' } }) }`를 임시로 넣어 지금 동작을 유지한다. Task 4가 이 분기를 바꾼다.

- [ ] **Step 5: 커밋**

```bash
git add src/ui/definition.ts src/ui/definition.test.ts src/ui/reviewPanelStorage.ts src/ui/reviewPanelStorage.test.ts src/ui/requestGate.ts src/ui/requestGate.test.ts src/ui/App.tsx
git commit -m "feat: 사용처 요청, 코드 탐색 목록 데이터, 패널 탭 상태 추가"
```

---

### Task 4: 오른쪽 패널 탭과 코드 탐색 목록

**Files:**
- Create: `src/ui/components/SidePanel.tsx`, `src/ui/components/ExplorePanel.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/components/DefinitionPopover.tsx`, `src/ui/components/Toolbar.tsx`, `src/ui/components/FileDiffCard.tsx`, `src/ui/components/FileViewerOverlay.tsx`, `src/ui/styles/global.css`

**Interfaces:**
- Consumes: Task 3의 `ExploreState`, `ExploreItem`, `groupByFile`, `exploreTitle`, `fetchReferences`, `DefinitionAction`의 `references`, `nextOnReviewButton`, `openExploreTab`, `createRequestGate`
- Produces:
  - `SidePanel({ tab, onTabChange, review, explore }: { tab: 'review' | 'explore'; onTabChange: (tab: 'review' | 'explore') => void; review: ReactNode; explore: ReactNode })`
  - `ExplorePanel({ state, selected, onPick }: { state: ExploreState; selected: string | null; onPick: (item: ExploreItem, version: DefinitionVersion) => void })` (`selected`는 `` `${path}:${line}` ``)
  - `App.tsx`: `openReferences(req: ReferencesRequest, name: string): Promise<void>` (Task 5가 파일 경로 Cmd+클릭에 쓴다)

- [ ] **Step 1: 토큰 이름을 요청에 싣기**

`src/ui/components/FileDiffCard.tsx`의 `onTokenClick`에서 `onDefinition!({ path: filePath, side: props.side, line: props.lineNumber, col: props.lineCharStart, name: props.tokenElement.textContent ?? '' }, ...)`로 바꾼다. `src/ui/components/FileViewerOverlay.tsx`의 `onTokenClick`도 같게 `name: props.tokenElement.textContent ?? ''`를 넣는다.

- [ ] **Step 2: `ExplorePanel` 작성**

`src/ui/components/ExplorePanel.tsx`:

```tsx
import { groupByFile, type DefinitionVersion, type ExploreItem, type ExploreState } from '../definition'

interface ExplorePanelProps {
  state: ExploreState
  selected: string | null
  onPick: (item: ExploreItem, version: DefinitionVersion) => void
}

export function ExplorePanel({ state, selected, onPick }: ExplorePanelProps) {
  if (state.status === 'idle') {
    return <div className="explore-panel"><p className="explore-panel-hint">정의 자리나 파일 경로를 Cmd+클릭하면 사용처가 여기에 나옵니다</p></div>
  }
  return (
    <div className="explore-panel">
      <div className="explore-panel-header">
        <span className="explore-panel-title">{state.title}</span>
        {state.status === 'ready' && <span className="explore-panel-count">{state.items.length}곳</span>}
      </div>
      {state.status === 'loading' && <p className="explore-panel-hint">사용처를 찾는 중입니다</p>}
      {state.status === 'error' && <p className="explore-panel-hint">사용처를 찾는 중 오류가 났습니다</p>}
      {state.status === 'ready' && state.items.length === 0 && <p className="explore-panel-hint">사용처를 찾지 못했습니다</p>}
      {state.status === 'ready' && groupByFile(state.items).map((group) => (
        <div key={group.path} className="explore-group">
          <div className="explore-group-path">{group.path}</div>
          {group.items.map((item) => {
            const id = `${item.path}:${item.line}`
            return (
              <button key={id} className={`explore-item ${selected === id ? 'explore-item-selected' : ''}`} onClick={() => onPick(item, state.version)}>
                <span className="explore-item-line">{item.line}</span>
                <span className="explore-item-text">{item.text?.trim() ?? ''}</span>
              </button>
            )
          })}
        </div>
      ))}
      {state.status === 'ready' && state.truncated && <p className="explore-panel-hint">200곳까지만 표시합니다</p>}
    </div>
  )
}
```

`idle` 안내 문구는 spec에 없던 빈 상태 문구다. 탭을 처음 열었을 때 아무것도 그리지 않으면 무엇을 하는 탭인지 알 수 없어서 넣는다.

- [ ] **Step 3: `SidePanel` 작성**

`src/ui/components/SidePanel.tsx`:

```tsx
import type { ReactNode } from 'react'

interface SidePanelProps {
  tab: 'review' | 'explore'
  onTabChange: (tab: 'review' | 'explore') => void
  review: ReactNode
  explore: ReactNode
}

export function SidePanel({ tab, onTabChange, review, explore }: SidePanelProps) {
  return (
    <div className="side-panel">
      <div className="toolbar-toggle side-panel-tabs">
        <button className={`btn btn-sm ${tab === 'review' ? 'btn-active' : ''}`} onClick={() => onTabChange('review')}>AI 리뷰</button>
        <button className={`btn btn-sm ${tab === 'explore' ? 'btn-active' : ''}`} onClick={() => onTabChange('explore')}>코드 탐색</button>
      </div>
      <div style={{ display: tab === 'review' ? 'block' : 'none' }}>{review}</div>
      <div style={{ display: tab === 'explore' ? 'block' : 'none' }}>{explore}</div>
    </div>
  )
}
```

두 탭을 모두 그리고 `display: none`으로 전환하는 이유는 AI 리뷰 진행 상태(`ReviewPanel` 안의 경과 시간 등)가 탭 전환으로 초기화되지 않게 하기 위해서다.

- [ ] **Step 4: `App.tsx` 연결**

1. import 추가: `SidePanel`, `ExplorePanel`, `fetchReferences`, `exploreTitle`, `type ExploreState`, `type ExploreItem`, `type ReferencesRequest`, `nextOnReviewButton`, `openExploreTab`, `createRequestGate`.
2. 상태 추가 (`popover` 상태 근처):

```tsx
  const [explore, setExplore] = useState<ExploreState>({ status: 'idle' })
  const [exploreSelected, setExploreSelected] = useState<string | null>(null)
  const exploreGate = useRef(createRequestGate())
```

3. `openReferences`와 목록 항목 클릭 처리를 `handleDefinition` 위에 추가:

```tsx
  const showExplore = useCallback((next: ExploreState) => {
    setExplore(next)
    setExploreSelected(null)
    updateReviewPanel(openExploreTab(reviewPanel))
  }, [reviewPanel, updateReviewPanel])

  const openReferences = useCallback(async (req: ReferencesRequest, name: string) => {
    const id = exploreGate.current.next()
    const title = 'scope' in req ? exploreTitle.importers(name) : exploreTitle.references(name)
    showExplore({ status: 'loading', title })
    try {
      const res = await fetchReferences(contentQuery, req)
      if (!exploreGate.current.isLatest(id)) return
      if (res.kind === 'not_declaration') {
        setExplore({ status: 'ready', title, items: [], truncated: false, version: req.side === 'additions' ? 'new' : 'old' })
        return
      }
      setExplore({ status: 'ready', title, items: res.references, truncated: res.truncated, version: res.version })
    } catch {
      if (exploreGate.current.isLatest(id)) setExplore({ status: 'error', title })
    }
  }, [contentQuery, showExplore])

  const handleExplorePick = useCallback((item: ExploreItem, version: DefinitionVersion) => {
    setExploreSelected(`${item.path}:${item.line}`)
    jumpTo({ path: item.path, line: item.line }, version, false)
  }, [jumpTo])
```

4. `handleDefinition`의 분기를 바꾼다:

```tsx
    if (action.type === 'jump') {
      jumpTo(action.target, action.version, fromOverlay)
    } else if (action.type === 'choose') {
      exploreGate.current.next()
      showExplore({ status: 'ready', title: exploreTitle.candidates(req.name ?? ''), items: action.targets, truncated: false, version: action.version })
    } else if (action.type === 'references') {
      void openReferences({ path: req.path, side: req.side, line: req.line, col: req.col }, req.name ?? '')
    } else {
      setPopover({ anchor, content: { type: 'message', text: action.text } })
    }
```

`useCallback` 의존성에 `showExplore`, `openReferences`를 추가한다. Task 3에서 임시로 넣은 `references` 분기는 지운다.

5. 목록에서 항목을 눌러 오버레이가 열린 상태라도 `jumpTo`의 `fromOverlay`는 `false`로 둔다. 목록 항목은 diff 카드 이동을 먼저 시도한다.
6. Toolbar에 넘기는 값을 바꾼다: `reviewOpen={reviewPanel.open && reviewPanel.tab === 'review'}`, `onToggleReview={() => updateReviewPanel(nextOnReviewButton(reviewPanel))}`.
7. 오른쪽 패널 `aside` 안의 `<div className="review-aside-scroll">…</div>`를 다음으로 바꾼다:

```tsx
              <div className="review-aside-scroll">
                <SidePanel
                  tab={reviewPanel.tab}
                  onTabChange={(tab) => updateReviewPanel({ ...reviewPanel, tab })}
                  review={(
                    <ReviewPanel
                      provider={claude}
                      record={review.record}
                      stale={review.stale}
                      state={review.state}
                      instruction={reviewInstruction}
                      onInstructionChange={handleInstructionChange}
                      onStart={() => review.start('claude', excludedInDiff, reviewInstruction)}
                      onCancel={review.cancel}
                      onFindingClick={handleFindingClick}
                    />
                  )}
                  explore={<ExplorePanel state={explore} selected={exploreSelected} onPick={handleExplorePick} />}
                />
              </div>
```

8. 비교 조합이 바뀌면 목록을 비운다. 기존 `useEffect(() => setOverlayEntries([]), [contentQuery])` 옆에 `useEffect(() => { exploreGate.current.next(); setExplore({ status: 'idle' }); setExploreSelected(null) }, [contentQuery])`를 추가한다.

- [ ] **Step 5: 팝오버에서 후보 목록 제거**

`src/ui/components/DefinitionPopover.tsx`:
- `PopoverContent`를 `{ type: 'message'; text: string }` 하나로 줄인다.
- `useEffect`는 2초 뒤 `onClose`를 부르는 부분만 남긴다(바깥 클릭과 Escape 처리 삭제).
- 본문은 `<div className="definition-popover-message">{content.text}</div>`만 그린다.
- `DefinitionTarget` import를 지운다.

`src/ui/styles/global.css`에서 `.definition-popover-item`, `.definition-popover-item:hover` 규칙을 지운다.

- [ ] **Step 6: 스타일 추가**

`src/ui/styles/global.css`의 `.review-panel` 규칙 앞에 추가:

```css
.side-panel-tabs {
    margin: 12px 12px 0;
}

.explore-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    font-size: 13px;
}

.explore-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.explore-panel-title {
    font-weight: 600;
    word-break: break-all;
}

.explore-panel-count,
.explore-panel-hint {
    color: var(--text-secondary);
    font-size: 12px;
}

.explore-group-path {
    padding: 4px 0;
    font-size: 12px;
    font-weight: 600;
    word-break: break-all;
}

.explore-item {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 3px 6px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-family: var(--diffs-font-family, monospace);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
}

.explore-item:hover {
    background: var(--bg);
}

.explore-item-selected {
    background: var(--bg);
    outline: 1px solid var(--primary);
}

.explore-item-line {
    flex-shrink: 0;
    min-width: 32px;
    color: var(--text-secondary);
    text-align: right;
}

.explore-item-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
```

- [ ] **Step 7: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build:electron`
Expected: 모두 성공

- [ ] **Step 8: 커밋**

```bash
git add src/ui
git commit -m "feat: 오른쪽 패널을 AI 리뷰와 코드 탐색 탭으로 나누고 사용처와 정의 후보 목록 표시"
```

---

### Task 5: 파일 경로 Cmd+클릭으로 파일 사용처 열기

**Files:**
- Create: `src/ui/headerTitle.ts`
- Modify: `src/ui/components/FileDiffCard.tsx`, `src/ui/components/FileViewerOverlay.tsx`, `src/ui/App.tsx`
- Test: `src/ui/headerTitle.test.ts`

**Interfaces:**
- Consumes: `openReferences(req: ReferencesRequest, name: string)`(Task 4), `tokenLinkHover.enter(el, metaKey)`, `tokenLinkHover.leave()`(`src/ui/tokenLinkHover.ts`)
- Produces:
  - `export function findHeaderTitle(path: EventTarget[]): HTMLElement | null` (`data-title` 속성이 있는 첫 요소)
  - `FileDiffCard` prop `onFileReferences?: (path: string, side: 'additions' | 'deletions') => void`
  - `FileViewerOverlay` prop `onFileReferences: (path: string, side: 'additions' | 'deletions') => void`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/ui/headerTitle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findHeaderTitle } from './headerTitle'

const el = (attrs: string[]) => ({ hasAttribute: (name: string) => attrs.includes(name) }) as unknown as HTMLElement

describe('findHeaderTitle', () => {
  it('finds the header title element in an event path', () => {
    const title = el(['data-title'])
    expect(findHeaderTitle([el([]), title, el(['data-diffs-header'])])).toBe(title)
  })

  it('returns null when the event did not come from the title', () => {
    expect(findHeaderTitle([el([]), {} as EventTarget])).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/ui/headerTitle.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/ui/headerTitle.ts`:

```ts
export function findHeaderTitle(path: EventTarget[]): HTMLElement | null {
  for (const target of path) {
    const el = target as Partial<HTMLElement>
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-title')) return target as HTMLElement
  }
  return null
}
```

`src/ui/components/FileDiffCard.tsx`:
- props에 `onFileReferences?: (path: string, side: 'additions' | 'deletions') => void`를 추가한다.
- import 추가: `import { findHeaderTitle } from '../headerTitle'`
- `linkable` 아래에 핸들러를 추가한다. 헤더는 `@pierre/diffs`가 open shadow DOM 안에 그리므로 `composedPath()`로 `data-title` 요소를 찾는다:

```tsx
  const headerHandlers = linkable && onFileReferences ? {
    onClickCapture: (e: React.MouseEvent) => {
      if (!e.metaKey || !findHeaderTitle(e.nativeEvent.composedPath())) return
      e.preventDefault()
      e.stopPropagation()
      onFileReferences(filePath, fileDiff.type === 'deleted' ? 'deletions' : 'additions')
    },
    onPointerOver: (e: React.PointerEvent) => {
      const title = findHeaderTitle(e.nativeEvent.composedPath())
      if (title) tokenLinkHover.enter(title, e.metaKey)
    },
    onPointerOut: (e: React.PointerEvent) => {
      if (findHeaderTitle(e.nativeEvent.composedPath())) tokenLinkHover.leave()
    },
  } : {}
```

- 카드 최상위 `<div className={`file-diff-card …`} id={id} ref={cardRef}>`에 `{...headerHandlers}`를 붙인다.
- `fileDiff.type`은 `@pierre/diffs`의 `ChangeTypes`(`'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted'`)다. 삭제된 파일은 새 버전에 없으므로 `deletions`로 찾는다.

`src/ui/components/FileViewerOverlay.tsx`:
- props에 `onFileReferences: (path: string, side: 'additions' | 'deletions') => void`를 추가한다.
- 헤더 경로를 다음으로 바꾼다:

```tsx
          <span
            className="file-overlay-path"
            onClick={(e) => { if (linkable && e.metaKey) onFileReferences(current.path, side) }}
            onPointerOver={(e) => { if (linkable) tokenLinkHover.enter(e.currentTarget, e.metaKey) }}
            onPointerOut={() => tokenLinkHover.leave()}
          >
            {current.path}
          </span>
```

`src/ui/App.tsx`:
- 핸들러 추가 (`openReferences` 아래):

```tsx
  const handleFileReferences = useCallback((path: string, side: 'additions' | 'deletions') => {
    void openReferences({ path, side, scope: 'file' }, path.split('/').pop()!.replace(/\.[^.]+$/, ''))
  }, [openReferences])
```

- `FileDiffCard`를 그리는 곳에 `onFileReferences={handleFileReferences}`, `FileViewerOverlay`에 `onFileReferences={handleFileReferences}`를 넘긴다. `FileDiffCard`가 다른 컴포넌트(가상 목록 등)를 거쳐 그려지면 그 컴포넌트의 props에도 같은 이름으로 전달한다.

- [ ] **Step 4: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build:electron`
Expected: 모두 성공

- [ ] **Step 5: 커밋**

```bash
git add src/ui
git commit -m "feat: 파일 경로 Cmd+클릭으로 그 파일을 import하는 곳 보기"
```

---

### Task 6: README와 앱 확인

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 수정**

`### 코드 하이퍼링크` 섹션을 다음으로 바꾼다:

```markdown
### 코드 하이퍼링크

diff 코드에서 Cmd를 누른 채 import 경로나 이름을 클릭하면 정의 위치로 이동한다. `.ts .tsx .js .jsx .mjs .cjs .vue` 파일이 대상이다.

- 정의 파일이 diff에 있으면 그 파일 카드의 해당 줄로 스크롤한다. 없으면 가운데 창에서 파일 내용을 연다. 창 안에서도 Cmd+클릭으로 계속 이동하고 `뒤로`로 돌아간다.
- 같은 이름의 선언이 여러 곳이면 오른쪽 패널의 `코드 탐색` 탭에 후보 목록이 나온다.
- 정의 자리(선언한 이름)를 Cmd+클릭하면 `코드 탐색` 탭에 사용처 목록이 나온다. 다른 파일은 이 정의 파일을 import한 경우만 사용처로 본다.
- diff 카드나 가운데 창 헤더의 파일 경로를 Cmd+클릭하면 그 파일을 import하는 곳이 나온다.
- 목록 항목을 클릭하면 그 줄로 이동하고 목록은 그대로 남는다. 최대 200곳까지 보여준다.
- 브랜치 비교와 MR에서는 소스 커밋(삭제 줄은 기준 커밋)의 코드에서 찾는다.
- `obj.method`의 `method`처럼 `.` 뒤의 이름은 이동하지 않는다. 같은 파일 안에서 이름이 같은 지역 변수, 주석과 문자열 안의 같은 단어도 사용처로 나온다.
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: 코드 사용처 보기 사용법 추가"
```

- [ ] **Step 3: 앱 확인 (사용자가 실행)**

사용자에게 `pnpm run dev:app` 실행을 요청하고 다음을 함께 확인한다.

1. 함수 선언의 이름을 Cmd+클릭 시 오른쪽 패널이 `코드 탐색` 탭으로 열리고 "`<이름>` 사용처"와 목록이 나온다.
2. 목록 항목 클릭 시 diff 카드의 그 줄로 이동하거나 가운데 창이 열리고, 목록은 남아 있다.
3. 정의 후보가 여러 개인 이름을 Cmd+클릭 시 팝오버 없이 `코드 탐색` 탭에 후보 목록이 나온다.
4. diff 카드 헤더의 파일 경로 위에서 Cmd를 누르면 밑줄과 포인터가 보이고, 클릭 시 "`<파일 이름>`을 import하는 곳"이 나온다.
5. 툴바 `AI 리뷰` 버튼이 닫힘 → `AI 리뷰` 탭 열림, `코드 탐색` 탭 → `AI 리뷰` 탭, `AI 리뷰` 탭 → 닫힘 순서로 동작한다. 탭을 오가도 AI 리뷰 결과와 사용처 목록이 유지된다.
