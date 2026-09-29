# 브랜치 비교 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** git/서버 코드가 저장소 경로를 인자로 받게 바꾸고, UI에서 소스/타겟 브랜치(로컬, 원격)를 골라 `target...source` diff를 보는 기능을 추가한다.

**Architecture:** `src/git.ts`의 모든 함수가 `repo` 경로를 첫 인자로 받는다. 비교 대상 해석은 새 모듈 `src/comparison.ts`가 맡고 서버의 diff 관련 API가 모두 이 모듈을 거친다. 코멘트와 viewed 상태는 비교 조합 키별로 나뉜다. UI는 Toolbar 왼쪽에 모드 탭과 브랜치 드롭다운(`BranchPicker`)을 둔다.

**Tech Stack:** Node 24, TypeScript, Hono, React 19, @tanstack/react-query, @pierre/diffs, vitest(신규)

**Spec:** `docs/superpowers/specs/2026-09-29-branch-review-desktop-design.md` (섹션 1, 2, 5)

## Global Constraints

- 기존 CLI 사용 방식(`diffx`, `diffx -- <git diff args>`, `--host`, `-p`, `--no-open`)은 그대로 동작한다.
- git 호출은 모두 `execFileSync`/`execFile`에 인자 배열로 넘긴다. 셸 문자열로 조합하지 않는다.
- git diff 호출에는 기존 `DIFF_FLAGS`(`--no-ext-diff`, `--no-color`)를 붙인다.
- 사용자에게 보이는 새 문구는 한국어로 쓴다. 기존 영어 문구는 바꾸지 않는다.
- 코드 주석은 코드만으로 이유를 알기 어려운 경우에만 단다(사용자 전역 지침).
- 커밋 메시지는 한국어, type prefix만 영어. `Co-Authored-By` 트레일러는 넣지 않는다.
- 작업 브랜치: `feat/branch-review-desktop`

## Review Focus

1. 브랜치 이름이 `-`로 시작하는 값(예: `--output=/tmp/x`)으로 들어오면 git 옵션으로 해석되지 않고 400으로 거부돼야 한다. → Task 2 `resolveCommit` 테스트
2. `origin/HEAD` 같은 심볼릭 ref가 드롭다운에 나오면 안 된다. → Task 2 `listBranches` 테스트
3. `key` 없이 `/api/comments`를 부르는 기존 `skills/diffx-finish-review`가 화면에 보이는 조합의 코멘트를 받아야 한다. → Task 4 테스트
4. 브랜치 비교 모드에서 이미지 미리보기가 작업 트리 파일이 아니라 소스 브랜치의 파일을 보여줘야 한다. → Task 3 `/api/file-content` 테스트
5. 공통 조상이 없는 두 브랜치를 고르면 서버가 500으로 죽지 않고 안내 문구를 돌려줘야 한다. → Task 3 테스트

---

## File Structure

| 파일 | 역할 |
|---|---|
| `src/git.ts` (수정) | 모든 함수에 `repo` 인자. 브랜치 목록, 기본 타겟, ref 확인, merge-base, 브랜치 diff, fetch, ref 기준 파일 읽기 추가 |
| `src/comparison.ts` (신규) | 쿼리 → 비교 조합 해석(`resolveComparison`), 조합 키 생성 |
| `src/server.ts` (수정) | `createApp({ repoPath, clientDir, customDiffArgs })`. `/api/repo`, `/api/branches`, `/api/fetch` 추가. diff 관련 API가 `resolveComparison` 사용. 코멘트/viewed 키 분리 |
| `src/comments.ts`, `src/types.ts` (수정) | 코멘트에 `key` 필드 |
| `src/cli.ts` (수정) | `getRepoRoot(process.cwd())`를 `repoPath`로 전달 |
| `src/test/gitRepo.ts` (신규) | 테스트용 임시 저장소 헬퍼 |
| `src/ui/comparison.ts` (신규) | UI의 `Comparison` 타입, 쿼리 파라미터 생성, localStorage 저장/복원 |
| `src/ui/hooks/useRepo.ts`, `useBranches.ts` (신규) | `/api/repo`, `/api/branches`, `/api/fetch` 호출 |
| `src/ui/hooks/useDiff.ts`, `useComments.ts`, `useViewed.ts`, `useFullDiffs.ts` (수정) | 비교 조합 파라미터와 키 사용 |
| `src/ui/components/BranchPicker.tsx`, `RefSelect.tsx` (신규) | 모드 탭, 브랜치 드롭다운 |
| `src/ui/components/Toolbar.tsx`, `DiffViewer.tsx`, `BinaryFileDiff.tsx`, `App.tsx` (수정) | 새 컴포넌트 배치, 파라미터 전달 |
| `src/ui/styles/global.css` (수정) | BranchPicker 스타일 |

---

### Task 1: vitest 추가와 git 함수의 저장소 경로 인자화

**Files:**
- Modify: `package.json`, `tsconfig.json`
- Create: `vitest.config.ts`, `src/test/gitRepo.ts`, `src/git.test.ts`
- Modify: `src/git.ts` (전체), `src/server.ts` (git 호출부, `createApp`, `startServer`), `src/cli.ts:55-72`

**Interfaces:**
- Produces:
  - `src/test/gitRepo.ts`: `makeRepo(): string`, `git(dir: string, ...args: string[]): string`, `commit(dir: string, files: Record<string, string>, message: string): string`(커밋 sha 반환)
  - `src/git.ts`: 기존 함수 전부 첫 인자 `repo: string`. `getRepoRoot(cwd: string): string`, `getRepoName(repo: string): string`, `isGitRepo(cwd: string): boolean`
  - `src/server.ts`: `createApp(options: AppOptions)`, `startServer(options: StartOptions): Promise<{ port: number; close: () => Promise<void> }>`
    ```ts
    export interface AppOptions { repoPath: string; clientDir: string; customDiffArgs?: string[]; commentStore?: CommentStore }
    export interface StartOptions extends AppOptions { port: number; host: string }
    ```

- [ ] **Step 1: vitest 설치**

```bash
pnpm add -D vitest@^3
```

- [ ] **Step 2: 설정 파일 작성**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
})
```

`package.json`의 `scripts`에 추가:
```json
"test": "vitest run",
"test:watch": "vitest"
```

`tsconfig.json`의 `types`를 `["node", "vitest/globals"]`로 바꾸지 않는다. 테스트 파일은 `import { describe, it, expect } from 'vitest'`로 가져온다.

- [ ] **Step 3: 테스트 헬퍼 작성**

`src/test/gitRepo.ts`:
```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
}

// macOS의 tmpdir(/var/...)는 /private/var의 심볼릭 링크라서 git rev-parse --show-toplevel 결과와 맞추려고 realpath를 쓴다.
export function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-test-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

export function commit(dir: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
    git(dir, 'add', path)
  }
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD').trim()
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`src/git.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { getRepoRoot, getRepoName, getBranchName, getGitDiff, isGitRepo } from './git'

describe('git functions take a repo path', () => {
  it('reads branch and diff of the given repo regardless of process.cwd()', () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'one\n' }, 'init')
    git(repo, 'switch', '-q', '-c', 'feature/x')
    writeFileSync(join(repo, 'a.txt'), 'two\n')

    expect(process.cwd()).not.toBe(repo)
    expect(isGitRepo(repo)).toBe(true)
    expect(getRepoRoot(join(repo))).toBe(repo)
    expect(getRepoName(repo)).toBe(repo.split('/').pop())
    expect(getBranchName(repo)).toBe('feature/x')
    expect(getGitDiff(repo)).toContain('+two')
  })
})
```

- [ ] **Step 5: 실패 확인**

Run: `pnpm test src/git.test.ts`
Expected: FAIL. `getBranchName(repo)`가 diffx 저장소 기준(`feat/branch-review-desktop`)을 돌려주거나 타입 오류.

- [ ] **Step 6: `src/git.ts`를 저장소 경로 인자 방식으로 변경**

규칙: 모든 `execFileSync('git', args, opts)` 호출에 `cwd: repo`를 추가하고 함수 첫 인자로 `repo: string`을 받는다. 파일 전체를 아래처럼 바꾼다(기존 로직과 주석은 유지).

```ts
import { execFileSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { isSafePath } from './path.js'
import { parseSync as parseEditorConfig, type ProcessedFileConfig } from 'editorconfig'

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
])

const MAX_BUFFER = 50 * 1024 * 1024

function run(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: 'pipe', maxBuffer: MAX_BUFFER })
}

function runBuffer(repo: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: repo, stdio: 'pipe', maxBuffer: MAX_BUFFER })
}

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function isBinaryFile(absolutePath: string): boolean {
  try {
    const buffer = readFileSync(absolutePath)
    const bytesToCheck = Math.min(buffer.length, 8192)
    for (let i = 0; i < bytesToCheck; i++) {
      if (buffer[i] === 0) return true
    }
    return false
  } catch {
    return true
  }
}

export function getFileContent(repo: string, filePath: string, version: 'old' | 'new'): Buffer | null {
  if (!isSafePath(filePath, repo)) {
    return null
  }
  const resolved = resolve(repo, filePath)
  if (version === 'new') {
    try {
      return readFileSync(resolved)
    } catch {
      return null
    }
  }
  // old version: try staged first, then HEAD
  try {
    return runBuffer(repo, ['show', `HEAD:${filePath}`])
  } catch {
    return null
  }
}

const BLOB_OID_REGEX = /^[0-9a-f]{4,64}$/

export function getBlobContent(repo: string, oid: string): string | null {
  if (!BLOB_OID_REGEX.test(oid) || /^0+$/.test(oid)) {
    return null
  }
  try {
    return run(repo, ['cat-file', 'blob', oid])
  } catch {
    return null
  }
}

export function getWorktreeFileContent(repo: string, filePath: string): string | null {
  if (!isSafePath(filePath, repo)) {
    return null
  }
  const resolved = resolve(repo, filePath)
  try {
    // Match git's notion of the worktree blob: for a symlink that is the
    // target string, never the contents of the file it points at (which
    // could be outside the repository).
    const stats = lstatSync(resolved)
    if (stats.isSymbolicLink()) {
      return readlinkSync(resolved, 'utf-8')
    }
    if (!stats.isFile()) {
      return null
    }
    return readFileSync(resolved, 'utf-8')
  } catch {
    return null
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getRepoRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
}

export function getRepoName(repo: string): string {
  return basename(repo)
}

export function getBranchName(repo: string): string {
  try {
    return run(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  } catch {
    return ''
  }
}

// Force standard unified diff regardless of user's git config
// (e.g. diff.external = difftastic, color.ui = always).
const DIFF_FLAGS = ['--no-ext-diff', '--no-color'] as const

export function getCustomGitDiff(repo: string, args: string[]): string {
  return run(repo, ['diff', ...DIFF_FLAGS, ...args])
}

export function getGitDiff(repo: string, options: { staged?: boolean; untracked?: boolean } = {}): string {
  const parts: string[] = []

  // unstaged changes (always included as the base)
  const unstaged = run(repo, ['diff', ...DIFF_FLAGS])
  if (unstaged) parts.push(unstaged)

  // staged changes
  if (options.staged) {
    const staged = run(repo, ['diff', ...DIFF_FLAGS, '--staged'])
    if (staged) parts.push(staged)
  }

  // untracked files
  if (options.untracked) {
    const untrackedPatch = getUntrackedFilesDiff(repo)
    if (untrackedPatch) parts.push(untrackedPatch)
  }

  return parts.join('\n')
}

export function getTabSizeForFiles(repo: string, filePaths: string[]): Record<string, number> {
  const cache = new Map<string, ProcessedFileConfig>()
  const result: Record<string, number> = {}
  for (const filePath of filePaths) {
    try {
      const absPath = join(repo, filePath)
      const config = parseEditorConfig(absPath, { cache })
      const size = config.tab_width ?? (config.indent_size === 'tab' ? undefined : config.indent_size)
      if (typeof size === 'number') {
        result[filePath] = size
      }
    } catch {
      // skip files that fail to resolve
    }
  }
  return result
}

export function getUntrackedFilePaths(repo: string): string[] {
  const output = run(repo, ['ls-files', '--others', '--exclude-standard']).trim()
  return output ? output.split('\n') : []
}

function getUntrackedFilesDiff(repo: string): string {
  const files = getUntrackedFilePaths(repo)
  if (files.length === 0) return ''

  const patches: string[] = []

  for (const file of files) {
    const absolutePath = join(repo, file)
    if (isBinaryFile(absolutePath)) {
      const patch = [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..0000001',
        `Binary files /dev/null and b/${file} differ`,
      ].join('\n')
      patches.push(patch)
    } else {
      try {
        const content = readFileSync(absolutePath, 'utf-8')
        const lines = content.split('\n')
        const diffLines = lines.map((l: string) => `+${l}`)
        const patch = [
          `diff --git a/${file} b/${file}`,
          'new file mode 100644',
          'index 0000000..0000001',
          '--- /dev/null',
          `+++ b/${file}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...diffLines,
        ].join('\n')
        patches.push(patch)
      } catch {
        // skip unreadable files
      }
    }
  }

  return patches.length > 0 ? '\n' + patches.join('\n') : ''
}
```

- [ ] **Step 7: `src/server.ts`를 새 시그니처로 변경**

1. 파일 위쪽 import 아래에 옵션 타입 추가:
```ts
export interface AppOptions {
  repoPath: string
  clientDir: string
  customDiffArgs?: string[]
  commentStore?: CommentStore
}

export interface StartOptions extends AppOptions {
  port: number
  host: string
}
```
2. `export function createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore) {`를 아래로 바꾼다.
```ts
export function createApp(options: AppOptions) {
  const { repoPath: repo, clientDir, customDiffArgs, commentStore } = options
```
3. `createApp` 안의 git 함수 호출에 `repo`를 첫 인자로 넣는다: `getCustomGitDiff(repo, customDiffArgs)`, `getGitDiff(repo, { staged, untracked })`, `getRepoName(repo)`, `getBranchName(repo)`, `getUntrackedFilePaths(repo)`, `getTabSizeForFiles(repo, filePaths)`, `getFileContent(repo, path, version)`, `getBlobContent(repo, oldOid)`, `getBlobContent(repo, newOid)`, `getWorktreeFileContent(repo, path)`.
4. `startServer`를 아래로 바꾼다.
```ts
export function startServer(options: StartOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp(options)

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolve({
        port: info.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}
```

- [ ] **Step 8: `src/cli.ts` 변경**

`import { isGitRepo } from './git.js'`를 `import { isGitRepo, getRepoRoot } from './git.js'`로 바꾸고 아래 부분을 바꾼다.

```ts
if (!isGitRepo(process.cwd())) {
  console.error('Error: not inside a git repository')
  process.exit(1)
}
const repoPath = getRepoRoot(process.cwd())
```

```ts
const { port: actualPort } = await startServer({ port, host, clientDir: resolvedClientDir, customDiffArgs, repoPath })
```

- [ ] **Step 9: 테스트와 타입 검사 통과 확인**

Run: `pnpm test src/git.test.ts && pnpm exec tsc --noEmit -p .`
Expected: 테스트 PASS, tsc 출력 없음

- [ ] **Step 10: CLI 동작 확인**

Run: `pnpm run build && cd /tmp && node <저장소 경로>/dist/cli.mjs --help | head -3`
Expected: `diffx - Local code review tool for git diffs` 출력

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test/gitRepo.ts src/git.test.ts src/git.ts src/server.ts src/cli.ts
git commit -m "refactor: git 함수와 서버가 저장소 경로를 인자로 받도록 변경"
```

---

### Task 2: 브랜치 조회용 git 함수

**Files:**
- Modify: `src/git.ts` (파일 끝에 추가)
- Test: `src/git.test.ts`

**Interfaces:**
- Consumes: Task 1의 `run`, `runBuffer`(모듈 내부), `DIFF_FLAGS`, 테스트 헬퍼
- Produces:
  ```ts
  export interface BranchList { local: string[]; remote: string[]; current: string; defaultTarget: string | null }
  export function listBranches(repo: string): BranchList
  export function resolveCommit(repo: string, ref: string): string | null
  export function getMergeBase(repo: string, a: string, b: string): string | null
  export function getRangeDiff(repo: string, fromSha: string, toSha: string): string
  export function getFileAtCommit(repo: string, sha: string, filePath: string): Buffer | null
  export function getHeadSha(repo: string): string | null
  export function fetchAll(repo: string, timeoutMs?: number): Promise<{ ok: true } | { ok: false; error: string }>
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/git.test.ts` 끝에 추가:
```ts
import { listBranches, resolveCommit, getMergeBase, getRangeDiff, getFileAtCommit, fetchAll, getHeadSha } from './git'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

function repoWithBranches() {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n' }, 'base')
  git(repo, 'update-ref', 'refs/remotes/origin/main', base)
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  const feature = commit(repo, { 'a.txt': 'base\nfeature\n', 'img.png': 'PNGDATA' }, 'feature')
  git(repo, 'update-ref', 'refs/remotes/origin/feature/x', feature)
  return { repo, base, feature }
}

describe('listBranches', () => {
  it('lists local and remote branches without symbolic refs and finds the default target', () => {
    const { repo } = repoWithBranches()
    const list = listBranches(repo)
    expect(list.local).toEqual(['feature/x', 'main'])
    expect(list.remote).toEqual(['origin/feature/x', 'origin/main'])
    expect(list.current).toBe('feature/x')
    expect(list.defaultTarget).toBe('origin/main')
  })

  it('falls back to main when origin/HEAD is missing', () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'x\n' }, 'init')
    expect(listBranches(repo).defaultTarget).toBe('main')
  })
})

describe('resolveCommit', () => {
  it('resolves branch names to commit shas', () => {
    const { repo, feature } = repoWithBranches()
    expect(resolveCommit(repo, 'origin/feature/x')).toBe(feature)
  })

  it('rejects unknown refs and option-looking input', () => {
    const { repo } = repoWithBranches()
    expect(resolveCommit(repo, 'nope')).toBeNull()
    expect(resolveCommit(repo, '--output=/tmp/pwned')).toBeNull()
    expect(resolveCommit(repo, '')).toBeNull()
  })
})

describe('getMergeBase and getRangeDiff', () => {
  it('produces the same diff as target...source', () => {
    const { repo, base, feature } = repoWithBranches()
    const mb = getMergeBase(repo, base, feature)
    expect(mb).toBe(base)
    const diff = getRangeDiff(repo, mb!, feature)
    expect(diff).toContain('+feature')
    expect(diff).toBe(git(repo, 'diff', '--no-ext-diff', '--no-color', 'main...feature/x'))
  })

  it('returns null when histories are unrelated', () => {
    const { repo, feature } = repoWithBranches()
    git(repo, 'switch', '-q', '--orphan', 'orphan')
    const orphan = commit(repo, { 'b.txt': 'b\n' }, 'orphan')
    expect(getMergeBase(repo, orphan, feature)).toBeNull()
  })
})

describe('getFileAtCommit', () => {
  it('reads a file at a commit and refuses unsafe paths', () => {
    const { repo, feature } = repoWithBranches()
    expect(getFileAtCommit(repo, feature, 'img.png')?.toString()).toBe('PNGDATA')
    expect(getFileAtCommit(repo, feature, '../etc/passwd')).toBeNull()
    expect(getFileAtCommit(repo, feature, 'missing.txt')).toBeNull()
  })
})

describe('getHeadSha', () => {
  it('returns the checked out commit', () => {
    const { repo, feature } = repoWithBranches()
    expect(getHeadSha(repo)).toBe(feature)
  })
})

describe('fetchAll', () => {
  it('fetches from a local bare remote and prunes deleted branches', async () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-remote-')))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'a\n' }, 'init')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main', 'main:gone')
    git(repo, 'fetch', '-q', 'origin')
    git(remote, 'branch', '-D', 'gone')

    const result = await fetchAll(repo)
    expect(result).toEqual({ ok: true })
    expect(listBranches(repo).remote).toEqual(['origin/main'])
  })

  it('reports git errors without throwing', async () => {
    const repo = makeRepo()
    commit(repo, { 'a.txt': 'a\n' }, 'init')
    git(repo, 'remote', 'add', 'origin', '/nonexistent/diffx-remote')
    const result = await fetchAll(repo)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/nonexistent/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/git.test.ts`
Expected: FAIL, `listBranches is not a function` 등

- [ ] **Step 3: 구현**

`src/git.ts`의 import에 `import { execFile } from 'node:child_process'`를 추가하고(기존 `execFileSync` import 줄에 합친다) 파일 끝에 추가:

```ts
export interface BranchList {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

export function listBranches(repo: string): BranchList {
  const output = run(repo, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'])
  const local: string[] = []
  const remote: string[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const [ref, symref] = line.split('\0')
    if (symref) continue
    if (ref.startsWith('refs/heads/')) local.push(ref.slice('refs/heads/'.length))
    else if (ref.startsWith('refs/remotes/')) remote.push(ref.slice('refs/remotes/'.length))
  }
  local.sort()
  remote.sort()
  return { local, remote, current: getBranchName(repo), defaultTarget: findDefaultTarget(repo, local, remote) }
}

function findDefaultTarget(repo: string, local: string[], remote: string[]): string | null {
  try {
    const head = run(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).trim()
    if (head) return head
  } catch {
    // origin/HEAD is not set
  }
  const all = new Set([...local, ...remote])
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (all.has(candidate)) return candidate
  }
  return null
}

export function resolveCommit(repo: string, ref: string): string | null {
  if (!ref || ref.startsWith('-')) return null
  try {
    return run(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null
  } catch {
    return null
  }
}

export function getMergeBase(repo: string, a: string, b: string): string | null {
  try {
    return run(repo, ['merge-base', a, b]).trim() || null
  } catch {
    return null
  }
}

export function getRangeDiff(repo: string, fromSha: string, toSha: string): string {
  return run(repo, ['diff', ...DIFF_FLAGS, fromSha, toSha])
}

export function getFileAtCommit(repo: string, sha: string, filePath: string): Buffer | null {
  if (!isSafePath(filePath, repo)) return null
  try {
    return runBuffer(repo, ['show', `${sha}:${filePath}`])
  } catch {
    return null
  }
}

export function getHeadSha(repo: string): string | null {
  return resolveCommit(repo, 'HEAD')
}

export function fetchAll(repo: string, timeoutMs = 60_000): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((done) => {
    execFile(
      'git',
      ['fetch', '--all', '--prune'],
      { cwd: repo, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, _stdout, stderr) => {
        if (!err) return done({ ok: true })
        const message = stderr?.toString().trim() || err.message
        done({ ok: false, error: err.killed ? `git fetch가 ${timeoutMs / 1000}초 안에 끝나지 않았습니다` : message })
      },
    )
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/git.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git.ts src/git.test.ts
git commit -m "feat: 브랜치 목록, merge-base, 범위 diff, fetch git 함수 추가"
```

---

### Task 3: 비교 조합 해석 모듈과 서버 diff API

**Files:**
- Create: `src/comparison.ts`, `src/comparison.test.ts`, `src/server.test.ts`
- Modify: `src/server.ts` (`/api/diff`, `/api/file-content`, `/api/file-versions`, `/api/repo`, `/api/branches`, `/api/fetch`)

**Interfaces:**
- Consumes: Task 2 함수들
- Produces:
  ```ts
  // src/comparison.ts
  export interface ComparisonQuery {
    mode?: string          // 'worktree' | 'branch'
    source?: string
    target?: string
    staged?: boolean
    untracked?: boolean
  }
  export interface ResolvedComparison {
    key: string
    mode: 'worktree' | 'branch' | 'custom'
    patch: string
    source?: string
    target?: string
    sourceSha?: string
    targetSha?: string
    mergeBase?: string
  }
  export class ComparisonError extends Error {
    constructor(public code: 'unknown_ref' | 'no_merge_base' | 'missing_ref', message: string)
  }
  export function comparisonKey(q: { mode: 'worktree' | 'branch' | 'custom'; source?: string; target?: string; customArgs?: string[] }): string
  export function queryFromSearch(get: (name: string) => string | undefined): ComparisonQuery
  export function resolveComparison(repo: string, customDiffArgs: string[] | undefined, q: ComparisonQuery): ResolvedComparison
  ```
  - `/api/diff` 응답에 추가되는 필드: `key`, `mode`, `sourceSha`, `targetSha`, `mergeBase`, `identical`
  - 에러 응답 형식: `{ error: 'unknown_ref' | 'no_merge_base' | 'missing_ref', message: string }`, 상태 400(unknown_ref, missing_ref) 또는 422(no_merge_base)
  - `GET /api/repo` → `{ root: string, name: string, customMode: boolean }`
  - `GET /api/branches` → `BranchList`
  - `POST /api/fetch` → `{ ok: true }` 또는 500 `{ ok: false, error: string }`

- [ ] **Step 1: 실패하는 테스트 작성 (comparison)**

`src/comparison.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { resolveComparison, comparisonKey, ComparisonError } from './comparison'

function setup() {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n' }, 'base')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  const feature = commit(repo, { 'a.txt': 'base\nfeature\n' }, 'feature')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'dirty\n')
  return { repo, base, feature }
}

describe('comparisonKey', () => {
  it('builds keys per mode', () => {
    expect(comparisonKey({ mode: 'worktree' })).toBe('worktree')
    expect(comparisonKey({ mode: 'branch', source: 'feature/x', target: 'origin/main' })).toBe('branch:origin/main...feature/x')
    expect(comparisonKey({ mode: 'custom', customArgs: ['HEAD~3'] })).toBe('custom:HEAD~3')
  })
})

describe('resolveComparison', () => {
  it('worktree mode returns uncommitted changes', () => {
    const { repo } = setup()
    const r = resolveComparison(repo, undefined, { mode: 'worktree' })
    expect(r.key).toBe('worktree')
    expect(r.patch).toContain('+dirty')
  })

  it('branch mode ignores the worktree and diffs merge-base..source', () => {
    const { repo, base, feature } = setup()
    const r = resolveComparison(repo, undefined, { mode: 'branch', source: 'feature/x', target: 'main' })
    expect(r.key).toBe('branch:main...feature/x')
    expect(r.patch).toContain('+feature')
    expect(r.patch).not.toContain('dirty')
    expect(r).toMatchObject({ sourceSha: feature, targetSha: base, mergeBase: base })
  })

  it('custom args override the query', () => {
    const { repo } = setup()
    const r = resolveComparison(repo, ['main', 'feature/x'], { mode: 'branch', source: 'x', target: 'y' })
    expect(r.mode).toBe('custom')
    expect(r.key).toBe('custom:main feature/x')
    expect(r.patch).toContain('+feature')
  })

  it('throws ComparisonError for unknown or missing refs', () => {
    const { repo } = setup()
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', source: 'nope', target: 'main' }))
      .toThrowError(expect.objectContaining({ code: 'unknown_ref' }))
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', target: 'main' }))
      .toThrowError(expect.objectContaining({ code: 'missing_ref' }))
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', source: '--output=/tmp/x', target: 'main' }))
      .toThrow(ComparisonError)
  })

  it('throws no_merge_base for unrelated histories', () => {
    const { repo } = setup()
    git(repo, 'stash', '-q')
    git(repo, 'switch', '-q', '--orphan', 'orphan')
    commit(repo, { 'b.txt': 'b\n' }, 'orphan')
    expect(() => resolveComparison(repo, undefined, { mode: 'branch', source: 'orphan', target: 'main' }))
      .toThrowError(expect.objectContaining({ code: 'no_merge_base' }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/comparison.test.ts`
Expected: FAIL, 모듈 없음

- [ ] **Step 3: `src/comparison.ts` 구현**

```ts
import { getCustomGitDiff, getGitDiff, getMergeBase, getRangeDiff, resolveCommit } from './git.js'

export interface ComparisonQuery {
  mode?: string
  source?: string
  target?: string
  staged?: boolean
  untracked?: boolean
}

export interface ResolvedComparison {
  key: string
  mode: 'worktree' | 'branch' | 'custom'
  patch: string
  source?: string
  target?: string
  sourceSha?: string
  targetSha?: string
  mergeBase?: string
}

export class ComparisonError extends Error {
  constructor(public code: 'unknown_ref' | 'no_merge_base' | 'missing_ref', message: string) {
    super(message)
  }
}

export function comparisonKey(q: { mode: 'worktree' | 'branch' | 'custom'; source?: string; target?: string; customArgs?: string[] }): string {
  if (q.mode === 'custom') return `custom:${(q.customArgs ?? []).join(' ')}`
  if (q.mode === 'branch') return `branch:${q.target}...${q.source}`
  return 'worktree'
}

export function queryFromSearch(get: (name: string) => string | undefined): ComparisonQuery {
  return {
    mode: get('mode'),
    source: get('source'),
    target: get('target'),
    staged: get('staged') === 'true',
    untracked: get('untracked') === 'true',
  }
}

export function resolveComparison(repo: string, customDiffArgs: string[] | undefined, q: ComparisonQuery): ResolvedComparison {
  if (customDiffArgs) {
    return {
      key: comparisonKey({ mode: 'custom', customArgs: customDiffArgs }),
      mode: 'custom',
      patch: getCustomGitDiff(repo, customDiffArgs),
    }
  }

  if (q.mode !== 'branch') {
    return {
      key: comparisonKey({ mode: 'worktree' }),
      mode: 'worktree',
      patch: getGitDiff(repo, { staged: q.staged, untracked: q.untracked }),
    }
  }

  if (!q.source || !q.target) {
    throw new ComparisonError('missing_ref', '소스 브랜치와 타겟 브랜치를 모두 선택해 주세요')
  }
  const sourceSha = resolveCommit(repo, q.source)
  if (!sourceSha) throw new ComparisonError('unknown_ref', `브랜치 ${q.source}을 찾지 못했습니다`)
  const targetSha = resolveCommit(repo, q.target)
  if (!targetSha) throw new ComparisonError('unknown_ref', `브랜치 ${q.target}을 찾지 못했습니다`)
  const mergeBase = getMergeBase(repo, targetSha, sourceSha)
  if (!mergeBase) throw new ComparisonError('no_merge_base', '두 브랜치의 공통 조상 커밋이 없습니다')

  return {
    key: comparisonKey({ mode: 'branch', source: q.source, target: q.target }),
    mode: 'branch',
    patch: getRangeDiff(repo, mergeBase, sourceSha),
    source: q.source,
    target: q.target,
    sourceSha,
    targetSha,
    mergeBase,
  }
}
```

- [ ] **Step 4: comparison 테스트 통과 확인**

Run: `pnpm test src/comparison.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 서버 테스트 작성**

`src/server.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { createApp } from './server'

function clientDir() {
  const dir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  return dir
}

export function setupApp(customDiffArgs?: string[]) {
  const repo = makeRepo()
  const base = commit(repo, { 'a.txt': 'base\n', 'img.png': 'OLDPNG' }, 'base')
  git(repo, 'update-ref', 'refs/remotes/origin/main', base)
  git(repo, 'switch', '-q', '-c', 'feature/x')
  const feature = commit(repo, { 'a.txt': 'base\nfeature\n', 'img.png': 'NEWPNG' }, 'feature')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'img.png'), 'WORKTREEPNG')
  const app = createApp({ repoPath: repo, clientDir: clientDir(), customDiffArgs })
  return { app, repo, base, feature }
}

describe('GET /api/repo and /api/branches', () => {
  it('returns repo info and branch lists', async () => {
    const { app, repo } = setupApp()
    const info = await (await app.request('/api/repo')).json()
    expect(info).toEqual({ root: repo, name: repo.split('/').pop(), customMode: false })
    const branches = await (await app.request('/api/branches')).json()
    expect(branches.local).toEqual(['feature/x', 'main'])
    expect(branches.remote).toEqual(['origin/main'])
    expect(branches.defaultTarget).toBe('origin/main')
  })
})

describe('GET /api/diff', () => {
  it('branch mode returns the range diff with shas', async () => {
    const { app, base, feature } = setupApp()
    const res = await app.request('/api/diff?mode=branch&source=feature/x&target=origin/main')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patch).toContain('+feature')
    expect(body).toMatchObject({ key: 'branch:origin/main...feature/x', mode: 'branch', sourceSha: feature, targetSha: base, mergeBase: base, identical: false })
  })

  it('reports identical branches', async () => {
    const { app } = setupApp()
    const body = await (await app.request('/api/diff?mode=branch&source=main&target=origin/main')).json()
    expect(body.identical).toBe(true)
    expect(body.patch).toBe('')
  })

  it('returns 400 for unknown refs and 422 without merge base', async () => {
    const { app, repo } = setupApp()
    const bad = await app.request('/api/diff?mode=branch&source=nope&target=main')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'unknown_ref' })

    git(repo, 'stash', '-q', '-u')
    git(repo, 'switch', '-q', '--orphan', 'orphan')
    commit(repo, { 'z.txt': 'z\n' }, 'orphan')
    const unrelated = await app.request('/api/diff?mode=branch&source=orphan&target=main')
    expect(unrelated.status).toBe(422)
    expect(await unrelated.json()).toMatchObject({ error: 'no_merge_base', message: '두 브랜치의 공통 조상 커밋이 없습니다' })
  })
})

describe('GET /api/file-content in branch mode', () => {
  it('reads old from merge-base and new from source, not the worktree', async () => {
    const { app } = setupApp()
    const q = 'mode=branch&source=feature/x&target=origin/main&path=img.png'
    expect(await (await app.request(`/api/file-content?${q}&version=old`)).text()).toBe('OLDPNG')
    expect(await (await app.request(`/api/file-content?${q}&version=new`)).text()).toBe('NEWPNG')
  })

  it('worktree mode keeps reading the worktree for the new version', async () => {
    const { app } = setupApp()
    expect(await (await app.request('/api/file-content?path=img.png&version=new')).text()).toBe('WORKTREEPNG')
  })
})

describe('GET /api/file-versions in branch mode', () => {
  it('serves full contents for oids in the branch diff', async () => {
    const { app } = setupApp()
    const diff = await (await app.request('/api/diff?mode=branch&source=feature/x&target=origin/main')).json()
    const chunk = diff.patch.split(/^(?=diff --git )/m).find((c: string) => c.includes('+++ b/a.txt'))
    const [, oldOid, newOid] = chunk.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
    const res = await app.request(`/api/file-versions?mode=branch&source=feature/x&target=origin/main&path=a.txt&oldOid=${oldOid}&newOid=${newOid}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ old: 'base\n', new: 'base\nfeature\n' })
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm test src/server.test.ts`
Expected: FAIL (`/api/repo` 404 등)

- [ ] **Step 7: 서버 구현**

`src/server.ts`:

1. import 변경
```ts
import { getRepoName, getBranchName, getFileContent, getBlobContent, getWorktreeFileContent, getTabSizeForFiles, getUntrackedFilePaths, listBranches, fetchAll, getFileAtCommit } from './git.js'
import { resolveComparison, queryFromSearch, ComparisonError, type ResolvedComparison } from './comparison.js'
import type { Context } from 'hono'
```
(`getGitDiff`, `getCustomGitDiff`, `isImageFile` import는 더 이상 쓰지 않으면 제거한다.)

2. `createApp` 안, `const viewedFiles = ...` 아래에 헬퍼 추가
```ts
  const resolveFromRequest = (c: Context): ResolvedComparison => {
    const q = queryFromSearch((name) => c.req.query(name))
    return resolveComparison(repo, customDiffArgs, q)
  }

  const comparisonErrorResponse = (c: Context, err: unknown) => {
    if (err instanceof ComparisonError) {
      return c.json({ error: err.code, message: err.message }, err.code === 'no_merge_base' ? 422 : 400)
    }
    throw err
  }
```

3. `/api/diff` 교체
```ts
  app.get('/api/diff', (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = resolveFromRequest(c)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const { patch } = resolved
    const untracked = resolved.mode === 'worktree' && c.req.query('untracked') === 'true'
    const untrackedFiles = untracked ? getUntrackedFilePaths(repo) : []
    const binaryFiles = parseBinaryFiles(patch, new Set(untrackedFiles))
    const tabSizeMap = getTabSizeForFiles(repo, parseFilePaths(patch))
    return c.json({
      patch,
      repoName: getRepoName(repo),
      branch: getBranchName(repo),
      customMode: isCustomMode,
      binaryFiles,
      tabSizeMap,
      untrackedFiles,
      key: resolved.key,
      mode: resolved.mode,
      sourceSha: resolved.sourceSha,
      targetSha: resolved.targetSha,
      mergeBase: resolved.mergeBase,
      identical: resolved.mode === 'branch' && resolved.sourceSha === resolved.targetSha,
    })
  })
```

4. `/api/file-content` 교체
```ts
  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    let content: Buffer | null
    if (c.req.query('mode') === 'branch' && !isCustomMode) {
      let resolved: ResolvedComparison
      try {
        resolved = resolveFromRequest(c)
      } catch (err) {
        return comparisonErrorResponse(c, err)
      }
      content = getFileAtCommit(repo, version === 'old' ? resolved.mergeBase! : resolved.sourceSha!, path)
    } else {
      content = getFileContent(repo, path, version)
    }
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })
```

5. `/api/file-versions`에서 patch 계산 두 줄(`const staged = ...`, `const untracked = ...`, `const patch = ...`)을 아래로 바꾼다. 기존 주석 블록은 유지한다.
```ts
    let patch: string
    try {
      patch = resolveFromRequest(c).patch
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
```
같은 핸들러의 `getBlobContent(oldOid)` 등은 Task 1에서 `repo` 인자를 넣었는지 확인한다.

6. 새 엔드포인트 추가 (`/api/settings` 위)
```ts
  app.get('/api/repo', (c) => {
    return c.json({ root: repo, name: getRepoName(repo), customMode: isCustomMode })
  })

  app.get('/api/branches', (c) => {
    return c.json(listBranches(repo))
  })

  app.post('/api/fetch', async (c) => {
    const result = await fetchAll(repo)
    return c.json(result, result.ok ? 200 : 500)
  })
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모든 테스트 PASS, tsc 출력 없음

- [ ] **Step 9: Commit**

```bash
git add src/comparison.ts src/comparison.test.ts src/server.ts src/server.test.ts
git commit -m "feat: 브랜치 비교 diff와 브랜치 목록, fetch API 추가"
```

---

### Task 4: 코멘트와 viewed 상태를 비교 조합 키별로 분리

**Files:**
- Modify: `src/types.ts`, `src/comments.ts`, `src/server.ts` (`/api/diff`, `/api/comments*`, `/api/viewed`)
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: Task 3 `resolved.key`
- Produces:
  - `ReviewComment.key: string`
  - `CommentStore.getAll(key?: string): Promise<ReviewComment[]>` (key 없으면 전체)
  - `GET /api/comments?key=` (없으면 active key), `POST /api/comments` 본문 `key?`
  - `GET /api/viewed?key=`, `PUT /api/viewed` 본문 `key?`
  - active key: 마지막으로 성공한 `/api/diff` 응답의 `key`. 초기값은 custom 모드면 custom 키, 아니면 `'worktree'`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server.test.ts` 끝에 추가:
```ts
describe('comments and viewed are scoped by comparison key', () => {
  it('separates comments per key and defaults to the last diffed key', async () => {
    const { app } = setupApp()
    const post = (body: object) => app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'a.txt', side: 'additions', lineNumber: 1, lineContent: 'x', body: 'c', ...body }),
    })
    await post({ key: 'worktree', body: 'on worktree' })
    await post({ key: 'branch:origin/main...feature/x', body: 'on branch' })

    const wt = await (await app.request('/api/comments?key=worktree')).json()
    expect(wt.map((c: { body: string }) => c.body)).toEqual(['on worktree'])

    // key 없는 요청은 마지막 /api/diff 조합을 따른다 (skills/diffx-finish-review 호환)
    await app.request('/api/diff?mode=branch&source=feature/x&target=origin/main')
    const active = await (await app.request('/api/comments')).json()
    expect(active.map((c: { body: string }) => c.body)).toEqual(['on branch'])

    // key 없는 POST도 active key로 저장된다
    await post({ body: 'no key' })
    const branch = await (await app.request('/api/comments?key=branch:origin/main...feature/x')).json()
    expect(branch.map((c: { body: string }) => c.body)).toEqual(['on branch', 'no key'])
  })

  it('separates viewed state per key', async () => {
    const { app } = setupApp()
    await app.request('/api/viewed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'worktree', filePath: 'a.txt', viewed: true, contentHash: 'abc' }),
    })
    expect(await (await app.request('/api/viewed?key=worktree')).json()).toEqual({ 'a.txt': 'abc' })
    expect(await (await app.request('/api/viewed?key=branch:origin/main...feature/x')).json()).toEqual({})
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/server.test.ts`
Expected: FAIL (key 필터링 없음)

- [ ] **Step 3: 타입과 저장소 변경**

`src/types.ts`의 `ReviewComment`에 `key: string`을 `id` 다음 줄에 추가한다.

`src/comments.ts`:
```ts
export interface CommentStore {
  getAll(key?: string): Promise<ReviewComment[]>
  ...나머지 동일
}

export class InMemoryCommentStore implements CommentStore {
  private comments: ReviewComment[] = []

  async getAll(key?: string): Promise<ReviewComment[]> {
    return key === undefined ? this.comments : this.comments.filter((c) => c.key === key)
  }
  ...나머지 동일
}
```

- [ ] **Step 4: 서버 변경**

`src/server.ts`의 `createApp`에서:

1. `const viewedFiles = new Map<string, string>()`를 아래로 바꾼다.
```ts
  const viewedByKey = new Map<string, Map<string, string>>()
  let activeKey = isCustomMode ? comparisonKey({ mode: 'custom', customArgs: customDiffArgs }) : 'worktree'
  const keyFrom = (value: string | undefined) => value || activeKey
  const viewedFor = (key: string) => {
    let map = viewedByKey.get(key)
    if (!map) {
      map = new Map()
      viewedByKey.set(key, map)
    }
    return map
  }
```
`comparisonKey`를 `./comparison.js` import에 추가한다.

2. `/api/diff` 핸들러에서 `resolved`를 얻은 직후 `activeKey = resolved.key`를 넣는다.

3. viewed 핸들러 교체
```ts
  app.get('/api/viewed', (c) => {
    return c.json(Object.fromEntries(viewedFor(keyFrom(c.req.query('key')))))
  })

  app.put('/api/viewed', async (c) => {
    const { key, filePath, viewed, contentHash } = await c.req.json<{ key?: string; filePath: string; viewed: boolean; contentHash?: string }>()
    const map = viewedFor(keyFrom(key))
    if (viewed) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) {
        return c.json({ error: 'non-empty contentHash required when marking viewed' }, 400)
      }
      map.set(filePath, contentHash)
    } else {
      map.delete(filePath)
    }
    return c.json({ ok: true })
  })
```

4. 코멘트 핸들러 변경
```ts
  app.get('/api/comments', async (c) => {
    const comments = await store.getAll(keyFrom(c.req.query('key')))
    return c.json(comments)
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const comment = {
      id: crypto.randomUUID(),
      key: keyFrom(body.key),
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: PASS, tsc 오류 없음. (UI 쪽 `ReviewComment` 사용처에서 `key` 누락 오류가 나면 Task 5에서 처리하지 말고 여기서 타입 오류 위치만 확인한다. UI는 서버 응답을 그대로 쓰므로 새 필드를 만들지 않아 오류가 나지 않아야 한다.)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/comments.ts src/server.ts src/server.test.ts
git commit -m "feat: 코멘트와 viewed 상태를 비교 조합별로 분리"
```

---

### Task 5: UI 비교 조합 상태와 데이터 훅

**Files:**
- Create: `src/ui/comparison.ts`, `src/ui/comparison.test.ts`, `src/ui/hooks/useRepo.ts`, `src/ui/hooks/useBranches.ts`
- Modify: `src/ui/hooks/useDiff.ts`, `src/ui/hooks/useComments.ts`, `src/ui/hooks/useViewed.ts`, `src/ui/hooks/useFullDiffs.ts`

**Interfaces:**
- Consumes: Task 3, 4 API
- Produces:
  ```ts
  // src/ui/comparison.ts
  export type Comparison = { mode: 'worktree' } | { mode: 'branch'; source: string; target: string }
  export function comparisonParams(c: Comparison, opts: { staged: boolean; untracked: boolean }): URLSearchParams
  export function loadComparison(repoRoot: string, storage?: Pick<Storage, 'getItem'>): Comparison | null
  export function saveComparison(repoRoot: string, c: Comparison, storage?: Pick<Storage, 'setItem'>): void
  export function reconcileComparison(saved: Comparison | null, branches: { local: string[]; remote: string[]; current: string; defaultTarget: string | null }): { comparison: Comparison; missing: string[] }

  // hooks
  export function useRepo(): { repo: { root: string; name: string; customMode: boolean } | null; error: string | null }
  export function useBranches(enabled: boolean): { branches: BranchList | undefined; refetch: () => void; fetchRemote: () => Promise<void>; fetching: boolean; fetchError: string | null }
  export function useDiff(params: URLSearchParams | null): { ...기존 필드, key, mode, identical, errorCode: string | null }
  export function useComments(key: string | null)
  export function useViewed(files: FileDiffMetadata[], key: string | null)
  export function useFullDiffs(patch: string | null, files: FileDiffMetadata[], params: URLSearchParams | null)
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/ui/comparison.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { comparisonParams, loadComparison, saveComparison, reconcileComparison } from './comparison'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

const branches = { local: ['feature/x', 'main'], remote: ['origin/main'], current: 'feature/x', defaultTarget: 'origin/main' }

describe('comparisonParams', () => {
  it('builds worktree and branch params', () => {
    expect(comparisonParams({ mode: 'worktree' }, { staged: true, untracked: false }).toString())
      .toBe('mode=worktree&staged=true&untracked=false')
    expect(comparisonParams({ mode: 'branch', source: 'feature/x', target: 'origin/main' }, { staged: true, untracked: true }).toString())
      .toBe('mode=branch&source=feature%2Fx&target=origin%2Fmain')
  })
})

describe('load/saveComparison', () => {
  it('stores per repo root', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'branch', source: 'x', target: 'y' }, s)
    expect(loadComparison('/repo/a', s)).toEqual({ mode: 'branch', source: 'x', target: 'y' })
    expect(loadComparison('/repo/b', s)).toBeNull()
  })

  it('ignores broken values', () => {
    const s = memoryStorage()
    s.setItem('diffx-comparison:/repo/a', '{bad json')
    expect(loadComparison('/repo/a', s)).toBeNull()
  })
})

describe('reconcileComparison', () => {
  it('defaults to worktree when nothing is saved', () => {
    expect(reconcileComparison(null, branches)).toEqual({ comparison: { mode: 'worktree' }, missing: [] })
  })

  it('keeps saved branches that still exist', () => {
    const saved = { mode: 'branch' as const, source: 'main', target: 'origin/main' }
    expect(reconcileComparison(saved, branches)).toEqual({ comparison: saved, missing: [] })
  })

  it('replaces missing branches with defaults and reports them', () => {
    const saved = { mode: 'branch' as const, source: 'deleted', target: 'origin/gone' }
    expect(reconcileComparison(saved, branches)).toEqual({
      comparison: { mode: 'branch', source: 'feature/x', target: 'origin/main' },
      missing: ['deleted', 'origin/gone'],
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/ui/comparison.test.ts`
Expected: FAIL, 모듈 없음

- [ ] **Step 3: `src/ui/comparison.ts` 구현**

```ts
export type Comparison = { mode: 'worktree' } | { mode: 'branch'; source: string; target: string }

interface BranchInfo {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

const STORAGE_PREFIX = 'diffx-comparison:'

export function comparisonParams(c: Comparison, opts: { staged: boolean; untracked: boolean }): URLSearchParams {
  if (c.mode === 'branch') {
    return new URLSearchParams({ mode: 'branch', source: c.source, target: c.target })
  }
  return new URLSearchParams({ mode: 'worktree', staged: String(opts.staged), untracked: String(opts.untracked) })
}

export function loadComparison(repoRoot: string, storage: Pick<Storage, 'getItem'> = localStorage): Comparison | null {
  try {
    const raw = storage.getItem(STORAGE_PREFIX + repoRoot)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.mode === 'worktree') return { mode: 'worktree' }
    if (parsed?.mode === 'branch' && typeof parsed.source === 'string' && typeof parsed.target === 'string') {
      return { mode: 'branch', source: parsed.source, target: parsed.target }
    }
  } catch {}
  return null
}

export function saveComparison(repoRoot: string, c: Comparison, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify(c))
  } catch {}
}

export function defaultBranchComparison(branches: BranchInfo): Comparison {
  const source = branches.current && branches.current !== 'HEAD' ? branches.current : branches.local[0] ?? ''
  const target = branches.defaultTarget ?? branches.local.find((b) => b !== source) ?? source
  return { mode: 'branch', source, target }
}

export function reconcileComparison(saved: Comparison | null, branches: BranchInfo): { comparison: Comparison; missing: string[] } {
  if (!saved || saved.mode === 'worktree') return { comparison: { mode: 'worktree' }, missing: [] }
  const all = new Set([...branches.local, ...branches.remote])
  const missing = [saved.source, saved.target].filter((b) => !all.has(b))
  if (missing.length === 0) return { comparison: saved, missing }
  const fallback = defaultBranchComparison(branches) as { mode: 'branch'; source: string; target: string }
  return {
    comparison: {
      mode: 'branch',
      source: all.has(saved.source) ? saved.source : fallback.source,
      target: all.has(saved.target) ? saved.target : fallback.target,
    },
    missing,
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/ui/comparison.test.ts`
Expected: PASS

- [ ] **Step 5: 훅 작성과 수정**

`src/ui/hooks/useRepo.ts`:
```ts
import { useEffect, useState } from 'react'

export interface RepoInfo {
  root: string
  name: string
  customMode: boolean
}

export function useRepo() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/repo')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(setRepo)
      .catch((err) => setError(err.message))
  }, [])

  return { repo, error }
}
```

`src/ui/hooks/useBranches.ts`:
```ts
import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export interface BranchList {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

const BRANCHES_KEY = ['branches']

export function useBranches(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data: branches, refetch } = useQuery({
    queryKey: BRANCHES_KEY,
    queryFn: async (): Promise<BranchList> => {
      const res = await fetch('/api/branches')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled,
  })
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchRemote = useCallback(async () => {
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/fetch', { method: 'POST' })
      const body = await res.json()
      if (!body.ok) setFetchError(body.error)
      await queryClient.invalidateQueries({ queryKey: BRANCHES_KEY })
    } catch (err) {
      setFetchError((err as Error).message)
    } finally {
      setFetching(false)
    }
  }, [queryClient])

  return { branches, refetch, fetchRemote, fetching, fetchError }
}
```

`src/ui/hooks/useDiff.ts` 전체 교체:
```ts
import { useState, useEffect } from 'react'

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

interface DiffData {
  patch: string
  repoName: string
  branch: string
  customMode: boolean
  binaryFiles: BinaryFileInfo[]
  tabSizeMap: Record<string, number>
  untrackedFiles: string[]
  key: string
  mode: 'worktree' | 'branch' | 'custom'
  sourceSha?: string
  targetSha?: string
  mergeBase?: string
  identical: boolean
}

export interface DiffOptions {
  staged: boolean
  untracked: boolean
}

export function useDiff(params: URLSearchParams | null, reloadToken = 0) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const query = params?.toString() ?? null

  useEffect(() => {
    if (query === null) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setErrorCode(null)

    fetch(`/api/diff?${query}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          const err = new Error(body?.message ?? `HTTP ${res.status}`) as Error & { code?: string }
          err.code = body?.error
          throw err
        }
        return body as DiffData
      })
      .then((json) => { if (!cancelled) setData(json) })
      .catch((err) => {
        if (cancelled) return
        setData(null)
        setError(err.message)
        setErrorCode(err.code ?? null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query, reloadToken])

  return {
    patch: data?.patch ?? null,
    repoName: data?.repoName ?? '',
    branch: data?.branch ?? '',
    customMode: data?.customMode ?? false,
    binaryFiles: data?.binaryFiles ?? [],
    tabSizeMap: data?.tabSizeMap ?? {},
    untrackedFiles: data?.untrackedFiles ?? [],
    key: data?.key ?? null,
    mode: data?.mode ?? null,
    sourceSha: data?.sourceSha,
    targetSha: data?.targetSha,
    identical: data?.identical ?? false,
    loading,
    error,
    errorCode,
  }
}
```

`src/ui/hooks/useComments.ts`:
- `export function useComments() {`를 `export function useComments(key: string | null) {`로 바꾼다.
- `const COMMENTS_KEY = ['comments']` 상수를 지우고 함수 안에서 `const COMMENTS_KEY = ['comments', key]`로 선언한다.
- `fetchComments`를 `async function fetchComments(key: string): Promise<ReviewComment[]> { const res = await fetch(`/api/comments?key=${encodeURIComponent(key)}`); return res.json() }`로 바꾼다.
- `useQuery({ queryKey: COMMENTS_KEY, queryFn: () => fetchComments(key!), enabled: key !== null, refetchInterval: 3000 })`
- `addMutation`의 `body: JSON.stringify(params)`를 `body: JSON.stringify({ ...params, key })`로 바꾼다.

`src/ui/hooks/useViewed.ts`:
- 시그니처 `export function useViewed(files: FileDiffMetadata[], key: string | null)`
- `VIEWED_KEY` 상수를 지우고 함수 안에서 `const VIEWED_KEY = ['viewed', key]`
- `fetchViewed(key: string)`가 `/api/viewed?key=${encodeURIComponent(key)}`를 부른다. `useQuery({ queryKey: VIEWED_KEY, queryFn: () => fetchViewed(key!), enabled: key !== null })`
- PUT 본문에 `key`를 넣는다: `JSON.stringify({ key, filePath, viewed, contentHash: viewed ? contentHash : undefined })`
- `useCallback` 의존성 배열에 `key`를 추가한다.

`src/ui/hooks/useFullDiffs.ts`:
- 시그니처를 `export function useFullDiffs(patch: string | null, files: FileDiffMetadata[], params: URLSearchParams | null)`로 바꾼다.
- `const paramString = params?.toString() ?? ''`를 함수 첫 줄에 둔다.
- 요청 파라미터 생성부를 아래로 바꾼다.
```ts
      const query = new URLSearchParams(paramString)
      query.set('path', file.name)
      query.set('oldOid', prevOid)
      query.set('newOid', file.newObjectId ?? '')
      fetch(`/api/file-versions?${query}`)
```
- effect 의존성 배열을 `[patch, files, paramString]`으로 바꾼다.

- [ ] **Step 6: 타입 검사**

Run: `pnpm exec tsc --noEmit -p .`
Expected: `App.tsx`에서 `useDiff`, `useComments`, `useViewed`, `useFullDiffs` 호출 인자 오류만 남는다. Task 6에서 고친다.

- [ ] **Step 7: Commit**

```bash
git add src/ui/comparison.ts src/ui/comparison.test.ts src/ui/hooks
git commit -m "feat: UI 비교 조합 상태와 저장소, 브랜치 조회 훅 추가"
```

---

### Task 6: BranchPicker UI와 App 연결

**Files:**
- Create: `src/ui/components/RefSelect.tsx`, `src/ui/components/BranchPicker.tsx`
- Modify: `src/ui/components/Toolbar.tsx`, `src/ui/components/DiffViewer.tsx`, `src/ui/components/BinaryFileDiff.tsx`, `src/ui/App.tsx`, `src/ui/styles/global.css`

**Interfaces:**
- Consumes: Task 5 훅과 `Comparison` 타입
- Produces:
  ```ts
  // BranchPicker props
  interface BranchPickerProps {
    comparison: Comparison
    branches: BranchList | undefined
    fetching: boolean
    fetchError: string | null
    notice: string | null
    onChange: (c: Comparison) => void
    onFetch: () => void
  }
  // Toolbar에 추가되는 prop: branchPicker?: React.ReactNode (있으면 저장소 이름 옆 브랜치 표시 대신 렌더링)
  // DiffViewer, BinaryFileDiff에 추가되는 prop: contentQuery: string (예: 'mode=branch&source=...&target=...')
  ```

- [ ] **Step 1: RefSelect 작성**

`src/ui/components/RefSelect.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface RefSelectProps {
  label: string
  value: string
  local: string[]
  remote: string[]
  onChange: (ref: string) => void
}

export function RefSelect({ label, value, local, remote, onChange }: RefSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const filter = (list: string[]) => {
    const q = query.trim().toLowerCase()
    return q ? list.filter((b) => b.toLowerCase().includes(q)) : list
  }
  const groups = useMemo(
    () => [
      { title: '로컬', items: filter(local) },
      { title: '원격', items: filter(remote) },
    ],
    [local, remote, query],
  )

  const select = (ref: string) => {
    onChange(ref)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="ref-select" ref={rootRef}>
      <button className="btn btn-sm ref-select-button" onClick={() => setOpen(!open)} title={label}>
        <span className="ref-select-label">{label}</span>
        <span className="ref-select-value">{value || '선택'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ref-select-menu">
          <input
            className="ref-select-search"
            autoFocus
            placeholder="브랜치 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ref-select-list">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="ref-select-group">{g.title}</div>
                {g.items.length === 0 && <div className="ref-select-empty">없음</div>}
                {g.items.map((b) => (
                  <button
                    key={`${g.title}:${b}`}
                    className={`ref-select-item ${b === value ? 'ref-select-item-active' : ''}`}
                    onClick={() => select(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: BranchPicker 작성**

`src/ui/components/BranchPicker.tsx`:
```tsx
import { ArrowRight, RefreshCw } from 'lucide-react'
import type { Comparison } from '../comparison'
import { defaultBranchComparison } from '../comparison'
import type { BranchList } from '../hooks/useBranches'
import { RefSelect } from './RefSelect'

interface BranchPickerProps {
  comparison: Comparison
  branches: BranchList | undefined
  fetching: boolean
  fetchError: string | null
  notice: string | null
  onChange: (c: Comparison) => void
  onFetch: () => void
}

export function BranchPicker({ comparison, branches, fetching, fetchError, notice, onChange, onFetch }: BranchPickerProps) {
  const switchToBranch = () => {
    if (comparison.mode === 'branch' || !branches) return
    onChange(defaultBranchComparison(branches))
  }

  return (
    <div className="branch-picker">
      <div className="toolbar-toggle">
        <button
          className={`btn btn-sm ${comparison.mode === 'worktree' ? 'btn-active' : ''}`}
          onClick={() => onChange({ mode: 'worktree' })}
        >
          작업 중 변경사항
        </button>
        <button
          className={`btn btn-sm ${comparison.mode === 'branch' ? 'btn-active' : ''}`}
          onClick={switchToBranch}
          disabled={!branches}
        >
          브랜치 비교
        </button>
      </div>
      {comparison.mode === 'branch' && branches && (
        <div className="branch-picker-refs">
          <RefSelect
            label="소스"
            value={comparison.source}
            local={branches.local}
            remote={branches.remote}
            onChange={(source) => onChange({ ...comparison, source })}
          />
          <ArrowRight size={14} className="branch-picker-arrow" />
          <RefSelect
            label="타겟"
            value={comparison.target}
            local={branches.local}
            remote={branches.remote}
            onChange={(target) => onChange({ ...comparison, target })}
          />
          <button
            className="btn btn-sm"
            onClick={onFetch}
            disabled={fetching}
            title="원격 브랜치 가져오기 (git fetch --all --prune)"
          >
            <RefreshCw size={14} className={fetching ? 'spin' : ''} />
          </button>
        </div>
      )}
      {(fetchError || notice) && (
        <div className="branch-picker-message">{fetchError ? `fetch 실패: ${fetchError}` : notice}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Toolbar 변경**

`src/ui/components/Toolbar.tsx`:
- `ToolbarProps`에 `branchPicker?: React.ReactNode`를 추가하고 구조 분해에도 추가한다.
- `toolbar-left`의 브랜치 표시 부분을 아래로 바꾼다.
```tsx
        <h1 className="toolbar-title">{repoName}</h1>
        {branchPicker ?? (branch && (
          <span className="toolbar-branch">
            <GitBranch size={12} />
            {branch}
          </span>
        ))}
```
- prop `showWorktreeOptions: boolean`을 추가하고 설정 메뉴의 `{!customMode && (` 조건을 `{showWorktreeOptions && (`로 바꾼다. 브랜치 비교 모드에서는 staged, untracked 설정이 diff에 적용되지 않기 때문이다. `customMode` prop은 다른 곳에서 쓰지 않으면 제거한다.

- [ ] **Step 4: DiffViewer와 BinaryFileDiff에 contentQuery 전달**

`DiffViewer.tsx`: props에 `contentQuery: string` 추가, `<BinaryFileDiff ... contentQuery={contentQuery} />`.

`BinaryFileDiff.tsx`: props에 `contentQuery: string` 추가, `<ImagePreview filePath={filePath} changeType={info.type} contentQuery={contentQuery} />`. `ImagePreview`의 src를 아래로 바꾼다.
```ts
function ImagePreview({ filePath, changeType, contentQuery }: { filePath: string; changeType: BinaryFileInfo['type']; contentQuery: string }) {
  const src = (version: 'old' | 'new') => {
    const q = new URLSearchParams(contentQuery)
    q.set('path', filePath)
    q.set('version', version)
    return `/api/file-content?${q}`
  }
  const oldSrc = src('old')
  const newSrc = src('new')
```

- [ ] **Step 5: App 연결**

`src/ui/App.tsx` 변경:

1. import 추가
```ts
import { useRepo } from './hooks/useRepo'
import { useBranches } from './hooks/useBranches'
import { BranchPicker } from './components/BranchPicker'
import { comparisonParams, loadComparison, saveComparison, reconcileComparison, type Comparison } from './comparison'
```

2. `App` 앞부분(`useSettings` 호출부터 `useComments` 호출까지)을 아래로 바꾼다.
```tsx
  const { settings, loaded, updateSettings } = useSettings()
  const { repo, error: repoError } = useRepo()
  const branchMode = !!repo && !repo.customMode
  const { branches, fetchRemote, fetching, fetchError } = useBranches(branchMode)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!repo) return
    if (repo.customMode) {
      setComparison({ mode: 'worktree' })
      return
    }
    if (!branches) return
    const base = comparison ?? loadComparison(repo.root)
    const { comparison: next, missing } = reconcileComparison(base, branches)
    if (missing.length > 0) {
      setNotice(`저장된 브랜치 ${missing.join(', ')}을 찾지 못해 기본값으로 바꿨습니다`)
    }
    if (JSON.stringify(next) !== JSON.stringify(comparison)) setComparison(next)
  }, [repo, branches])

  const handleComparisonChange = useCallback((next: Comparison) => {
    setNotice(null)
    setComparison(next)
    if (repo) saveComparison(repo.root, next)
  }, [repo])

  const params = useMemo(
    () => (comparison ? comparisonParams(comparison, { staged: settings.staged, untracked: settings.untracked }) : null),
    [comparison, settings.staged, settings.untracked],
  )
  const { patch, repoName, branch, customMode, binaryFiles, tabSizeMap, untrackedFiles, key, identical, loading, error } = useDiff(params)
  const { comments, addComment, removeComment, copyAllComments } = useComments(key)
```

3. `useFullDiffs(patch, files, { staged: settings.staged, untracked: settings.untracked })`를 `useFullDiffs(patch, files, params)`로, `useViewed(files)`를 `useViewed(files, key)`로 바꾼다.

4. 로딩/에러 분기를 아래로 바꾼다. 브랜치 선택이 잘못돼도 Toolbar가 남아서 다시 고를 수 있게 한다.
```tsx
  if (repoError) {
    return (
      <div className="error">
        <p>Error: {repoError}</p>
      </div>
    )
  }

  if (!loaded || !repo || !comparison) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }
```

5. `<Toolbar ...>`에 prop 추가
```tsx
        repoName={repoName || repo.name}
        showWorktreeOptions={!repo.customMode && comparison.mode === 'worktree'}
        branchPicker={repo.customMode ? undefined : (
          <BranchPicker
            comparison={comparison}
            branches={branches}
            fetching={fetching}
            fetchError={fetchError}
            notice={notice}
            onChange={handleComparisonChange}
            onFetch={fetchRemote}
          />
        )}
```

6. `<main className="main">` 안을 아래로 바꾼다.
```tsx
        <main className="main">
          {loading ? (
            <div className="loading"><p>Loading diff...</p></div>
          ) : error ? (
            <div className="empty-state"><p>{error}</p></div>
          ) : identical ? (
            <div className="empty-state"><p>두 브랜치의 내용이 같습니다</p></div>
          ) : (
            <Virtualizer className="main-scroll" contentClassName="main-content">
              <DiffViewer
                ...기존 props
                contentQuery={params?.toString() ?? ''}
              />
            </Virtualizer>
          )}
        </main>
```

- [ ] **Step 6: 스타일 추가**

`src/ui/styles/global.css` 끝에 추가:
```css
.branch-picker {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    position: relative;
}

.branch-picker-refs {
    display: flex;
    align-items: center;
    gap: 6px;
}

.branch-picker-arrow {
    color: var(--text-secondary);
}

.branch-picker-message {
    font-size: 12px;
    color: var(--danger);
}

.ref-select {
    position: relative;
}

.ref-select-button {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 280px;
}

.ref-select-label {
    color: var(--text-secondary);
}

.ref-select-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.ref-select-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    width: 320px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.ref-select-search {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    outline: none;
}

.ref-select-list {
    max-height: 360px;
    overflow-y: auto;
    padding: 4px 0;
}

.ref-select-group {
    padding: 6px 10px 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
}

.ref-select-empty {
    padding: 4px 10px;
    font-size: 12px;
    color: var(--text-secondary);
}

.ref-select-item {
    display: block;
    width: 100%;
    padding: 4px 10px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    cursor: pointer;
}

.ref-select-item:hover,
.ref-select-item-active {
    background: var(--bg-secondary);
}

.spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
```

- [ ] **Step 7: 타입 검사와 테스트**

Run: `pnpm exec tsc --noEmit -p . && pnpm test`
Expected: tsc 출력 없음, 테스트 PASS

- [ ] **Step 8: 화면 확인 (사용자가 서버를 띄운다)**

사용자에게 아래 두 명령을 각각 다른 터미널에서 실행해 달라고 요청한다.
```bash
pnpm run dev:server
pnpm run dev:client
```
브라우저(`http://localhost:5173` 또는 vite가 알려준 주소)에서 확인할 항목:
1. Toolbar에 `작업 중 변경사항` / `브랜치 비교` 탭이 보이고 처음에는 `작업 중 변경사항`이 선택돼 있다.
2. `브랜치 비교` 클릭 시 소스가 현재 브랜치, 타겟이 `origin/main`으로 선택되고 두 브랜치의 diff가 나온다.
3. 소스 드롭다운 클릭 시 검색 input과 `로컬`, `원격` 그룹이 보이고 `origin/HEAD`는 없다.
4. 새로고침 버튼 클릭 시 아이콘이 회전하고 끝나면 목록이 갱신된다.
5. 페이지를 새로고침해도 마지막 선택이 그대로 적용된다.
6. `작업 중 변경사항` 탭에서 단 코멘트가 `브랜치 비교` 탭에서는 보이지 않고, 다시 돌아오면 보인다.
7. 소스와 타겟을 같은 브랜치로 고르면 "두 브랜치의 내용이 같습니다"가 나온다.

- [ ] **Step 9: Commit**

```bash
git add src/ui
git commit -m "feat: 소스/타겟 브랜치 선택 UI 추가"
```

---

## 완료 기준

- `pnpm test` 전체 PASS
- `pnpm exec tsc --noEmit -p .` 오류 없음
- `pnpm run build` 성공
- Task 6 Step 8의 화면 확인 7개 항목을 사용자와 함께 확인
