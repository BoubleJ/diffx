# diff 코드 하이퍼링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diff 코드의 import 경로와 이름을 Cmd+클릭하면 정의 위치의 diff 카드나 파일 내용 오버레이 창으로 이동한다.

**Architecture:** 서버의 `src/definition/`이 클릭한 위치를 다시 읽어 import를 따라가고, 선언 정규식과 `git grep`으로 정의 줄을 찾는다. 파일 읽기와 검색은 버전별(작업 트리, 커밋) `SourceReader`로 추상화해서 브랜치 비교와 MR 모드에서는 소스 커밋이나 기준 커밋 기준으로 찾는다. UI는 `@pierre/diffs`의 `onTokenClick`으로 Cmd+클릭을 받아 `/api/definition` 결과에 따라 카드 이동, 후보 목록, 안내 문구, 오버레이 창을 처리한다.

**Tech Stack:** TypeScript, Hono, React 19, @pierre/diffs 1.2.9 (`FileDiff`, `File`, `onTokenClick`), git CLI, vitest

**Spec:** `docs/superpowers/specs/2026-09-30-code-hyperlink-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 대상 확장자: `.ts .tsx .js .jsx .mjs .cjs .vue`
- 작업 브랜치는 현재 `feature/gitlab-mr` HEAD에서 만든 `feature/code-hyperlink`다. `develop` 브랜치에는 커밋, 머지, 푸시하지 않는다.
- 커밋 메시지는 한글로 쓰고 type prefix만 영문으로 쓴다. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 코드만으로 이유가 드러나지 않는 곳에만 단다. 이 계획에 적힌 주석 외에 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다.
- UI 문구는 spec 문구를 그대로 쓴다: "정의를 찾지 못했습니다", "외부 패키지는 이동하지 않습니다", "이미 정의 위치입니다", "정의를 찾는 중 오류가 났습니다", "파일을 읽지 못했습니다", 버전 표시 `소스`/`기준`
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 빌드: `pnpm run build`. 작업 시작 시점에 모두 통과한다(테스트 227개).

## Review Focus

1. `@pierre/diffs`가 넘기는 코드 조각의 시작 위치(`lineCharStart`)가 앞 공백을 포함해도 이름을 찾아야 한다. Task 1 `classifyToken` 테스트 `skips leading whitespace of the token`이 확인한다.
2. 모노레포에서 `apps/web/tsconfig.json` 아래 파일의 `@/` 별칭은 저장소 루트가 아니라 `apps/web/src`로 풀려야 한다. Task 3 `resolveModule` 테스트 `resolves @/ against the nearest config folder in a monorepo`가 확인한다.
3. `.vue` 파일의 `<script setup>` 선언과 import, 템플릿 안의 이름도 같은 규칙으로 찾아야 한다. Task 4 `resolveDefinition` 테스트 `handles names inside a vue file`이 확인한다.
4. 브랜치 비교에서 삭제 줄을 클릭하면 소스 커밋이 아니라 merge-base 코드 기준으로 찾아야 한다. Task 5 서버 테스트 `resolves deleted lines against the merge-base`가 확인한다.
5. Vue와 Nuxt의 `$fetch`, `$store`처럼 `$`가 들어간 이름도 저장소 검색에서 찾아야 한다. Task 4 `resolveDefinition` 테스트 `searches names containing $`가 확인한다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/definition/sourceFiles.ts` (신규) | 대상 확장자와 `isSourceFile`. node 모듈을 쓰지 않아 UI도 가져다 쓴다 |
| `src/definition/token.ts` (신규) | 줄 텍스트와 글자 위치로 클릭 대상 판별 |
| `src/definition/imports.ts` (신규) | import 문 해석 |
| `src/definition/declarations.ts` (신규) | 선언 줄 찾기, export 찾기 |
| `src/definition/reader.ts` (신규) | 버전별 파일 읽기와 `git grep` |
| `src/definition/modules.ts` (신규) | import 경로를 파일로 풀기, tsconfig 읽기 |
| `src/definition/resolve.ts` (신규) | 찾는 순서 전체 |
| `src/server.ts` | `GET /api/definition` |
| `src/ui/definition.ts` (신규) | 서버 응답을 UI 동작으로 바꾸는 순수 함수, `/api/definition` 호출 |
| `src/ui/components/DefinitionPopover.tsx` (신규) | 후보 목록과 안내 문구 |
| `src/ui/components/FileViewerOverlay.tsx` (신규) | 파일 내용 오버레이 창 |
| `src/ui/components/FileDiffCard.tsx`, `DiffViewer.tsx`, `App.tsx`, `styles/global.css` | 연결 |

---

### Task 0: 작업 브랜치 만들기

- [ ] **Step 1: 브랜치 생성과 기준 확인**

```bash
git switch feature/gitlab-mr
git switch -c feature/code-hyperlink
pnpm test && pnpm exec tsc --noEmit -p .
```

Expected: `Tests  227 passed`, tsc 출력 없음

---

### Task 1: 대상 확장자와 클릭 대상 판별

**Files:**
- Create: `src/definition/sourceFiles.ts`, `src/definition/token.ts`
- Test: `src/definition/token.test.ts`

**Interfaces:**
- Produces:
  - `SOURCE_EXTENSIONS: string[]`, `isSourceFile(path: string): boolean`
  - `type TokenTarget = { kind: 'module'; specifier: string } | { kind: 'identifier'; name: string } | null`
  - `classifyToken(lineText: string, col: number): TokenTarget`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/definition/token.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyToken } from './token'
import { isSourceFile } from './sourceFiles'

const at = (line: string, text: string, offset = 0) => classifyToken(line, line.indexOf(text) + offset)

describe('isSourceFile', () => {
  it('accepts script and vue files only', () => {
    expect(['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.vue'].every(isSourceFile)).toBe(true)
    expect(isSourceFile('README.md')).toBe(false)
    expect(isSourceFile('style.css')).toBe(false)
  })
})

describe('classifyToken module specifiers', () => {
  it('reads import, export, dynamic import and require paths', () => {
    expect(at("import { a } from './utils'", "'./utils'")).toEqual({ kind: 'module', specifier: './utils' })
    expect(at("export * from './re'", "'./re'", 2)).toEqual({ kind: 'module', specifier: './re' })
    expect(at("const p = await import('./page')", "'./page'")).toEqual({ kind: 'module', specifier: './page' })
    expect(at('const y = require("../x")', '"../x"')).toEqual({ kind: 'module', specifier: '../x' })
    expect(at("import './side.css'", "'./side.css'")).toEqual({ kind: 'module', specifier: './side.css' })
  })

  it('ignores other strings', () => {
    expect(at("console.log('hello')", "'hello'")).toBeNull()
  })
})

describe('classifyToken identifiers', () => {
  it('returns the identifier under the cursor', () => {
    expect(at('const total = sum(a, b)', 'sum', 1)).toEqual({ kind: 'identifier', name: 'sum' })
    expect(at('user.name', 'user')).toEqual({ kind: 'identifier', name: 'user' })
    expect(at('f(...args)', 'args')).toEqual({ kind: 'identifier', name: 'args' })
    expect(at('const s = $fetch(url)', '$fetch')).toEqual({ kind: 'identifier', name: '$fetch' })
  })

  it('skips leading whitespace of the token', () => {
    expect(classifyToken('return  formatDate(d)', 6)).toEqual({ kind: 'identifier', name: 'formatDate' })
  })

  it('does not link member names, keywords or comments', () => {
    expect(at('user.name', 'name')).toBeNull()
    expect(at('obj?.prop', 'prop')).toBeNull()
    expect(at('return value', 'return')).toBeNull()
    expect(at('foo() // call bar', 'bar')).toBeNull()
    expect(at('x = 1 /* bar */ + y', 'bar')).toBeNull()
    expect(at('const n = 123', '123')).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/definition/token.test.ts`
Expected: FAIL, `Cannot find module './token'`

- [ ] **Step 3: 구현**

`src/definition/sourceFiles.ts`:

```ts
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))
}
```

`src/definition/token.ts`:

```ts
export type TokenTarget = { kind: 'module'; specifier: string } | { kind: 'identifier'; name: string } | null

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await', 'async', 'as',
  'from', 'of', 'type', 'declare', 'abstract', 'readonly', 'keyof', 'infer', 'is', 'namespace', 'module',
  'satisfies', 'undefined', 'get', 'set', 'constructor', 'any', 'unknown', 'never', 'string', 'number', 'boolean',
  'symbol', 'object', 'bigint',
])

interface StringSpan {
  start: number
  end: number
  value: string
}

function scanLine(line: string): { strings: StringSpan[]; comments: [number, number][] } {
  const strings: StringSpan[] = []
  const comments: [number, number][] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '/' && line[i + 1] === '/') {
      comments.push([i, line.length])
      break
    }
    if (ch === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2)
      const end = close === -1 ? line.length : close + 2
      comments.push([i, end])
      i = end
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      const end = Math.min(j + 1, line.length)
      strings.push({ start: i, end, value: line.slice(i + 1, j) })
      i = end
      continue
    }
    i++
  }
  return { strings, comments }
}

const IDENT_CHAR = /[A-Za-z0-9_$]/

function isModuleString(line: string, span: StringSpan): boolean {
  if (span.value.includes('${')) return false
  const before = line.slice(0, span.start)
  return /\bfrom\s*$/.test(before) || /\bimport\s*\(\s*$/.test(before) || /\brequire\s*\(\s*$/.test(before) || /^\s*import\s*$/.test(before)
}

export function classifyToken(line: string, col: number): TokenTarget {
  const { strings, comments } = scanLine(line)
  if (comments.some(([s, e]) => col >= s && col < e)) return null
  const span = strings.find((s) => col >= s.start && col < s.end)
  if (span) return isModuleString(line, span) ? { kind: 'module', specifier: span.value } : null

  let pos = col
  while (pos < line.length && /\s/.test(line[pos])) pos++
  if (pos >= line.length || !IDENT_CHAR.test(line[pos])) return null
  let start = pos
  while (start > 0 && IDENT_CHAR.test(line[start - 1])) start--
  let end = pos
  while (end < line.length && IDENT_CHAR.test(line[end])) end++
  const name = line.slice(start, end)
  if (/^\d/.test(name) || KEYWORDS.has(name)) return null

  let prev = start - 1
  while (prev >= 0 && /\s/.test(line[prev])) prev--
  if (prev >= 0 && line[prev] === '.' && line.slice(Math.max(0, prev - 2), prev + 1) !== '...') return null
  return { kind: 'identifier', name }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/definition/token.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/definition/sourceFiles.ts src/definition/token.ts src/definition/token.test.ts
git commit -m "feat: 코드 하이퍼링크 클릭 대상 판별 추가"
```

---

### Task 2: import 해석과 선언 찾기

**Files:**
- Create: `src/definition/imports.ts`, `src/definition/declarations.ts`
- Test: `src/definition/imports.test.ts`, `src/definition/declarations.test.ts`

**Interfaces:**
- Produces:
  - `interface ImportBinding { specifier: string; imported: string }` (`imported`: `'default'`, `'*'`, 이름)
  - `parseImports(text: string): Map<string, ImportBinding>`
  - `declarationRegex(name: string): RegExp`
  - `findDeclarationLines(text: string, name: string): number[]` (1부터 시작하는 줄 번호)
  - `type ExportMatch = { kind: 'line'; line: number } | { kind: 'reexport'; specifier: string; name: string }`
  - `findExport(text: string, name: string): ExportMatch[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/definition/imports.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseImports } from './imports'

describe('parseImports', () => {
  it('reads default, named, aliased and namespace imports', () => {
    const map = parseImports([
      "import main, { formatDate as fmt, sum } from './utils/date'",
      "import * as utils from './utils'",
      "import type { User } from './types'",
      "import { type Role, getRole } from './roles'",
      "import './side.css'",
    ].join('\n'))
    expect(map.get('main')).toEqual({ specifier: './utils/date', imported: 'default' })
    expect(map.get('fmt')).toEqual({ specifier: './utils/date', imported: 'formatDate' })
    expect(map.get('sum')).toEqual({ specifier: './utils/date', imported: 'sum' })
    expect(map.get('utils')).toEqual({ specifier: './utils', imported: '*' })
    expect(map.get('User')).toEqual({ specifier: './types', imported: 'User' })
    expect(map.get('Role')).toEqual({ specifier: './roles', imported: 'Role' })
    expect(map.get('getRole')).toEqual({ specifier: './roles', imported: 'getRole' })
    expect(map.size).toBe(7)
  })

  it('reads imports spread over several lines', () => {
    const map = parseImports("import {\n  a,\n  b as c,\n} from '@/lib'\n")
    expect(map.get('a')).toEqual({ specifier: '@/lib', imported: 'a' })
    expect(map.get('c')).toEqual({ specifier: '@/lib', imported: 'b' })
  })
})
```

`src/definition/declarations.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/definition/imports.test.ts src/definition/declarations.test.ts`
Expected: FAIL, 모듈을 찾지 못함

- [ ] **Step 3: 구현**

`src/definition/imports.ts`:

```ts
export interface ImportBinding {
  specifier: string
  imported: string
}

const IMPORT_RE = /\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*['"]([^'"]+)['"]/g

function addClause(clause: string, specifier: string, map: Map<string, ImportBinding>): void {
  let rest = clause.trim()
  const braces = rest.match(/\{([\s\S]*)\}/)
  if (braces) {
    for (const part of braces[1].split(',')) {
      const item = part.trim().replace(/^type\s+/, '')
      const m = item.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
      if (m) map.set(m[2] ?? m[1], { specifier, imported: m[1] })
    }
    rest = rest.replace(braces[0], '')
  }
  const ns = rest.match(/\*\s*as\s+([\w$]+)/)
  if (ns) {
    map.set(ns[1], { specifier, imported: '*' })
    rest = rest.replace(ns[0], '')
  }
  const def = rest.replace(/,/g, ' ').trim()
  if (/^[\w$]+$/.test(def)) map.set(def, { specifier, imported: 'default' })
}

export function parseImports(text: string): Map<string, ImportBinding> {
  const map = new Map<string, ImportBinding>()
  for (const m of text.matchAll(IMPORT_RE)) addClause(m[1], m[2], map)
  return map
}
```

`src/definition/declarations.ts`:

```ts
const PREFIX = String.raw`^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?`

function escapeRegExp(name: string): string {
  return name.replace(/[$]/g, '\\$')
}

export function declarationRegex(name: string): RegExp {
  const n = escapeRegExp(name)
  const end = '(?![A-Za-z0-9_$])'
  return new RegExp(
    PREFIX + `(?:function\\s*\\*?\\s*${n}${end}|(?:const|let|var)\\s+${n}${end}|(?:const\\s+)?enum\\s+${n}${end}|(?:class|interface|type|namespace)\\s+${n}${end})`,
  )
}

export function findDeclarationLines(text: string, name: string): number[] {
  const re = declarationRegex(name)
  const lines: number[] = []
  text.split('\n').forEach((line, i) => {
    if (re.test(line)) lines.push(i + 1)
  })
  return lines
}

export type ExportMatch = { kind: 'line'; line: number } | { kind: 'reexport'; specifier: string; name: string }

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

export function findExport(text: string, name: string): ExportMatch[] {
  const lines = text.split('\n')
  const results: ExportMatch[] = []
  if (name === 'default') {
    const i = lines.findIndex((l) => /^\s*export\s+default\b/.test(l))
    if (i !== -1) results.push({ kind: 'line', line: i + 1 })
  } else {
    const decl = declarationRegex(name)
    const i = lines.findIndex((l) => /^\s*export\s/.test(l) && decl.test(l))
    if (i !== -1) results.push({ kind: 'line', line: i + 1 })
  }
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[1].split(',')) {
      const item = part.trim().replace(/^type\s+/, '')
      const pm = item.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
      if (!pm || (pm[2] ?? pm[1]) !== name) continue
      if (m[2]) {
        results.push({ kind: 'reexport', specifier: m[2], name: pm[1] })
      } else {
        const local = findDeclarationLines(text, pm[1])
        results.push({ kind: 'line', line: local[0] ?? lineOf(text, m.index!) })
      }
    }
  }
  if (name !== 'default') {
    for (const m of text.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
      results.push({ kind: 'reexport', specifier: m[1], name })
    }
  }
  return results
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/definition/imports.test.ts src/definition/declarations.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/definition/imports.ts src/definition/imports.test.ts src/definition/declarations.ts src/definition/declarations.test.ts
git commit -m "feat: import 해석과 선언 줄 찾기 추가"
```

---

### Task 3: 버전별 파일 읽기와 import 경로 풀기

**Files:**
- Create: `src/definition/reader.ts`, `src/definition/modules.ts`
- Test: `src/definition/reader.test.ts`, `src/definition/modules.test.ts`

**Interfaces:**
- Consumes: `SOURCE_EXTENSIONS` (Task 1), `getWorktreeFileContent`, `getFileAtCommit` (`src/git.ts`), `isSafePath` (`src/path.ts`)
- Produces:
  - `interface GrepHit { path: string; line: number; text: string }`
  - `interface SourceReader { readFile(path: string): string | null; exists(path: string): boolean; grep(pattern: string): GrepHit[] }`
  - `worktreeReader(repo: string): SourceReader`, `commitReader(repo: string, sha: string): SourceReader`
  - `parseJsonc(text: string): unknown`
  - `type ModuleResolution = { kind: 'file'; path: string } | { kind: 'external' } | { kind: 'missing' }`
  - `resolveModule(reader: SourceReader, fromFile: string, specifier: string): ModuleResolution`

- [ ] **Step 1: reader 테스트 작성**

`src/definition/reader.test.ts`:

```ts
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
```

- [ ] **Step 2: modules 테스트 작성**

`src/definition/modules.test.ts`:

```ts
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
  it('allows comments and trailing commas but keeps strings intact', () => {
    expect(parseJsonc('{ /* a */ "url": "http://x//y", "list": [1, 2,], }')).toEqual({ url: 'http://x//y', list: [1, 2] })
  })
})

describe('resolveModule', () => {
  it('resolves relative paths with extensions, index files, vue files and .js written for .ts', () => {
    const reader = setup()
    expect(resolveModule(reader, 'src/page.ts', './utils/date')).toEqual({ kind: 'file', path: 'src/utils/date.ts' })
    expect(resolveModule(reader, 'src/page.ts', './utils')).toEqual({ kind: 'file', path: 'src/utils/index.ts' })
    expect(resolveModule(reader, 'src/page.ts', './components/Comp.vue')).toEqual({ kind: 'file', path: 'src/components/Comp.vue' })
    expect(resolveModule(reader, 'src/page.ts', './esm.js')).toEqual({ kind: 'file', path: 'src/esm.ts' })
    expect(resolveModule(reader, 'src/page.ts', './nope')).toEqual({ kind: 'missing' })
  })

  it('uses tsconfig paths and baseUrl from extends', () => {
    const reader = setup()
    expect(resolveModule(reader, 'src/page.ts', '#lib/helper')).toEqual({ kind: 'file', path: 'lib/helper.ts' })
    expect(resolveModule(reader, 'src/page.ts', 'src/utils/date')).toEqual({ kind: 'file', path: 'src/utils/date.ts' })
  })

  it('falls back to src/ for @/ and ~/', () => {
    const reader = setup()
    expect(resolveModule(reader, 'src/page.ts', '@/utils/date')).toEqual({ kind: 'file', path: 'src/utils/date.ts' })
    expect(resolveModule(reader, 'src/page.ts', '~/components/Comp.vue')).toEqual({ kind: 'file', path: 'src/components/Comp.vue' })
  })

  it('resolves @/ against the nearest config folder in a monorepo', () => {
    const reader = setup()
    expect(resolveModule(reader, 'apps/web/pages/index.ts', '@/store')).toEqual({ kind: 'file', path: 'apps/web/src/store.ts' })
  })

  it('treats bare package names as external', () => {
    const reader = setup()
    expect(resolveModule(reader, 'src/page.ts', 'react')).toEqual({ kind: 'external' })
    expect(resolveModule(reader, 'src/page.ts', '@tanstack/react-query')).toEqual({ kind: 'external' })
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec vitest run src/definition/reader.test.ts src/definition/modules.test.ts`
Expected: FAIL, 모듈을 찾지 못함

- [ ] **Step 4: reader 구현**

`src/definition/reader.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getFileAtCommit, getWorktreeFileContent } from '../git.js'
import { isSafePath } from '../path.js'
import { SOURCE_EXTENSIONS } from './sourceFiles.js'

export interface GrepHit {
  path: string
  line: number
  text: string
}

export interface SourceReader {
  readFile(path: string): string | null
  exists(path: string): boolean
  grep(pattern: string): GrepHit[]
}

const PATHSPECS = [
  ...SOURCE_EXTENSIONS.map((ext) => `*${ext}`),
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/dist/**',
  ':(exclude,glob)**/.nuxt/**',
  ':(exclude,glob)**/.next/**',
]

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: repo, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 })
}

function runGrep(repo: string, args: string[], prefix: string): GrepHit[] {
  let output: string
  try {
    output = git(repo, ['grep', '-n', '-I', '-E', ...args])
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []
    throw err
  }
  const hits: GrepHit[] = []
  for (const raw of output.split('\n')) {
    if (!raw.startsWith(prefix)) continue
    const m = raw.slice(prefix.length).match(/^(.*?):(\d+):(.*)$/)
    if (m) hits.push({ path: m[1], line: Number(m[2]), text: m[3] })
  }
  return hits
}

export function worktreeReader(repo: string): SourceReader {
  return {
    readFile: (path) => getWorktreeFileContent(repo, path),
    exists: (path) => {
      if (!isSafePath(path, repo)) return false
      try {
        return statSync(resolve(repo, path)).isFile()
      } catch {
        return false
      }
    },
    grep: (pattern) => runGrep(repo, ['--untracked', '-e', pattern, '--', ...PATHSPECS], ''),
  }
}

export function commitReader(repo: string, sha: string): SourceReader {
  return {
    readFile: (path) => getFileAtCommit(repo, sha, path)?.toString('utf-8') ?? null,
    exists: (path) => {
      if (!isSafePath(path, repo)) return false
      try {
        return git(repo, ['cat-file', '-t', `${sha}:${path}`]).trim() === 'blob'
      } catch {
        return false
      }
    },
    grep: (pattern) => runGrep(repo, ['-e', pattern, sha, '--', ...PATHSPECS], `${sha}:`),
  }
}
```

- [ ] **Step 5: modules 구현**

`src/definition/modules.ts`:

```ts
import { posix } from 'node:path'
import type { SourceReader } from './reader.js'

export type ModuleResolution = { kind: 'file'; path: string } | { kind: 'external' } | { kind: 'missing' }

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.d.ts']

export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += ch
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

function tryFile(reader: SourceReader, base: string): string | null {
  const norm = posix.normalize(base)
  if (norm.startsWith('..') || posix.isAbsolute(norm)) return null
  const candidates = [norm, ...EXTENSIONS.map((e) => norm + e), ...EXTENSIONS.map((e) => posix.join(norm, `index${e}`))]
  const jsLike = norm.match(/^(.*)\.(?:m?js|cjs|jsx)$/)
  if (jsLike) candidates.push(`${jsLike[1]}.ts`, `${jsLike[1]}.tsx`)
  return candidates.find((c) => reader.exists(c)) ?? null
}

function findConfig(reader: SourceReader, fromFile: string): string | null {
  let dir = posix.dirname(fromFile)
  for (;;) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const file = dir === '.' ? name : posix.join(dir, name)
      if (reader.exists(file)) return file
    }
    if (dir === '.') return null
    dir = posix.dirname(dir)
  }
}

interface PathConfig {
  baseUrl?: string
  paths?: Record<string, unknown>
  pathsDir?: string
}

function readConfig(reader: SourceReader, file: string, depth: number): PathConfig | null {
  const text = reader.readFile(file)
  if (text === null) return null
  let json: { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } }
  try {
    json = parseJsonc(text) as typeof json
  } catch {
    return null
  }
  const dir = posix.dirname(file)
  let inherited: PathConfig = {}
  if (typeof json.extends === 'string' && json.extends.startsWith('.') && depth < 5) {
    const target = posix.join(dir, json.extends)
    inherited = readConfig(reader, target.endsWith('.json') ? target : `${target}.json`, depth + 1) ?? {}
  }
  const options = json.compilerOptions ?? {}
  const hasPaths = options.paths !== null && typeof options.paths === 'object'
  return {
    baseUrl: typeof options.baseUrl === 'string' ? posix.join(dir, options.baseUrl) : inherited.baseUrl,
    paths: hasPaths ? (options.paths as Record<string, unknown>) : inherited.paths,
    pathsDir: hasPaths ? dir : inherited.pathsDir,
  }
}

function matchPaths(paths: Record<string, unknown>, specifier: string): string[] {
  const entries = Object.entries(paths)
    .filter((e): e is [string, string[]] => Array.isArray(e[1]))
    .sort((a, b) => b[0].indexOf('*') - a[0].indexOf('*'))
  for (const [pattern, targets] of entries) {
    const star = pattern.indexOf('*')
    if (star === -1) {
      if (pattern === specifier) return targets
      continue
    }
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
      const middle = specifier.slice(prefix.length, specifier.length - suffix.length)
      return targets.map((t) => t.replace('*', middle))
    }
  }
  return []
}

export function resolveModule(reader: SourceReader, fromFile: string, specifier: string): ModuleResolution {
  const found = (path: string | null): ModuleResolution => (path ? { kind: 'file', path } : { kind: 'missing' })
  if (specifier.startsWith('.')) return found(tryFile(reader, posix.join(posix.dirname(fromFile), specifier)))

  const configFile = findConfig(reader, fromFile)
  const config = configFile ? readConfig(reader, configFile, 0) : null
  if (config?.paths) {
    const base = config.baseUrl ?? config.pathsDir ?? '.'
    for (const target of matchPaths(config.paths, specifier)) {
      const path = tryFile(reader, posix.join(base, target))
      if (path) return { kind: 'file', path }
    }
  }
  if (config?.baseUrl) {
    const path = tryFile(reader, posix.join(config.baseUrl, specifier))
    if (path) return { kind: 'file', path }
  }
  if (/^[@~]\//.test(specifier)) {
    const root = configFile ? posix.dirname(configFile) : '.'
    const rest = specifier.slice(2)
    return found(tryFile(reader, posix.join(root, 'src', rest)) ?? tryFile(reader, posix.join(root, rest)))
  }
  return { kind: 'external' }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm exec vitest run src/definition/reader.test.ts src/definition/modules.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/definition/reader.ts src/definition/reader.test.ts src/definition/modules.ts src/definition/modules.test.ts
git commit -m "feat: 버전별 파일 읽기와 import 경로 풀기 추가"
```

---

### Task 4: 정의 찾기 전체 순서

**Files:**
- Create: `src/definition/resolve.ts`
- Test: `src/definition/resolve.test.ts`

**Interfaces:**
- Consumes: `classifyToken`, `isSourceFile` (Task 1), `parseImports`, `declarationRegex`, `findDeclarationLines`, `findExport` (Task 2), `SourceReader`, `worktreeReader`, `commitReader`, `resolveModule` (Task 3)
- Produces:
  - `type DefinitionResult = { kind: 'found'; targets: { path: string; line: number }[] } | { kind: 'self' } | { kind: 'external'; module: string } | { kind: 'not_found' }`
  - `resolveDefinition(reader: SourceReader, filePath: string, line: number, col: number): DefinitionResult`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/definition/resolve.test.ts`:

```ts
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
  it('opens import paths', () => {
    const reader = worktreeReader(setup().repo)
    expect(click(reader, 'src/page.ts', PAGE[0], 1, "'./utils/date'")).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 1 }] })
    expect(click(reader, 'src/page.ts', PAGE[4], 5, "'@/components")).toEqual({ kind: 'found', targets: [{ path: 'src/components/Comp.vue', line: 1 }] })
    expect(click(reader, 'src/page.ts', PAGE[3], 4, "'react'")).toEqual({ kind: 'external', module: 'react' })
  })

  it('follows imported names to their export', () => {
    const reader = worktreeReader(setup().repo)
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'fmt')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 1 }] })
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'sum')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/math.ts', line: 1 }] })
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'main')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 4 }] })
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'helper')).toEqual({ kind: 'found', targets: [{ path: 'lib/helper.ts', line: 1 }] })
    expect(click(reader, 'src/page.ts', PAGE[2], 3, 'utils')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/index.ts', line: 1 }] })
    expect(click(reader, 'src/page.ts', PAGE[3], 4, 'React')).toEqual({ kind: 'external', module: 'react' })
  })

  it('follows up to five re-exports and falls back to the imported file', () => {
    const reader = worktreeReader(setup().repo)
    const use = ['', '', 'aDeep + bDeep']
    expect(click(reader, 'src/chain/use.ts', use[2], 3, 'aDeep')).toEqual({ kind: 'found', targets: [{ path: 'src/chain/a5.ts', line: 1 }] })
    expect(click(reader, 'src/chain/use.ts', use[2], 3, 'bDeep')).toEqual({ kind: 'found', targets: [{ path: 'src/chain/b0.ts', line: 1 }] })
  })

  it('finds local declarations and reports the declaration line itself', () => {
    const reader = worktreeReader(setup().repo)
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'local')).toEqual({ kind: 'found', targets: [{ path: 'src/page.ts', line: 7 }] })
    expect(click(reader, 'src/page.ts', PAGE[7], 8, 'run')).toEqual({ kind: 'self' })
  })

  it('searches the repository for other names', () => {
    const reader = worktreeReader(setup().repo)
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'globalThing')).toEqual({
      kind: 'found',
      targets: [{ path: 'src/global.ts', line: 1 }, { path: 'src/other.ts', line: 1 }],
    })
    expect(click(reader, 'src/page.ts', PAGE[8], 9, 'missing')).toEqual({ kind: 'not_found' })
  })

  it('searches names containing $', () => {
    const reader = worktreeReader(setup().repo)
    expect(click(reader, 'src/page.ts', PAGE[8], 9, '$store')).toEqual({ kind: 'found', targets: [{ path: 'src/store.ts', line: 1 }] })
  })

  it('handles names inside a vue file', () => {
    const reader = worktreeReader(setup().repo)
    expect(resolveDefinition(reader, 'src/components/Comp.vue', 2, '  <p>{{ count }}</p>'.indexOf('count'))).toEqual({ kind: 'found', targets: [{ path: 'src/components/Comp.vue', line: 6 }] })
    expect(resolveDefinition(reader, 'src/components/Comp.vue', 6, 'const count = sum(1, 2)'.indexOf('sum'))).toEqual({ kind: 'found', targets: [{ path: 'src/utils/math.ts', line: 1 }] })
  })

  it('returns not_found for non-source files and positions outside the file', () => {
    const reader = worktreeReader(setup().repo)
    expect(resolveDefinition(reader, 'README.md', 1, 6)).toEqual({ kind: 'not_found' })
    expect(resolveDefinition(reader, 'src/page.ts', 999, 0)).toEqual({ kind: 'not_found' })
  })

  it('reads the requested version', () => {
    const { repo, sha } = setup()
    writeFileSync(join(repo, 'src/utils/date.ts'), '// moved\n\nexport function formatDate(d: Date) {\n  return d\n}\n')
    expect(click(commitReader(repo, sha), 'src/page.ts', PAGE[8], 9, 'fmt')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 1 }] })
    expect(click(worktreeReader(repo), 'src/page.ts', PAGE[8], 9, 'fmt')).toEqual({ kind: 'found', targets: [{ path: 'src/utils/date.ts', line: 3 }] })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/definition/resolve.test.ts`
Expected: FAIL, `Cannot find module './resolve'`

- [ ] **Step 3: 구현**

`src/definition/resolve.ts`:

```ts
import { classifyToken } from './token.js'
import { isSourceFile } from './sourceFiles.js'
import { parseImports } from './imports.js'
import { declarationRegex, findDeclarationLines, findExport } from './declarations.js'
import { resolveModule } from './modules.js'
import type { SourceReader } from './reader.js'

export interface DefinitionTarget {
  path: string
  line: number
}

export type DefinitionResult =
  | { kind: 'found'; targets: DefinitionTarget[] }
  | { kind: 'self' }
  | { kind: 'external'; module: string }
  | { kind: 'not_found' }

const MAX_REEXPORT_DEPTH = 5
const MAX_CANDIDATES = 20
const NOT_FOUND: DefinitionResult = { kind: 'not_found' }

function findExportLocation(reader: SourceReader, path: string, name: string, depth: number): DefinitionTarget | null {
  if (depth > MAX_REEXPORT_DEPTH) return null
  const text = reader.readFile(path)
  if (text === null) return null
  const matches = findExport(text, name)
  const direct = matches.find((m) => m.kind === 'line')
  if (direct?.kind === 'line') return { path, line: direct.line }
  for (const m of matches) {
    if (m.kind !== 'reexport') continue
    const target = resolveModule(reader, path, m.specifier)
    if (target.kind !== 'file') continue
    const found = findExportLocation(reader, target.path, m.name, depth + 1)
    if (found) return found
  }
  return null
}

function searchDeclarations(reader: SourceReader, name: string): DefinitionTarget[] {
  const escaped = name.replace(/\$/g, '\\$')
  const pattern = `(function|const|let|var|class|interface|type|enum|namespace)[[:space:]*]+${escaped}([^A-Za-z0-9_$]|$)`
  const confirm = declarationRegex(name)
  return reader.grep(pattern)
    .filter((hit) => confirm.test(hit.text))
    .map(({ path, line }) => ({ path, line }))
    .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
}

export function resolveDefinition(reader: SourceReader, filePath: string, line: number, col: number): DefinitionResult {
  if (!isSourceFile(filePath)) return NOT_FOUND
  const text = reader.readFile(filePath)
  if (text === null) return NOT_FOUND
  const lineText = text.split('\n')[line - 1]
  if (lineText === undefined) return NOT_FOUND
  const target = classifyToken(lineText, col)
  if (!target) return NOT_FOUND

  if (target.kind === 'module') {
    const resolved = resolveModule(reader, filePath, target.specifier)
    if (resolved.kind === 'file') return { kind: 'found', targets: [{ path: resolved.path, line: 1 }] }
    if (resolved.kind === 'external') return { kind: 'external', module: target.specifier }
    return NOT_FOUND
  }

  const name = target.name
  const binding = parseImports(text).get(name)
  if (binding) {
    const resolved = resolveModule(reader, filePath, binding.specifier)
    if (resolved.kind === 'external') return { kind: 'external', module: binding.specifier }
    if (resolved.kind === 'missing') return NOT_FOUND
    const location = binding.imported === '*' ? null : findExportLocation(reader, resolved.path, binding.imported, 0)
    return { kind: 'found', targets: [location ?? { path: resolved.path, line: 1 }] }
  }

  const localLines = findDeclarationLines(text, name)
  if (localLines.includes(line)) return { kind: 'self' }
  if (localLines.length > 0) return { kind: 'found', targets: [{ path: filePath, line: localLines[0] }] }

  const hits = searchDeclarations(reader, name).filter((h) => !(h.path === filePath && h.line === line))
  return hits.length > 0 ? { kind: 'found', targets: hits.slice(0, MAX_CANDIDATES) } : NOT_FOUND
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/definition/resolve.test.ts`
Expected: PASS

재수출 단계 확인: `a0`(depth 0)부터 `a5`(depth 5)까지 읽어 `aDeep`을 찾는다. `b` 체인은 `b6`이 depth 6이라 읽지 않고 `b0.ts:1`로 이동한다.

- [ ] **Step 5: 커밋**

```bash
git add src/definition/resolve.ts src/definition/resolve.test.ts
git commit -m "feat: import와 저장소 검색으로 정의 위치 찾기 추가"
```

---

### Task 5: `/api/definition` API

**Files:**
- Modify: `src/server.ts`
- Test: `src/server.definition.test.ts`

**Interfaces:**
- Consumes: `resolveDefinition`, `DefinitionResult` (Task 4), `worktreeReader`, `commitReader`, `SourceReader` (Task 3), 기존 `resolveBranchRefs`, `mrComparisons`, `parseIid`, `getHeadSha`, `isSafePath`, `comparisonErrorResponse`
- Produces:
  - `GET /api/definition?<비교 조합 쿼리>&path=&side=additions|deletions&line=&col=`
  - 응답: `{ kind: 'found'; version: 'new' | 'old'; targets: { path; line }[] } | { kind: 'self' } | { kind: 'external'; module } | { kind: 'not_found' }`, 잘못된 쿼리는 400 `{ error: 'invalid_query' }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server.definition.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { createApp } from './server'

function setup() {
  const repo = makeRepo()
  commit(repo, {
    'src/a.ts': 'export function greet() {}\n',
    'src/b.ts': "import { greet } from './a'\ngreet()\n",
  }, 'base')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  commit(repo, { 'src/a.ts': '// moved\nexport function greet() {}\n' }, 'move')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'src/a.ts'), '\n\n\nexport function greet() {}\n')
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '')
  return createApp({ repoPath: repo, clientDir })
}

const branch = 'mode=branch&source=feature/x&target=main'
const click = 'path=src/b.ts&line=2&col=0'

describe('GET /api/definition', () => {
  it('resolves added lines against the source commit', async () => {
    const app = setup()
    const body = await (await app.request(`/api/definition?${branch}&side=additions&${click}`)).json()
    expect(body).toEqual({ kind: 'found', version: 'new', targets: [{ path: 'src/a.ts', line: 2 }] })
  })

  it('resolves deleted lines against the merge-base', async () => {
    const app = setup()
    const body = await (await app.request(`/api/definition?${branch}&side=deletions&${click}`)).json()
    expect(body).toEqual({ kind: 'found', version: 'old', targets: [{ path: 'src/a.ts', line: 1 }] })
  })

  it('uses the working tree and HEAD in worktree mode', async () => {
    const app = setup()
    expect(await (await app.request(`/api/definition?mode=worktree&side=additions&${click}`)).json())
      .toEqual({ kind: 'found', version: 'new', targets: [{ path: 'src/a.ts', line: 4 }] })
    expect(await (await app.request(`/api/definition?mode=worktree&side=deletions&${click}`)).json())
      .toEqual({ kind: 'found', version: 'old', targets: [{ path: 'src/a.ts', line: 1 }] })
  })

  it('returns other result kinds without a version', async () => {
    const app = setup()
    expect(await (await app.request(`/api/definition?${branch}&side=additions&path=src/a.ts&line=2&col=16`)).json()).toEqual({ kind: 'self' })
    expect(await (await app.request(`/api/definition?${branch}&side=additions&path=src/b.ts&line=1&col=0`)).json()).toEqual({ kind: 'not_found' })
  })

  it('rejects invalid queries', async () => {
    const app = setup()
    for (const q of ['path=../x.ts&side=additions&line=1&col=0', 'path=src/b.ts&side=left&line=1&col=0', 'path=src/b.ts&side=additions&line=0&col=0', 'path=src/b.ts&side=additions&line=1&col=-1', 'side=additions&line=1&col=0']) {
      const res = await app.request(`/api/definition?${branch}&${q}`)
      expect(res.status).toBe(400)
    }
  })
})
```

`src/a.ts` 2번 줄 `export function greet() {}`에서 `greet`의 시작 글자 위치는 16이다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/server.definition.test.ts`
Expected: FAIL, 응답이 index.html이라 JSON 파싱 실패

- [ ] **Step 3: 구현**

`src/server.ts` import에 추가:

```ts
import { worktreeReader, commitReader, type SourceReader } from './definition/reader.js'
import { resolveDefinition } from './definition/resolve.js'
```

`app.get('/api/file-versions', ...)` 앞에 추가:

```ts
  const readerFor = async (c: Context, side: 'additions' | 'deletions'): Promise<SourceReader | null> => {
    const mode = c.req.query('mode')
    if (mode === 'branch' && !isCustomMode) {
      const refs = resolveBranchRefs(repo, { source: c.req.query('source'), target: c.req.query('target') })
      return commitReader(repo, side === 'additions' ? refs.sourceSha : refs.mergeBase)
    }
    if (mode === 'mr' && !isCustomMode) {
      const resolved = await mrComparisons.resolve(parseIid(c.req.query('iid')), { refresh: false })
      return commitReader(repo, side === 'additions' ? resolved.sourceSha! : resolved.mergeBase!)
    }
    if (side === 'additions') return worktreeReader(repo)
    const head = getHeadSha(repo)
    return head ? commitReader(repo, head) : null
  }

  app.get('/api/definition', async (c) => {
    const path = c.req.query('path')
    const side = c.req.query('side')
    const line = c.req.query('line') ?? ''
    const col = c.req.query('col') ?? ''
    if (!path || !isSafePath(path, repo) || (side !== 'additions' && side !== 'deletions') || !/^[1-9]\d*$/.test(line) || !/^\d+$/.test(col)) {
      return c.json({ error: 'invalid_query' }, 400)
    }
    let reader: SourceReader | null
    try {
      reader = await readerFor(c, side)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    if (!reader) return c.json({ kind: 'not_found' })
    const result = resolveDefinition(reader, path, Number(line), Number(col))
    return c.json(result.kind === 'found' ? { kind: 'found', version: side === 'additions' ? 'new' : 'old', targets: result.targets } : result)
  })
```

- [ ] **Step 4: 테스트, 타입 검사**

Run: `pnpm exec vitest run src/server.definition.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS, tsc 출력 없음

- [ ] **Step 5: 전체 테스트와 커밋**

Run: `pnpm test`
Expected: 모두 PASS

```bash
git add src/server.ts src/server.definition.test.ts
git commit -m "feat: 정의 위치 조회 API 추가"
```

---

### Task 6: diff 카드의 Cmd+클릭, 후보 목록, 카드 이동

**Files:**
- Create: `src/ui/definition.ts`, `src/ui/components/DefinitionPopover.tsx`
- Modify: `src/ui/components/FileDiffCard.tsx`, `src/ui/components/DiffViewer.tsx`, `src/ui/App.tsx`, `src/ui/styles/global.css`
- Test: `src/ui/definition.test.ts`

**Interfaces:**
- Consumes: `isSourceFile` (Task 1), `/api/definition` (Task 5), 기존 `handleFileClick`, `setHighlight`, `highlightTimer`
- Produces:
  - `interface DefinitionRequest { path: string; side: 'additions' | 'deletions'; line: number; col: number }`
  - `type DefinitionResponse` (Task 5 응답과 같다), `type DefinitionVersion = 'new' | 'old'`
  - `type DefinitionAction = { type: 'jump'; target: { path: string; line: number }; version: DefinitionVersion } | { type: 'choose'; targets: { path: string; line: number }[]; version: DefinitionVersion } | { type: 'message'; text: string }`
  - `definitionAction(res: DefinitionResponse | null): DefinitionAction` (`null`은 요청 실패)
  - `fetchDefinition(contentQuery: string, req: DefinitionRequest): Promise<DefinitionResponse>`
  - `FileDiffCard`, `DiffViewer` 새 props `onDefinition?: (req: DefinitionRequest, anchor: DOMRect) => void`, `onHighlightMissing?: (filePath: string, line: number, side: 'additions' | 'deletions') => void`
  - `DefinitionPopover` props `{ anchor: DOMRect; content: PopoverContent; onClose: () => void }`, `type PopoverContent = { type: 'choose'; targets: { path: string; line: number }[]; onPick: (t: { path: string; line: number }) => void } | { type: 'message'; text: string }`
  - `App` 상태 `overlayEntries: { path: string; line: number; version: DefinitionVersion }[]`와 `openOverlay(entry)`. 이 Task에서는 목록에 항목을 쌓기만 하고, 창은 Task 7에서 그린다
  - `App`의 `contentQuery: string`(`params?.toString() ?? ''`)과 `handleDefinition(req, anchor, fromOverlay?)`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/ui/definition.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { definitionAction } from './definition'

describe('definitionAction', () => {
  it('jumps to a single target and lets the user choose among several', () => {
    expect(definitionAction({ kind: 'found', version: 'new', targets: [{ path: 'a.ts', line: 3 }] }))
      .toEqual({ type: 'jump', target: { path: 'a.ts', line: 3 }, version: 'new' })
    expect(definitionAction({ kind: 'found', version: 'old', targets: [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }] }))
      .toEqual({ type: 'choose', targets: [{ path: 'a.ts', line: 1 }, { path: 'b.ts', line: 2 }], version: 'old' })
  })

  it('shows a message for the other results', () => {
    expect(definitionAction({ kind: 'self' })).toEqual({ type: 'message', text: '이미 정의 위치입니다' })
    expect(definitionAction({ kind: 'external', module: 'react' })).toEqual({ type: 'message', text: '외부 패키지는 이동하지 않습니다' })
    expect(definitionAction({ kind: 'not_found' })).toEqual({ type: 'message', text: '정의를 찾지 못했습니다' })
    expect(definitionAction({ kind: 'found', version: 'new', targets: [] })).toEqual({ type: 'message', text: '정의를 찾지 못했습니다' })
    expect(definitionAction(null)).toEqual({ type: 'message', text: '정의를 찾는 중 오류가 났습니다' })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/ui/definition.test.ts`
Expected: FAIL, `Cannot find module './definition'`

- [ ] **Step 3: `src/ui/definition.ts` 구현**

```ts
export interface DefinitionRequest {
  path: string
  side: 'additions' | 'deletions'
  line: number
  col: number
}

export type DefinitionVersion = 'new' | 'old'

export interface DefinitionTarget {
  path: string
  line: number
}

export type DefinitionResponse =
  | { kind: 'found'; version: DefinitionVersion; targets: DefinitionTarget[] }
  | { kind: 'self' }
  | { kind: 'external'; module: string }
  | { kind: 'not_found' }

export type DefinitionAction =
  | { type: 'jump'; target: DefinitionTarget; version: DefinitionVersion }
  | { type: 'choose'; targets: DefinitionTarget[]; version: DefinitionVersion }
  | { type: 'message'; text: string }

export function definitionAction(res: DefinitionResponse | null): DefinitionAction {
  if (!res) return { type: 'message', text: '정의를 찾는 중 오류가 났습니다' }
  if (res.kind === 'self') return { type: 'message', text: '이미 정의 위치입니다' }
  if (res.kind === 'external') return { type: 'message', text: '외부 패키지는 이동하지 않습니다' }
  if (res.kind === 'not_found' || res.targets.length === 0) return { type: 'message', text: '정의를 찾지 못했습니다' }
  if (res.targets.length === 1) return { type: 'jump', target: res.targets[0], version: res.version }
  return { type: 'choose', targets: res.targets, version: res.version }
}

export async function fetchDefinition(contentQuery: string, req: DefinitionRequest): Promise<DefinitionResponse> {
  const q = new URLSearchParams(contentQuery)
  q.set('path', req.path)
  q.set('side', req.side)
  q.set('line', String(req.line))
  q.set('col', String(req.col))
  const res = await fetch(`/api/definition?${q}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/ui/definition.test.ts`
Expected: PASS

- [ ] **Step 5: `DefinitionPopover.tsx` 작성**

```tsx
import { useEffect, useRef } from 'react'
import type { DefinitionTarget } from '../definition'

export type PopoverContent =
  | { type: 'choose'; targets: DefinitionTarget[]; onPick: (target: DefinitionTarget) => void }
  | { type: 'message'; text: string }

interface DefinitionPopoverProps {
  anchor: DOMRect
  content: PopoverContent
  onClose: () => void
}

export function DefinitionPopover({ anchor, content, onClose }: DefinitionPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (content.type === 'message') {
      const timer = setTimeout(onClose, 2000)
      return () => clearTimeout(timer)
    }
    const handleMouse = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouse)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouse)
      document.removeEventListener('keydown', handleKey)
    }
  }, [content, onClose])

  return (
    <div className="definition-popover" ref={rootRef} style={{ top: anchor.bottom + 4, left: anchor.left }}>
      {content.type === 'message' ? (
        <div className="definition-popover-message">{content.text}</div>
      ) : (
        content.targets.map((t) => (
          <button key={`${t.path}:${t.line}`} className="definition-popover-item" onClick={() => content.onPick(t)}>
            {t.path}:{t.line}
          </button>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 6: `FileDiffCard.tsx`, `DiffViewer.tsx` 수정**

`FileDiffCard.tsx` import에 추가:

```tsx
import { isSourceFile } from '../../definition/sourceFiles'
import type { DefinitionRequest } from '../definition'
```

props에 추가:

```tsx
  onDefinition?: (req: DefinitionRequest, anchor: DOMRect) => void
  onHighlightMissing?: (filePath: string, line: number, side: 'additions' | 'deletions') => void
```

구조 분해에 `onDefinition, onHighlightMissing`을 추가하고 강조 effect의 `tryScroll`에서 30프레임 동안 못 찾으면 알린다:

```tsx
      if (frames++ < 30) handle = requestAnimationFrame(tryScroll)
      else onHighlightMissing?.(filePath, highlightLine.line, highlightLine.side)
```

컴포넌트 안에 다음을 추가한다:

```tsx
  const linkable = !!onDefinition && isSourceFile(filePath)
  const tokenHandlers = linkable ? {
    onTokenEnter: (props: { tokenElement: HTMLElement }, event: PointerEvent) => {
      if (!event.metaKey) return
      props.tokenElement.style.textDecoration = 'underline'
      props.tokenElement.style.cursor = 'pointer'
    },
    onTokenLeave: (props: { tokenElement: HTMLElement }) => {
      props.tokenElement.style.textDecoration = ''
      props.tokenElement.style.cursor = ''
    },
    onTokenClick: (props: { side: 'additions' | 'deletions'; lineNumber: number; lineCharStart: number; tokenElement: HTMLElement }, event: MouseEvent) => {
      if (!event.metaKey) return
      event.preventDefault()
      onDefinition!({ path: filePath, side: props.side, line: props.lineNumber, col: props.lineCharStart }, props.tokenElement.getBoundingClientRect())
    },
  } : {}
```

`FileDiff`의 `options` 객체 끝에 `...tokenHandlers,`를 추가한다.

`DiffViewer.tsx` props 타입에 같은 두 prop을 추가하고(`import type { DefinitionRequest } from '../definition'`), 구조 분해한 뒤 `FileDiffCard`에 `onDefinition={onDefinition}`, `onHighlightMissing={onHighlightMissing}`로 넘긴다.

- [ ] **Step 7: `App.tsx` 연결**

import 추가:

```tsx
import { DefinitionPopover, type PopoverContent } from './components/DefinitionPopover'
import { definitionAction, fetchDefinition, type DefinitionAction, type DefinitionRequest, type DefinitionTarget, type DefinitionVersion } from './definition'
```

`handleFindingClick` 다음에 추가한다. 오버레이는 Task 7에서 붙이므로 여기서는 `overlayEntries` 상태만 만든다:

```tsx
  const contentQuery = params?.toString() ?? ''
  const [popover, setPopover] = useState<{ anchor: DOMRect; content: PopoverContent } | null>(null)
  const closePopover = useCallback(() => setPopover(null), [])
  const [overlayEntries, setOverlayEntries] = useState<{ path: string; line: number; version: DefinitionVersion }[]>([])
  const pendingJump = useRef<{ file: string; line: number; side: 'additions' | 'deletions'; version: DefinitionVersion } | null>(null)

  const openOverlay = useCallback((entry: { path: string; line: number; version: DefinitionVersion }) => {
    setOverlayEntries((prev) => [...prev, entry])
  }, [])

  const visibleFileNames = useMemo(() => new Set(visibleFiles.map((f) => f.name)), [visibleFiles])

  const jumpTo = useCallback((target: DefinitionTarget, version: DefinitionVersion, fromOverlay: boolean) => {
    const side = version === 'new' ? 'additions' : 'deletions'
    if (!fromOverlay && visibleFileNames.has(target.path)) {
      pendingJump.current = { file: target.path, line: target.line, side, version }
      handleFileClick(target.path)
      setHighlight({ file: target.path, side, line: target.line })
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlight(null), 2000)
      return
    }
    openOverlay({ path: target.path, line: target.line, version })
  }, [visibleFileNames, handleFileClick, openOverlay])

  const handleHighlightMissing = useCallback((file: string, line: number, side: 'additions' | 'deletions') => {
    const pending = pendingJump.current
    if (!pending || pending.file !== file || pending.line !== line || pending.side !== side) return
    pendingJump.current = null
    openOverlay({ path: file, line, version: pending.version })
  }, [openOverlay])

  const handleDefinition = useCallback(async (req: DefinitionRequest, anchor: DOMRect, fromOverlay = false) => {
    document.body.classList.add('definition-loading')
    let action: DefinitionAction
    try {
      action = definitionAction(await fetchDefinition(contentQuery, req))
    } catch {
      action = definitionAction(null)
    } finally {
      document.body.classList.remove('definition-loading')
    }
    if (action.type === 'jump') {
      jumpTo(action.target, action.version, fromOverlay)
    } else if (action.type === 'choose') {
      const version = action.version
      setPopover({ anchor, content: { type: 'choose', targets: action.targets, onPick: (t) => { setPopover(null); jumpTo(t, version, fromOverlay) } } })
    } else {
      setPopover({ anchor, content: { type: 'message', text: action.text } })
    }
  }, [contentQuery, jumpTo])
```

`DiffViewer`에 `onDefinition={handleDefinition}`, `onHighlightMissing={handleHighlightMissing}`를 넘긴다.

`<div className="app">`의 닫는 태그 바로 앞에 추가:

```tsx
      {popover && <DefinitionPopover anchor={popover.anchor} content={popover.content} onClose={closePopover} />}
```

- [ ] **Step 8: CSS 추가**

`src/ui/styles/global.css` 끝에 추가:

```css
body.definition-loading,
body.definition-loading * {
    cursor: wait !important;
}

.definition-popover {
    position: fixed;
    z-index: 1100;
    min-width: 200px;
    max-width: 480px;
    max-height: 320px;
    overflow-y: auto;
    padding: 4px 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    font-size: 12px;
}

.definition-popover-message {
    padding: 4px 10px;
    color: var(--text-secondary);
}

.definition-popover-item {
    display: block;
    width: 100%;
    padding: 4px 10px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    cursor: pointer;
}

.definition-popover-item:hover {
    background: var(--bg-secondary);
}
```

- [ ] **Step 9: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build`
Expected: 모두 성공

- [ ] **Step 10: 커밋**

```bash
git add src/ui
git commit -m "feat: diff 코드 Cmd+클릭으로 정의 위치 카드로 이동"
```

---

### Task 7: 파일 내용 오버레이 창

**Files:**
- Create: `src/ui/components/FileViewerOverlay.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/styles/global.css`

**Interfaces:**
- Consumes: `DefinitionRequest`, `DefinitionVersion` (Task 6), `findLineElement` (`src/ui/findLine.ts`), `isSourceFile` (Task 1), App의 `overlayEntries`, `setOverlayEntries`, `handleDefinition`, `contentQuery` (Task 6)
- Produces: `FileViewerOverlay` props `{ entries: { path: string; line: number; version: DefinitionVersion }[]; contentQuery: string; onBack: () => void; onClose: () => void; onDefinition: (req: DefinitionRequest, anchor: DOMRect) => void }`

UI 컴포넌트라 단위테스트가 없다. Step 4의 빌드와 Task 8의 앱 확인으로 검증한다.

- [ ] **Step 1: `FileViewerOverlay.tsx` 작성**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { File as CodeFile } from '@pierre/diffs/react'
import { findLineElement } from '../findLine'
import { isSourceFile } from '../../definition/sourceFiles'
import type { DefinitionRequest, DefinitionVersion } from '../definition'

interface OverlayEntry {
  path: string
  line: number
  version: DefinitionVersion
}

interface FileViewerOverlayProps {
  entries: OverlayEntry[]
  contentQuery: string
  onBack: () => void
  onClose: () => void
  onDefinition: (req: DefinitionRequest, anchor: DOMRect) => void
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; contents: string }

export function FileViewerOverlay({ entries, contentQuery, onBack, onClose, onDefinition }: FileViewerOverlayProps) {
  const current = entries[entries.length - 1]
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    const q = new URLSearchParams(contentQuery)
    q.set('path', current.path)
    q.set('version', current.version)
    fetch(`/api/file-content?${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((contents) => { if (!cancelled) setState({ status: 'ready', contents }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [current.path, current.version, contentQuery])

  useEffect(() => {
    if (state.status !== 'ready') return
    let frames = 0
    let handle = 0
    const tryScroll = () => {
      const el = bodyRef.current && findLineElement(bodyRef.current, current.line, 'additions')
      if (el) {
        el.scrollIntoView({ block: 'center' })
        return
      }
      if (frames++ < 60) handle = requestAnimationFrame(tryScroll)
    }
    handle = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(handle)
  }, [state, current.line])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const side = current.version === 'new' ? 'additions' : 'deletions'
  const linkable = isSourceFile(current.path)

  return (
    <div className="file-overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="file-overlay">
        <div className="file-overlay-header">
          <span className="file-overlay-path">{current.path}</span>
          <span className="file-overlay-version">{current.version === 'new' ? '소스' : '기준'}</span>
          <button className="btn btn-sm" onClick={onBack} disabled={entries.length <= 1} title="뒤로">
            <ArrowLeft size={14} /> 뒤로
          </button>
          <button className="btn btn-sm" onClick={onClose} title="닫기">
            <X size={14} />
          </button>
        </div>
        <div className="file-overlay-body" ref={bodyRef}>
          {state.status === 'loading' && <div className="empty-state"><p>Loading...</p></div>}
          {state.status === 'error' && <div className="empty-state"><p>파일을 읽지 못했습니다</p></div>}
          {state.status === 'ready' && (
            <CodeFile
              file={{ name: current.path, contents: state.contents }}
              selectedLines={{ start: current.line, end: current.line }}
              options={{
                disableFileHeader: true,
                theme: { dark: 'github-dark', light: 'github-light' },
                themeType: 'system',
                overflow: 'scroll',
                ...(linkable ? {
                  onTokenEnter: (props, event) => {
                    if (!event.metaKey) return
                    props.tokenElement.style.textDecoration = 'underline'
                    props.tokenElement.style.cursor = 'pointer'
                  },
                  onTokenLeave: (props) => {
                    props.tokenElement.style.textDecoration = ''
                    props.tokenElement.style.cursor = ''
                  },
                  onTokenClick: (props, event) => {
                    if (!event.metaKey) return
                    event.preventDefault()
                    onDefinition({ path: current.path, side, line: props.lineNumber, col: props.lineCharStart }, props.tokenElement.getBoundingClientRect())
                  },
                } : {}),
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `App.tsx` 연결**

import 추가:

```tsx
import { FileViewerOverlay } from './components/FileViewerOverlay'
```

`handleDefinition` 다음에 추가:

```tsx
  const closeOverlay = useCallback(() => setOverlayEntries([]), [])
  const backOverlay = useCallback(() => setOverlayEntries((prev) => prev.slice(0, -1)), [])
  const handleOverlayDefinition = useCallback((req: DefinitionRequest, anchor: DOMRect) => {
    void handleDefinition(req, anchor, true)
  }, [handleDefinition])
```

`popover` 렌더 줄 앞에 추가:

```tsx
      {overlayEntries.length > 0 && (
        <FileViewerOverlay
          entries={overlayEntries}
          contentQuery={contentQuery}
          onBack={backOverlay}
          onClose={closeOverlay}
          onDefinition={handleOverlayDefinition}
        />
      )}
```

비교 조합이 바뀌면 오버레이가 이전 비교 조합의 파일을 보여주지 않도록 닫는다:

```tsx
  useEffect(() => setOverlayEntries([]), [contentQuery])
```

- [ ] **Step 3: CSS 추가**

`src/ui/styles/global.css` 끝에 추가:

```css
.file-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
}

.file-overlay {
    display: flex;
    flex-direction: column;
    width: min(1100px, calc(100vw - 80px));
    height: calc(100vh - 80px);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
    overflow: hidden;
}

.file-overlay-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
}

.file-overlay-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
}

.file-overlay-version {
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-secondary);
}

.file-overlay-body {
    flex: 1;
    overflow: auto;
}
```

- [ ] **Step 4: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build`
Expected: 모두 성공. `onTokenEnter` 등의 props 타입은 `FileOptions`가 `InteractionManagerBaseOptions<'file'>`를 확장해서 추론된다. 추론되지 않으면 `TokenEventBase`를 `@pierre/diffs`에서 가져와 매개변수 타입으로 적는다.

- [ ] **Step 5: 커밋**

```bash
git add src/ui
git commit -m "feat: 정의 파일 내용 오버레이 창과 뒤로 이동 추가"
```

---

### Task 8: 앱 확인과 문서

**Files:**
- Modify: `README.md`, `docs/backlog/gitlab-mr-integration.md`

- [ ] **Step 1: 앱에서 직접 확인 (사용자가 실행)**

사용자에게 `pnpm run dev:app` 실행을 요청하고 사내 TS 또는 Vue 저장소에서 다음을 함께 확인한다.

1. diff의 코드 위에서 Cmd를 누른 채 마우스를 올리면 이름에 밑줄과 손가락 커서가 생긴다. Cmd를 떼고 올리면 생기지 않는다.
2. import 경로 문자열을 Cmd+클릭하면 그 파일이 diff에 있을 때 카드로 스크롤되고, 없을 때 오버레이 창이 열린다.
3. import한 함수 이름을 Cmd+클릭하면 정의 줄로 이동하고 강조 배경이 2초 동안 보인다.
4. 오버레이 창에서 다시 Cmd+클릭하면 창 안에서 다음 파일이 열리고 `뒤로` 클릭 시 이전 파일로 돌아간다. Esc 입력 시 닫히고 보던 diff 위치가 그대로다.
5. 같은 이름의 선언이 여러 곳이면 후보 목록이 뜨고 항목 클릭 시 이동한다.
6. `react` import 이름을 Cmd+클릭하면 "외부 패키지는 이동하지 않습니다"가 2초 동안 보인다.
7. 브랜치 비교에서 삭제 줄의 이름을 Cmd+클릭하면 오버레이 제목 줄에 `기준`이 보인다.

- [ ] **Step 2: README와 백로그 갱신**

`README.md`의 `### GitLab MR 리뷰` 섹션 다음에 추가:

```markdown
### 코드 하이퍼링크

diff 코드에서 Cmd를 누른 채 import 경로나 이름을 클릭하면 정의 위치로 이동한다. `.ts .tsx .js .jsx .mjs .cjs .vue` 파일이 대상이다.

- 정의 파일이 diff에 있으면 그 파일 카드의 해당 줄로 스크롤한다. 없으면 가운데 창에서 파일 내용을 연다. 창 안에서도 Cmd+클릭으로 계속 이동하고 `뒤로`로 돌아간다.
- 같은 이름의 선언이 여러 곳이면 후보 목록이 뜬다.
- 브랜치 비교와 MR에서는 소스 커밋(삭제 줄은 기준 커밋)의 코드에서 찾는다.
- `obj.method`의 `method`처럼 `.` 뒤의 이름은 이동하지 않는다.
```

`docs/backlog/gitlab-mr-integration.md`의 `## 4. AI 리뷰 요청 시 추가 지시 입력`과 `## 6. diff 영역 코드 하이퍼링크` 제목 끝에 ` (구현됨)`을 붙이고, `## 5. 앱 데이터 저장 여부 묻기` 제목 끝에 ` (보류)`를 붙인다.

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/backlog/gitlab-mr-integration.md
git commit -m "docs: 코드 하이퍼링크 사용법과 백로그 상태 갱신"
```
