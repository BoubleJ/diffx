# 코드 하이퍼링크 비동기 처리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정의로 이동, 사용처 보기, 파일 사용처 보기가 git을 비동기로 실행해서 처리 중에도 Electron 메인 프로세스의 이벤트 루프가 멈추지 않게 한다.

**Architecture:** `SourceReader`의 메서드가 Promise를 돌려주고 `close()`를 갖는다. `commitReader`는 `exists`를 요청당 한 번의 `git ls-tree`로, `readFile`을 요청당 하나의 `git cat-file --batch` 프로세스로, `grep`을 비동기 `execFile`로 처리한다. `modules.ts`, `resolve.ts`, `references.ts`는 찾는 규칙을 그대로 두고 `async`로 바꾸며, 서버 핸들러는 처리 후 `finally`에서 `reader.close()`를 호출한다.

**Tech Stack:** TypeScript, Node `child_process`(`execFile`, `spawn`), Hono, vitest

**Spec:** `docs/superpowers/specs/2026-10-02-async-definition-reader-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 찾는 규칙은 바꾸지 않는다. 정규식, re-export 깊이 5, 사용처 상한 200(`MAX_REFERENCES`), 후보 상한 20, grep 경로 필터(`PATHSPECS`), grep 제한 시간 10초, `maxBuffer` 50MB 그대로.
- 기존 하이퍼링크 테스트의 기대값은 바꾸지 않는다. `await`와 `async`만 붙인다.
- 범위 밖: `readerFor`의 `resolveBranchRefs`, `src/git.ts`의 동기 git 호출.
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다. 사용자가 실행을 요청하면 에이전트가 실행한다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 빌드: `pnpm run build:electron`. 작업 시작 시점에 테스트 441개가 통과한다.
- Task 1이 `SourceReader`를 바꾸면 Task 2가 끝날 때까지 `modules.ts`, `resolve.ts`, `references.ts`와 그 테스트는 타입 검사와 테스트가 깨진다. 전체 테스트와 타입 검사는 Task 3에서 확인한다.
- 작업 위치: `main`에서 worktree `../reviewHelper-async-reader`와 브랜치 `feature/async-definition-reader`를 만들어 작업한다.

## Review Focus

1. 한글이나 공백이 들어간 파일 경로(`src/한글 파일.ts`)도 읽고 존재를 확인할 수 있어야 한다. `cat-file --batch` 요청 줄과 `ls-tree -z` 출력이 경로를 그대로 다뤄야 한다. Task 1 테스트 `reads several files with one cat-file process and caches repeated reads`와 `lists the tree once for many exists calls`가 확인한다.
2. 64KB보다 큰 파일은 stdout `data` 이벤트 여러 번에 나뉘어 도착한다. 나뉜 응답을 이어 붙여 정확히 읽어야 한다. Task 1 테스트 `reads several files with one cat-file process and caches repeated reads`가 200KB 파일로 확인한다.
3. 읽기가 진행 중일 때 `close()`가 호출되면 기다리던 읽기가 멈춰 있지 않고 `null`로 끝나야 한다. Task 1 테스트 `stops the cat-file process on close and returns null afterwards`가 확인한다.
4. 빈 파일은 `null`이 아니라 빈 문자열이어야 한다. 빈 `index.ts`가 있는 폴더의 import가 `missing`으로 처리되면 안 된다. Task 1 테스트 `reads several files with one cat-file process and caches repeated reads`가 확인한다.
5. 처리 중 이벤트 루프가 멈추지 않아야 한다. Task 1 Step 2에서 추가하고 Task 3에서 통과시키는 테스트 `keeps the event loop running while listing references`가 확인한다.

---

### Task 1: 비동기 `SourceReader`

**Files:**
- Modify: `src/definition/reader.ts` (전체 교체)
- Test: `src/definition/reader.test.ts`, `src/server.definition.test.ts`(이벤트 루프 테스트 추가만, 커밋은 Task 3)

**Interfaces:**
- Produces:
  - `interface SourceReader { readFile(path: string): Promise<string | null>; exists(path: string): Promise<boolean>; grep(pattern: string): Promise<GrepHit[]>; close(): void }`
  - `type GitFn = (repo: string, args: string[], timeout?: number) => Promise<string>`
  - `type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildProcessWithoutNullStreams`
  - `runGit: GitFn` (`-c core.quotepath=false`를 앞에 붙여 `execFile`로 실행)
  - `commitReader(repo: string, sha: string, options?: { spawn?: SpawnFn; git?: GitFn }): SourceReader`
  - `worktreeReader(repo: string): SourceReader`

- [ ] **Step 1: worktree 만들기**

```bash
cd /Users/byeonjaejeong/Desktop/reviewHelper
git status --short
git worktree add ../reviewHelper-async-reader -b feature/async-definition-reader
cd ../reviewHelper-async-reader
pnpm install --frozen-lockfile
```

`git status --short`에 출력이 있으면 멈추고 사용자에게 묻는다. 이후 모든 단계는 `../reviewHelper-async-reader`에서 실행한다.

- [ ] **Step 2: 이벤트 루프 테스트를 먼저 추가하고 지금 코드에서 실패 확인**

`src/server.definition.test.ts`에서 `/api/references`를 요청하는 테스트가 있는 `describe` 블록 안 마지막에 추가한다. 이 테스트는 지금 코드가 앱을 멈추게 한다는 것을 보여주는 RED다. Task 3에서 통과시키고 Task 3 커밋에 포함한다.

```ts
  it('keeps the event loop running while listing references', async () => {
    const app = setup()
    let ticks = 0
    const timer = setInterval(() => ticks++, 1)
    try {
      const res = await app.request(`/api/references?${branch}&side=additions&path=src/a.ts&line=2&col=16`)
      expect(res.status).toBe(200)
    } finally {
      clearInterval(timer)
    }
    expect(ticks).toBeGreaterThan(0)
  })
```

Run: `pnpm vitest run src/server.definition.test.ts -t "keeps the event loop running"`
Expected: FAIL, `expected 0 to be greater than 0`. 지금 핸들러는 처리 중 동기 git만 실행하므로 타이머가 한 번도 실행되지 않는다.

- [ ] **Step 3: 기존 reader 테스트를 비동기로 바꾸기**

`src/definition/reader.test.ts`의 기존 테스트 네 개에서 아래만 바꾼다. 기대값은 바꾸지 않는다.

1. 각 `it('...', () => {`를 `it('...', async () => {`로 바꾼다.
2. `reader.readFile(`, `reader.exists(`, `worktreeReader(repo).grep(`, `commitReader(repo, sha).grep(` 호출 앞에 `await`를 붙인다. 예: `expect(await reader.readFile('src/a.ts')).toBe(...)`, `const hits = await worktreeReader(repo).grep('const alpha')`.

- [ ] **Step 4: 새 테스트 추가**

import를 바꾼다.

```ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { makeRepo, commit } from '../test/gitRepo'
import { worktreeReader, commitReader, runGit, type GitFn, type SpawnFn } from './reader'
```

파일 끝에 추가한다.

```ts
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
```

`pending`은 `close()` 전에 응답이 먼저 도착하면 내용을 돌려줄 수 있다. 이 경우 `expect(await pending).toBeNull()`이 실패하면 그 줄을 `await pending`으로 바꾸고 ledger에 기록한다. 이 테스트가 확인하려는 것은 `close()` 뒤에 기다리는 읽기가 멈춰 있지 않는 것이다.

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm vitest run src/definition/reader.test.ts`
Expected: FAIL. `runGit`이 없다는 import 오류(`does not provide an export named 'runGit'`)로 모듈을 불러오지 못한다.

- [ ] **Step 6: `reader.ts` 교체**

파일 전체를 아래로 바꾼다.

```ts
import { execFile, spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getWorktreeFileContent } from '../git.js'
import { isSafePath } from '../path.js'
import { SOURCE_EXTENSIONS } from './sourceFiles.js'

export interface GrepHit {
  path: string
  line: number
  text: string
}

export interface SourceReader {
  readFile(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  grep(pattern: string): Promise<GrepHit[]>
  close(): void
}

export type GitFn = (repo: string, args: string[], timeout?: number) => Promise<string>
export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildProcessWithoutNullStreams

const PATHSPECS = [
  ...SOURCE_EXTENSIONS.map((ext) => `*${ext}`),
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/dist/**',
  ':(exclude,glob)**/.nuxt/**',
  ':(exclude,glob)**/.next/**',
]

const GIT_PREFIX = ['-c', 'core.quotepath=false']
const GREP_TIMEOUT_MS = 10_000
const MAX_BUFFER = 50 * 1024 * 1024

export const runGit: GitFn = (repo, args, timeout) =>
  new Promise((done, fail) => {
    execFile('git', [...GIT_PREFIX, ...args], { cwd: repo, encoding: 'utf-8', maxBuffer: MAX_BUFFER, timeout }, (err, stdout) => {
      if (err) fail(err)
      else done(stdout)
    })
  })

async function runGrep(git: GitFn, repo: string, args: string[], prefix: string): Promise<GrepHit[]> {
  let output: string
  try {
    output = await git(repo, ['grep', '-n', '-I', '-E', ...args], GREP_TIMEOUT_MS)
  } catch (err) {
    const { code, signal } = err as { code?: number | string; signal?: string }
    if (code === 1 || signal === 'SIGTERM') return []
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

class BatchReader {
  private proc: ChildProcessWithoutNullStreams | null = null
  private stopped = false
  private buffer = Buffer.alloc(0)
  private waiting: ((content: string | null) => void)[] = []

  constructor(private repo: string, private spawnFn: SpawnFn) {}

  read(spec: string): Promise<string | null> {
    if (this.stopped) return Promise.resolve(null)
    const proc = this.start()
    return new Promise((done) => {
      this.waiting.push(done)
      proc.stdin.write(`${spec}\n`)
    })
  }

  close(): void {
    this.stop()
    this.proc?.kill()
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const proc = this.spawnFn('git', [...GIT_PREFIX, 'cat-file', '--batch'], { cwd: this.repo })
    proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    proc.on('error', () => this.stop())
    proc.on('close', () => this.stop())
    proc.stdin.on('error', () => this.stop())
    this.proc = proc
    return proc
  }

  private drain(): void {
    while (this.waiting.length > 0) {
      const newline = this.buffer.indexOf(0x0a)
      if (newline < 0) return
      const header = this.buffer.subarray(0, newline).toString('utf-8')
      const m = header.match(/^[0-9a-f]+ (\S+) (\d+)$/)
      if (!m) {
        this.buffer = this.buffer.subarray(newline + 1)
        this.waiting.shift()!(null)
        continue
      }
      const end = newline + 1 + Number(m[2])
      if (this.buffer.length < end + 1) return
      const content = this.buffer.subarray(newline + 1, end)
      this.buffer = this.buffer.subarray(end + 1)
      this.waiting.shift()!(m[1] === 'blob' ? content.toString('utf-8') : null)
    }
  }

  private stop(): void {
    this.stopped = true
    for (const done of this.waiting.splice(0)) done(null)
  }
}

export function worktreeReader(repo: string): SourceReader {
  return {
    readFile: async (path) => getWorktreeFileContent(repo, path),
    exists: async (path) => {
      if (!isSafePath(path, repo)) return false
      try {
        return statSync(resolve(repo, path)).isFile()
      } catch {
        return false
      }
    },
    grep: (pattern) => runGrep(runGit, repo, ['--untracked', '-e', pattern, '--', ...PATHSPECS], ''),
    close: () => {},
  }
}

export function commitReader(repo: string, sha: string, options: { spawn?: SpawnFn; git?: GitFn } = {}): SourceReader {
  const git = options.git ?? runGit
  const batch = new BatchReader(repo, options.spawn ?? (nodeSpawn as SpawnFn))
  const files = new Map<string, Promise<string | null>>()
  let tree: Promise<Set<string>> | null = null
  const listFiles = () => {
    tree ??= git(repo, ['ls-tree', '-r', '-z', '--name-only', sha])
      .then((out) => new Set(out.split('\0').filter(Boolean)))
      .catch(() => new Set<string>())
    return tree
  }
  return {
    readFile: (path) => {
      if (!isSafePath(path, repo) || path.includes('\n')) return Promise.resolve(null)
      let cached = files.get(path)
      if (!cached) {
        cached = batch.read(`${sha}:${path}`)
        files.set(path, cached)
      }
      return cached
    },
    exists: async (path) => isSafePath(path, repo) && (await listFiles()).has(path),
    grep: (pattern) => runGrep(git, repo, ['-e', pattern, sha, '--', ...PATHSPECS], `${sha}:`),
    close: () => batch.close(),
  }
}
```

`getFileAtCommit` import는 더 쓰지 않으므로 빠진다. `src/git.ts`의 `getFileAtCommit`은 다른 곳에서 쓰므로 지우지 않는다.

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm vitest run src/definition/reader.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 8: 커밋**

```bash
git add src/definition/reader.ts src/definition/reader.test.ts
git commit -m "refactor: 코드 하이퍼링크 파일 읽기와 검색을 비동기로 변경하고 git 프로세스 수 줄이기"
```

---

### Task 2: 해석 함수 비동기 전환

**Files:**
- Modify: `src/definition/modules.ts`, `src/definition/resolve.ts`, `src/definition/references.ts`
- Test: `src/definition/modules.test.ts`, `src/definition/resolve.test.ts`, `src/definition/references.test.ts`

**Interfaces:**
- Consumes: Task 1의 `SourceReader`
- Produces:
  - `resolveModule(reader: SourceReader, fromFile: string, specifier: string): Promise<ModuleResolution>`
  - `resolveDefinition(reader: SourceReader, filePath: string, line: number, col: number): Promise<DefinitionResult>`
  - `findSymbolReferences(reader: SourceReader, filePath: string, line: number, col: number): Promise<ReferencesResult>`
  - `findFileReferences(reader: SourceReader, filePath: string): Promise<ReferencesResult>`

- [ ] **Step 1: 테스트를 비동기 호출로 바꾸기**

세 테스트 파일에서 아래만 바꾼다. 기대값은 바꾸지 않는다.

1. 각 `it('...', () => {`를 `it('...', async () => {`로 바꾼다.
2. `resolveModule(`, `resolveDefinition(`, `findSymbolReferences(`, `findFileReferences(` 호출 앞에 `await`를 붙인다. import 줄은 바꾸지 않는다.
3. `resolve.test.ts`의 `click(...)` 호출 앞에 `await`를 붙인다. `click` 함수 본문은 `resolveDefinition`의 Promise를 그대로 돌려주므로 바꾸지 않는다.
4. `references.test.ts`의 `refs` 헬퍼 타입을 바꾼다.

```ts
const refs = (r: Awaited<ReturnType<typeof findSymbolReferences>>) => (r.kind === 'found' ? r.references.map((x) => `${x.path}:${x.line}`) : r.kind)
```

`expect(fn(...))` 형태는 `expect(await fn(...))`로, `const result = fn(...)`은 `const result = await fn(...)`으로 바꾼다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/definition/modules.test.ts src/definition/resolve.test.ts src/definition/references.test.ts`
Expected: FAIL. 해석 함수가 Promise를 `await`하지 않아 `reader.readFile`의 Promise를 문자열로 다루면서 결과가 `not_found`, `not_declaration`, `missing`으로 나온다.

- [ ] **Step 3: `modules.ts` 바꾸기**

`tryFile`, `findConfig`, `readConfig`, `resolveModule`을 아래로 바꾼다. `parseJsonc`, `matchPaths`, `PathConfig`, `EXTENSIONS`는 그대로 둔다.

```ts
async function tryFile(reader: SourceReader, base: string): Promise<string | null> {
  const norm = posix.normalize(base)
  if (norm.startsWith('..') || posix.isAbsolute(norm)) return null
  const candidates = [norm, ...EXTENSIONS.map((e) => norm + e), ...EXTENSIONS.map((e) => posix.join(norm, `index${e}`))]
  const jsLike = norm.match(/^(.*)\.(?:m?js|cjs|jsx)$/)
  if (jsLike) candidates.push(`${jsLike[1]}.ts`, `${jsLike[1]}.tsx`)
  for (const candidate of candidates) {
    if (await reader.exists(candidate)) return candidate
  }
  return null
}

async function findConfig(reader: SourceReader, fromFile: string): Promise<string | null> {
  let dir = posix.dirname(fromFile)
  for (;;) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const file = dir === '.' ? name : posix.join(dir, name)
      if (await reader.exists(file)) return file
    }
    if (dir === '.') return null
    dir = posix.dirname(dir)
  }
}
```

`readConfig`는 시그니처와 두 줄을 바꾼다.

```ts
async function readConfig(reader: SourceReader, file: string, depth: number): Promise<PathConfig | null> {
  const text = await reader.readFile(file)
```

```ts
    inherited = (await readConfig(reader, target.endsWith('.json') ? target : `${target}.json`, depth + 1)) ?? {}
```

`resolveModule`을 바꾼다.

```ts
export async function resolveModule(reader: SourceReader, fromFile: string, specifier: string): Promise<ModuleResolution> {
  const found = (path: string | null): ModuleResolution => (path ? { kind: 'file', path } : { kind: 'missing' })
  if (specifier.startsWith('.')) return found(await tryFile(reader, posix.join(posix.dirname(fromFile), specifier)))

  const configFile = await findConfig(reader, fromFile)
  const config = configFile ? await readConfig(reader, configFile, 0) : null
  if (config?.paths) {
    const base = config.baseUrl ?? config.pathsDir ?? '.'
    for (const target of matchPaths(config.paths, specifier)) {
      const path = await tryFile(reader, posix.join(base, target))
      if (path) return { kind: 'file', path }
    }
  }
  if (config?.baseUrl) {
    const path = await tryFile(reader, posix.join(config.baseUrl, specifier))
    if (path) return { kind: 'file', path }
  }
  if (/^[@~]\//.test(specifier)) {
    const root = configFile ? posix.dirname(configFile) : '.'
    const rest = specifier.slice(2)
    return found((await tryFile(reader, posix.join(root, 'src', rest))) ?? (await tryFile(reader, posix.join(root, rest))))
  }
  return { kind: 'external' }
}
```

- [ ] **Step 4: `resolve.ts` 바꾸기**

`findExportLocation`, `searchDeclarations`, `resolveDefinition`을 아래로 바꾼다.

```ts
async function findExportLocation(reader: SourceReader, path: string, name: string, depth: number): Promise<DefinitionTarget | null> {
  if (depth > MAX_REEXPORT_DEPTH) return null
  const text = await reader.readFile(path)
  if (text === null) return null
  const matches = findExport(text, name)
  const direct = matches.find((m) => m.kind === 'line')
  if (direct?.kind === 'line') return { path, line: direct.line }
  for (const m of matches) {
    if (m.kind !== 'reexport') continue
    const target = await resolveModule(reader, path, m.specifier)
    if (target.kind !== 'file') continue
    const found = await findExportLocation(reader, target.path, m.name, depth + 1)
    if (found) return found
  }
  return null
}

async function searchDeclarations(reader: SourceReader, name: string): Promise<DefinitionTarget[]> {
  const escaped = name.replace(/\$/g, '\\$')
  const prefix = '^[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(declare[[:space:]]+)?(abstract[[:space:]]+)?(async[[:space:]]+)?(const[[:space:]]+)?'
  const pattern = `${prefix}(function|const|let|var|class|interface|type|enum|namespace)[[:space:]*]+${escaped}([^A-Za-z0-9_$]|$)`
  const confirm = declarationRegex(name)
  return (await reader.grep(pattern))
    .filter((hit) => confirm.test(hit.text))
    .map(({ path, line }) => ({ path, line }))
    .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
}

export async function resolveDefinition(reader: SourceReader, filePath: string, line: number, col: number): Promise<DefinitionResult> {
  if (!isSourceFile(filePath)) return NOT_FOUND
  const text = await reader.readFile(filePath)
  if (text === null) return NOT_FOUND
  const lineText = text.split('\n')[line - 1]
  if (lineText === undefined) return NOT_FOUND
  const target = classifyToken(lineText, col, { vue: filePath.endsWith('.vue') })
  if (!target) return NOT_FOUND

  if (target.kind === 'module') {
    const resolved = await resolveModule(reader, filePath, target.specifier)
    if (resolved.kind === 'file') return { kind: 'found', targets: [{ path: resolved.path, line: 1 }] }
    if (resolved.kind === 'external') return { kind: 'external', module: target.specifier }
    return NOT_FOUND
  }

  const name = target.name
  const binding = parseImports(text).get(name)
  if (binding) {
    const resolved = await resolveModule(reader, filePath, binding.specifier)
    if (resolved.kind === 'external') return { kind: 'external', module: binding.specifier }
    if (resolved.kind === 'missing') return NOT_FOUND
    const location = binding.imported === '*' ? null : await findExportLocation(reader, resolved.path, binding.imported, 0)
    return { kind: 'found', targets: [location ?? { path: resolved.path, line: 1 }] }
  }

  const localLines = findDeclarationLines(text, name)
  if (localLines.includes(line)) return { kind: 'self' }
  if (localLines.length > 0) return { kind: 'found', targets: [{ path: filePath, line: localLines[0] }] }

  const hits = (await searchDeclarations(reader, name)).filter((h) => !(h.path === filePath && h.line === line))
  return hits.length > 0 ? { kind: 'found', targets: hits.slice(0, MAX_CANDIDATES) } : NOT_FOUND
}
```

- [ ] **Step 5: `references.ts` 바꾸기**

`createResolver`, `findImporters`를 아래로 바꾼다.

```ts
function createResolver(reader: SourceReader) {
  const cache = new Map<string, Promise<string | null>>()
  return (from: string, specifier: string): Promise<string | null> => {
    const key = `${from}\n${specifier}`
    let cached = cache.get(key)
    if (!cached) {
      cached = resolveModule(reader, from, specifier).then((r) => (r.kind === 'file' ? r.path : null))
      cache.set(key, cached)
    }
    return cached
  }
}

async function findImporters(reader: SourceReader, target: string, resolve: ReturnType<typeof createResolver>): Promise<Importer[]> {
  const name = moduleName(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hits = await reader.grep(`['"/]${name}(/index)?(\\.[A-Za-z]+)?['"]`)
  const paths = [...new Set(hits.map((h) => h.path))].filter((p) => p !== target)
  const importers: Importer[] = []
  for (const path of paths) {
    const text = await reader.readFile(path)
    if (text === null) continue
    const specifierLines: Reference[] = []
    const specifiers = new Set<string>()
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]
      for (const m of lineText.matchAll(SPECIFIER_RE)) {
        if ((await resolve(path, m[1])) !== target) continue
        specifiers.add(m[1])
        if (!specifierLines.some((r) => r.line === i + 1)) specifierLines.push({ path, line: i + 1, text: lineText })
      }
    }
    if (specifierLines.length > 0) importers.push({ path, text, specifierLines, specifiers })
  }
  return importers
}
```

`findSymbolReferences`에서 세 곳을 바꾼다.

```ts
export async function findSymbolReferences(reader: SourceReader, filePath: string, line: number, col: number): Promise<ReferencesResult> {
  const text = await reader.readFile(filePath)
```

```ts
    for (const importer of await findImporters(reader, current.file, resolve)) {
```

`findFileReferences`를 바꾼다.

```ts
export async function findFileReferences(reader: SourceReader, filePath: string): Promise<ReferencesResult> {
  const importers = await findImporters(reader, filePath, createResolver(reader))
  return finish(posix.basename(filePath).replace(/\.[^.]+$/, ''), importers.flatMap((i) => i.specifierLines))
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run src/definition/`
Expected: PASS (`src/definition/`의 모든 테스트 파일)

- [ ] **Step 7: 커밋**

```bash
git add src/definition/modules.ts src/definition/resolve.ts src/definition/references.ts src/definition/modules.test.ts src/definition/resolve.test.ts src/definition/references.test.ts
git commit -m "refactor: 정의 이동과 사용처 검색 해석 함수를 비동기로 변경"
```

---

### Task 3: 서버 핸들러와 이벤트 루프 확인

**Files:**
- Modify: `src/server.ts` (`/api/definition`, `/api/references` 핸들러)
- Test: `src/server.definition.test.ts`

**Interfaces:**
- Consumes: Task 1의 `SourceReader.close()`, Task 2의 `resolveDefinition`, `findSymbolReferences`, `findFileReferences`

- [ ] **Step 1: 핸들러 테스트 실패 확인**

Task 1 Step 2에서 추가한 이벤트 루프 테스트는 아직 커밋하지 않은 상태로 남아 있다.

Run: `pnpm vitest run src/server.definition.test.ts`
Expected: FAIL. 핸들러가 해석 함수의 Promise를 `await`하지 않아 `resolves added lines against the source commit` 등 기존 테스트의 응답 본문이 `{}`로 나온다.

- [ ] **Step 2: 핸들러 수정**

`/api/definition` 핸들러의 `reader = await readerFor(c, side)` 블록 다음 부분을 바꾼다.

```ts
    try {
      const result = await resolveDefinition(reader, path, Number(line), Number(col))
      if (result.kind !== 'found') return c.json(result)
      const targets = await Promise.all(result.targets.map(async (t) => ({ ...t, text: (await reader.readFile(t.path))?.split('\n')[t.line - 1] ?? '' })))
      return c.json({ kind: 'found', version: side === 'additions' ? 'new' : 'old', targets })
    } finally {
      reader.close()
    }
```

`/api/references` 핸들러의 마지막 부분을 바꾼다.

```ts
    try {
      const result = fileTarget ? await findFileReferences(reader, path) : await findSymbolReferences(reader, path, Number(line), Number(col))
      return c.json(result.kind === 'found' ? { ...result, version: side === 'additions' ? 'new' : 'old' } : result)
    } finally {
      reader.close()
    }
```

- [ ] **Step 3: 타입 검사, 전체 테스트, 빌드**

Run: `pnpm exec tsc --noEmit -p . && pnpm test && pnpm run build:electron`
Expected: 타입 오류 없음, 테스트 446개 통과(기존 441개와 Task 1의 새 reader 테스트 4개, 이벤트 루프 테스트 1개), 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add src/server.ts src/server.definition.test.ts
git commit -m "fix: 코드 하이퍼링크 처리 중 앱이 멈추지 않도록 서버 핸들러를 비동기로 변경"
```

- [ ] **Step 5: 앱 확인 (사용자)**

사용자가 worktree에서 `pnpm run dev:app`을 실행하거나 실행을 요청한다. 파일이 많은 저장소를 연다.

1. export된 함수의 정의 자리를 Cmd+클릭해서 사용처 검색을 실행하는 동안 메뉴를 열 수 있고, 다른 저장소 창에서 diff를 바꿀 수 있다.
2. 정의로 이동, 사용처 보기, 파일 경로 Cmd+클릭(파일 사용처 보기)의 결과가 1.3.0 앱과 같다.
3. 사용처 검색이 1.3.0 앱보다 느려지지 않는다.
