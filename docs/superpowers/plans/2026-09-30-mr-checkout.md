# MR 체크아웃과 터미널 열기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MR 모드에서 MR 소스 브랜치의 head 커밋을 저장소별 리뷰용 worktree에 체크아웃하고, 그 경로를 설정한 터미널 앱으로 연다.

**Architecture:** 서버의 `src/gitlab/reviewWorktree.ts`가 worktree 경로 계산, 상태 조회, 체크아웃, env 파일 복사, 삭제를 git 명령으로 처리한다. `src/server.ts`가 이 모듈과 기존 `MrComparisons`(MR 상세 조회와 커밋 fetch)를 묶어 API로 내보내고, 터미널 열기는 macOS `open -a`로 실행한다. UI는 툴바의 MR 제목 링크 옆에 `MrCheckout` 컴포넌트를 두고 설정 팝오버에 `Terminal` input을 추가한다.

**Tech Stack:** TypeScript, Hono, React 19, @tanstack/react-query, lucide-react, vitest, git 2.53

**Spec:** `docs/superpowers/specs/2026-09-30-mr-checkout-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 작업 브랜치는 `feature/mr-checkout`(worktree `~/Desktop/diffx-feature-mr-checkout`)이다. `develop` 브랜치에는 커밋, 머지, 푸시하지 않는다.
- 커밋 메시지는 한글로 쓰고 type prefix(`feat:`, `test:`, `docs:`, `refactor:`)만 영문으로 쓴다. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 코드만으로 이유가 드러나지 않는 곳에만 단다. 이 계획에 적힌 주석 외에 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱(`pnpm run dev:app`, `dev:client`, `dev:server`)은 사용자가 직접 실행한다. 에이전트가 띄우지 않는다.
- worktree 경로는 `~/.config/diffx/worktrees/<저장소명>-<저장소 경로 sha256 앞 8자리>`이고 항상 서버가 계산한다. API 요청으로 경로를 받지 않는다.
- worktree는 detached HEAD로 체크아웃한다. 로컬 브랜치를 만들거나 바꾸지 않는다.
- git 명령은 `GIT_TERMINAL_PROMPT=0`으로 실행하고 제한 시간은 60초다.
- 터미널 앱 기본값은 `Terminal`이다.
- UI 문구는 spec에 적힌 한국어 문구를 그대로 쓴다: `체크아웃`, `체크아웃됨`, `터미널에서 열기`, `worktree 삭제`, `리뷰용 worktree에 커밋하지 않은 변경사항이 있습니다`, `변경사항을 버리고 체크아웃`, `취소`, `env 파일 N개를 복사했습니다`, `리뷰용 worktree를 삭제합니다. 이 폴더에서 실행 중인 개발서버가 있으면 먼저 종료해 주세요`, `삭제`.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 두 명령 모두 작업 시작 시점에 통과한다(테스트 265개).
- spec 4장은 서버가 git 실행부도 주입받는다고 적었지만, git 동작은 임시 저장소로 실제 실행해 확인하므로 주입하지 않는다. `open` 실행부와 worktree 루트 폴더만 `AppOptions`로 주입한다.

## Review Focus

1. MR에 새 커밋이 push된 뒤 `체크아웃`을 누르면 캐시된 MR 상세가 아니라 GitLab에서 새로 조회한 head로 체크아웃해야 한다. Task 4 서버 테스트 `checks out new commits pushed to the MR`가 확인한다.
2. 리뷰어가 원본 저장소에서 파일을 수정한 상태로 체크아웃해도 원본 저장소의 HEAD, 브랜치, 수정한 파일이 바뀌지 않아야 한다. Task 1 테스트 `leaves the original repository untouched`가 확인한다.
3. worktree에 git에 등록되지 않은 새 파일만 있으면 변경사항으로 보지 않고 체크아웃해야 하고, 강제 체크아웃 뒤에도 그 파일은 남아야 한다. Task 1 테스트 `does not treat untracked files as changes`와 `discards tracked edits with force and keeps untracked files`가 확인한다.
4. 변경된 파일 이름에 공백이나 한글이 있으면 git이 따옴표와 escape로 감싸 출력하는데, 409 응답의 파일 목록에는 원래 이름이 그대로 담겨야 한다. Task 1 테스트 `returns the changed files without switching`이 `문서 파일.txt`로 확인한다.
5. 터미널 앱 이름에 공백이 있어도(`Visual Studio Code`) 하나의 인자로 `open`에 전달되어야 한다. Task 4 서버 테스트 `opens the worktree with the configured terminal app`이 확인한다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/gitlab/reviewWorktree.ts` (신규) | worktree 경로 계산, 상태 조회, 변경 파일 조회, 체크아웃, env 복사, 삭제, `open` 실행부 |
| `src/gitlab/reviewWorktree.test.ts` (신규) | 위 모듈 테스트 |
| `src/test/mrRepo.ts` | 원격 저장소에 MR 커밋을 추가하는 `pushMrCommit` 추가 |
| `src/gitlab/mrComparison.ts` | MR 상세 조회와 커밋 fetch를 `prepare`로 분리 |
| `src/settings.ts`, `src/settings.test.ts` | `terminalApp` 설정 |
| `src/server.ts` | 체크아웃, 상태 조회, 변경 파일 조회, 터미널 열기, 삭제 API |
| `src/server.reviewWorktree.test.ts` (신규) | 위 API 테스트 |
| `src/ui/reviewWorktree.ts`, `src/ui/reviewWorktree.test.ts` (신규) | 체크아웃 영역 상태 결정 함수 |
| `src/ui/hooks/useReviewWorktree.ts` (신규) | worktree 상태 조회와 API 호출 |
| `src/ui/components/MrCheckout.tsx` (신규) | 체크아웃 영역, 팝오버, 안내 메시지 |
| `src/ui/components/Toolbar.tsx` | `mrCheckout` 배치, 설정 팝오버 `Terminal` input |
| `src/ui/hooks/useSettings.ts` | `terminalApp` 필드 |
| `src/ui/App.tsx` | `MrCheckout`과 `terminalApp` 연결 |
| `src/ui/styles/global.css` | 체크아웃 영역 스타일 |
| `README.md` | 사용법 |

---

### Task 0: 기준 상태 확인

- [ ] **Step 1: 브랜치와 테스트 확인**

Run: `git -C ~/Desktop/diffx-feature-mr-checkout branch --show-current && pnpm test && pnpm exec tsc --noEmit -p .`
Expected: `feature/mr-checkout`, `Tests  265 passed`, tsc 출력 없음

---

### Task 1: 리뷰용 worktree 경로, 상태 조회, 체크아웃

**Files:**
- Create: `src/gitlab/reviewWorktree.ts`
- Create: `src/gitlab/reviewWorktree.test.ts`
- Modify: `src/test/mrRepo.ts`

**Interfaces:**
- Consumes: `getRepoName(repo: string): string` (`src/git.ts`), `makeMrRepo()`와 `git()` 테스트 도우미
- Produces:
  - `DEFAULT_WORKTREE_ROOT: string` (`~/.config/diffx/worktrees`)
  - `type ReviewWorktreeStatus = { exists: false } | { exists: true; path: string; headSha: string }`
  - `type CheckoutResult = { kind: 'dirty'; files: string[] } | { kind: 'done'; path: string; headSha: string; copiedEnvFiles: string[] }`
  - `class WorktreeGitError extends Error`
  - `reviewWorktreePath(root: string, repo: string): string`
  - `getReviewWorktree(root: string, repo: string): Promise<ReviewWorktreeStatus>`
  - `listChangedFiles(root: string, repo: string): Promise<string[]>`
  - `checkoutReviewWorktree(root: string, repo: string, headSha: string, options: { force: boolean }): Promise<CheckoutResult>`
  - 테스트 도우미 `pushMrCommit(remote: string, iid: number, parent: string, files: Record<string, string>): string`

- [ ] **Step 1: 테스트 도우미 추가**

`src/test/mrRepo.ts` 끝에 추가한다.

```ts
export function pushMrCommit(remote: string, iid: number, parent: string, files: Record<string, string>): string {
  git(remote, 'switch', '-q', '--detach', parent)
  const sha = commit(remote, files, `mr ${iid}`)
  git(remote, 'update-ref', `refs/merge-requests/${iid}/head`, sha)
  git(remote, 'switch', '-q', 'main')
  return sha
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/gitlab/reviewWorktree.test.ts`를 만든다.

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../test/gitRepo'
import { makeMrRepo, pushMrCommit } from '../test/mrRepo'
import { checkoutReviewWorktree, getReviewWorktree, reviewWorktreePath, WorktreeGitError } from './reviewWorktree'

function setup() {
  const repo = makeMrRepo()
  git(repo.local, 'fetch', '-q', 'origin', 'refs/merge-requests/7/head')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-worktrees-')))
  const addMr = (iid: number, files: Record<string, string>) => {
    const sha = pushMrCommit(repo.remote, iid, repo.base, files)
    git(repo.local, 'fetch', '-q', 'origin', `refs/merge-requests/${iid}/head`)
    return sha
  }
  const headOf = (dir: string) => git(dir, 'rev-parse', 'HEAD').trim()
  return { ...repo, root, addMr, headOf }
}

describe('reviewWorktreePath', () => {
  it('names the folder after the repo and a hash of its path', () => {
    const a = reviewWorktreePath('/wt', '/work/a/app')
    const b = reviewWorktreePath('/wt', '/work/b/app')
    expect(a).toMatch(/^\/wt\/app-[0-9a-f]{8}$/)
    expect(b).toMatch(/^\/wt\/app-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    expect(reviewWorktreePath('/wt', '/work/a/app')).toBe(a)
  })
})

describe('checkoutReviewWorktree', () => {
  it('reports no worktree before the first checkout', async () => {
    const { root, local } = setup()
    expect(await getReviewWorktree(root, local)).toEqual({ exists: false })
  })

  it('creates a detached worktree at the MR head', async () => {
    const { root, local, head, headOf } = setup()
    const result = await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    expect(result).toEqual({ kind: 'done', path, headSha: head, copiedEnvFiles: [] })
    expect(headOf(path)).toBe(head)
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('HEAD')
    expect(readFileSync(join(path, 'b.png'), 'utf-8')).toBe('NEWPNG')
    expect(await getReviewWorktree(root, local)).toEqual({ exists: true, path, headSha: head })
  })

  it('leaves the original repository untouched', async () => {
    const { root, local, head, headOf } = setup()
    const before = headOf(local)
    writeFileSync(join(local, 'a.txt'), 'mine\n')
    await checkoutReviewWorktree(root, local, head, { force: false })
    expect(headOf(local)).toBe(before)
    expect(git(local, 'branch', '--show-current').trim()).toBe('main')
    expect(git(local, 'branch', '--list').trim()).toBe('* main')
    expect(readFileSync(join(local, 'a.txt'), 'utf-8')).toBe('mine\n')
  })

  it('moves the same folder to another MR', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const result = await checkoutReviewWorktree(root, local, other, { force: false })
    const path = reviewWorktreePath(root, local)
    expect(result).toMatchObject({ kind: 'done', path, headSha: other })
    expect(headOf(path)).toBe(other)
    expect(existsSync(join(path, 'c.txt'))).toBe(true)
  })

  it('returns the changed files without switching', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { '문서 파일.txt': 'x\n' })
    await checkoutReviewWorktree(root, local, other, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, '문서 파일.txt'), 'edited\n')
    expect(await checkoutReviewWorktree(root, local, head, { force: false })).toEqual({ kind: 'dirty', files: ['문서 파일.txt'] })
    expect(headOf(path)).toBe(other)
  })

  it('discards tracked edits with force and keeps untracked files', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    writeFileSync(join(path, 'scratch.txt'), 'note\n')
    expect(await checkoutReviewWorktree(root, local, other, { force: true })).toMatchObject({ kind: 'done', headSha: other })
    expect(headOf(path)).toBe(other)
    expect(readFileSync(join(path, 'a.txt'), 'utf-8')).toBe('one\ntwo\nthree\n')
    expect(readFileSync(join(path, 'scratch.txt'), 'utf-8')).toBe('note\n')
  })

  it('does not treat untracked files as changes', async () => {
    const { root, local, head, addMr, headOf } = setup()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, 'scratch.txt'), 'note\n')
    expect(await checkoutReviewWorktree(root, local, other, { force: false })).toMatchObject({ kind: 'done', headSha: other })
    expect(headOf(path)).toBe(other)
  })

  it('recreates the worktree after the folder was deleted by hand', async () => {
    const { root, local, head, headOf } = setup()
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    rmSync(path, { recursive: true, force: true })
    expect(await getReviewWorktree(root, local)).toEqual({ exists: false })
    expect(await checkoutReviewWorktree(root, local, head, { force: false })).toMatchObject({ kind: 'done', headSha: head })
    expect(headOf(path)).toBe(head)
  })

  it('rejects values that are not commit shas', async () => {
    const { root, local } = setup()
    await expect(checkoutReviewWorktree(root, local, '--help', { force: false })).rejects.toBeInstanceOf(WorktreeGitError)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/reviewWorktree.test.ts`
Expected: FAIL, `Failed to resolve import "./reviewWorktree"`

- [ ] **Step 4: 구현**

`src/gitlab/reviewWorktree.ts`를 만든다.

```ts
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getRepoName } from '../git.js'

export const DEFAULT_WORKTREE_ROOT = join(homedir(), '.config', 'diffx', 'worktrees')

export type ReviewWorktreeStatus = { exists: false } | { exists: true; path: string; headSha: string }

export type CheckoutResult =
  | { kind: 'dirty'; files: string[] }
  | { kind: 'done'; path: string; headSha: string; copiedEnvFiles: string[] }

export class WorktreeGitError extends Error {}

const TIMEOUT_MS = 60_000
const SHA_REGEX = /^[0-9a-f]{40,64}$/

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (!err) return done(stdout)
        fail(new WorktreeGitError(err.killed ? `git ${args[0]} 명령이 ${TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다` : stderr.trim() || err.message))
      },
    )
  })
}

export function reviewWorktreePath(root: string, repo: string): string {
  const hash = createHash('sha256').update(repo).digest('hex').slice(0, 8)
  return join(root, `${getRepoName(repo)}-${hash}`)
}

export async function getReviewWorktree(root: string, repo: string): Promise<ReviewWorktreeStatus> {
  const path = reviewWorktreePath(root, repo)
  if (!existsSync(path)) return { exists: false }
  return { exists: true, path, headSha: (await runGit(path, ['rev-parse', 'HEAD'])).trim() }
}

// -z 출력에서 이름 변경(R)과 복사(C) 항목은 바뀐 경로 뒤에 원래 경로가 한 항목 더 붙는다.
function parseStatus(output: string): string[] {
  const entries = output.split('\0')
  const files: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    files.push(entry.slice(3))
    if (/[RC]/.test(entry.slice(0, 2))) i++
  }
  return files
}

export async function listChangedFiles(root: string, repo: string): Promise<string[]> {
  const path = reviewWorktreePath(root, repo)
  if (!existsSync(path)) return []
  return parseStatus(await runGit(path, ['status', '--porcelain', '-z', '--untracked-files=no']))
}

export async function checkoutReviewWorktree(root: string, repo: string, headSha: string, options: { force: boolean }): Promise<CheckoutResult> {
  if (!SHA_REGEX.test(headSha)) throw new WorktreeGitError('커밋 sha가 올바르지 않습니다')
  const path = reviewWorktreePath(root, repo)
  if (!existsSync(path)) {
    mkdirSync(root, { recursive: true })
    // 리뷰어가 폴더를 직접 지우면 원본 저장소에 worktree 등록 정보가 남아 worktree add가 거부된다.
    await runGit(repo, ['worktree', 'prune'])
    await runGit(repo, ['worktree', 'add', '--detach', path, headSha])
  } else {
    const files = await listChangedFiles(root, repo)
    if (files.length > 0 && !options.force) return { kind: 'dirty', files }
    await runGit(path, ['checkout', ...(files.length > 0 ? ['--force'] : []), '--detach', headSha])
  }
  return { kind: 'done', path, headSha, copiedEnvFiles: [] }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/reviewWorktree.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/gitlab/reviewWorktree.ts src/gitlab/reviewWorktree.test.ts src/test/mrRepo.ts
git commit -m "feat: MR head 커밋을 리뷰용 worktree에 체크아웃"
```

---

### Task 2: env 파일 복사

**Files:**
- Modify: `src/gitlab/reviewWorktree.ts`
- Modify: `src/gitlab/reviewWorktree.test.ts`

**Interfaces:**
- Consumes: Task 1의 `checkoutReviewWorktree`, `runGit`
- Produces: `copyEnvFiles(repo: string, worktree: string): Promise<string[]>`. `checkoutReviewWorktree`의 `copiedEnvFiles`에 복사한 파일의 저장소 기준 상대 경로가 담긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/gitlab/reviewWorktree.test.ts` 끝에 추가한다. 테스트 저장소에는 `.gitignore`가 없어서 `.git/info/exclude`에 무시 규칙을 적는다. 이 파일은 원본 저장소와 worktree가 함께 쓴다. `import { ... } from 'node:fs'`에 `appendFileSync`, `mkdirSync`를 추가한다.

```ts
describe('env files', () => {
  function setupEnv() {
    const ctx = setup()
    appendFileSync(join(ctx.local, '.git', 'info', 'exclude'), '.env*\nnode_modules/\n')
    writeFileSync(join(ctx.local, '.env.local'), 'A=1\n')
    mkdirSync(join(ctx.local, 'apps', 'web'), { recursive: true })
    writeFileSync(join(ctx.local, 'apps', 'web', '.env'), 'B=2\n')
    mkdirSync(join(ctx.local, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(ctx.local, 'node_modules', 'pkg', '.env'), 'C=3\n')
    return ctx
  }

  it('copies ignored env files outside ignored folders', async () => {
    const { root, local, head } = setupEnv()
    const result = await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    expect(result.kind === 'done' && [...result.copiedEnvFiles].sort()).toEqual(['.env.local', 'apps/web/.env'])
    expect(readFileSync(join(path, '.env.local'), 'utf-8')).toBe('A=1\n')
    expect(readFileSync(join(path, 'apps', 'web', '.env'), 'utf-8')).toBe('B=2\n')
    expect(existsSync(join(path, 'node_modules'))).toBe(false)
  })

  it('does not overwrite env files already in the worktree', async () => {
    const { root, local, head, addMr } = setupEnv()
    const other = addMr(8, { 'c.txt': 'c\n' })
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, '.env.local'), 'A=mine\n')
    const result = await checkoutReviewWorktree(root, local, other, { force: false })
    expect(result).toMatchObject({ kind: 'done', copiedEnvFiles: [] })
    expect(readFileSync(join(path, '.env.local'), 'utf-8')).toBe('A=mine\n')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/reviewWorktree.test.ts -t "env files"`
Expected: FAIL, `copies ignored env files`에서 `[]`가 `['.env.local', 'apps/web/.env']`와 다름

- [ ] **Step 3: 구현**

`src/gitlab/reviewWorktree.ts`의 import를 바꾼다.

```ts
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
```

`checkoutReviewWorktree` 위에 추가한다.

```ts
// --directory는 node_modules처럼 무시된 폴더를 폴더 이름 한 줄(`node_modules/`)로 출력해서 그 안의 파일을 나열하지 않는다.
export async function copyEnvFiles(repo: string, worktree: string): Promise<string[]> {
  const output = await runGit(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])
  const copied: string[] = []
  for (const file of output.split('\0')) {
    if (!file || file.endsWith('/') || !basename(file).startsWith('.env')) continue
    const target = join(worktree, file)
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(repo, file), target)
    copied.push(file)
  }
  return copied
}
```

`checkoutReviewWorktree`의 마지막 줄을 바꾼다.

```ts
  return { kind: 'done', path, headSha, copiedEnvFiles: await copyEnvFiles(repo, path) }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/reviewWorktree.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/gitlab/reviewWorktree.ts src/gitlab/reviewWorktree.test.ts
git commit -m "feat: 체크아웃 시 원본 저장소의 env 파일을 worktree로 복사"
```

---

### Task 3: worktree 삭제와 변경 파일 조회

**Files:**
- Modify: `src/gitlab/reviewWorktree.ts`
- Modify: `src/gitlab/reviewWorktree.test.ts`

**Interfaces:**
- Consumes: Task 1의 `reviewWorktreePath`, `listChangedFiles`, `runGit`
- Produces: `removeReviewWorktree(root: string, repo: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/gitlab/reviewWorktree.test.ts`의 `./reviewWorktree` import에 `listChangedFiles`, `removeReviewWorktree`를 추가하고 파일 끝에 추가한다.

```ts
describe('listChangedFiles', () => {
  it('lists edited tracked files and returns nothing without a worktree', async () => {
    const { root, local, head } = setup()
    expect(await listChangedFiles(root, local)).toEqual([])
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    writeFileSync(join(path, 'scratch.txt'), 'note\n')
    expect(await listChangedFiles(root, local)).toEqual(['a.txt'])
  })
})

describe('removeReviewWorktree', () => {
  const registered = (local: string, path: string) => git(local, 'worktree', 'list', '--porcelain').includes(path)

  it('removes a worktree that has ignored and untracked folders', async () => {
    const { root, local, head } = setup()
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    mkdirSync(join(path, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(path, 'node_modules', 'pkg', 'index.js'), '\n')
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    await removeReviewWorktree(root, local)
    expect(existsSync(path)).toBe(false)
    expect(registered(local, path)).toBe(false)
    expect(await getReviewWorktree(root, local)).toEqual({ exists: false })
  })

  it('clears the registration when the folder was deleted by hand', async () => {
    const { root, local, head } = setup()
    await checkoutReviewWorktree(root, local, head, { force: false })
    const path = reviewWorktreePath(root, local)
    rmSync(path, { recursive: true, force: true })
    await removeReviewWorktree(root, local)
    expect(registered(local, path)).toBe(false)
  })

  it('does nothing when there is no worktree', async () => {
    const { root, local } = setup()
    await expect(removeReviewWorktree(root, local)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/reviewWorktree.test.ts -t removeReviewWorktree`
Expected: FAIL, `removeReviewWorktree is not a function`

- [ ] **Step 3: 구현**

`src/gitlab/reviewWorktree.ts` 끝에 추가한다.

```ts
// node_modules처럼 git에 등록되지 않은 파일이 있으면 --force 없이는 git이 삭제를 거부한다.
export async function removeReviewWorktree(root: string, repo: string): Promise<void> {
  const path = reviewWorktreePath(root, repo)
  if (existsSync(path)) await runGit(repo, ['worktree', 'remove', '--force', path])
  else await runGit(repo, ['worktree', 'prune'])
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/reviewWorktree.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/gitlab/reviewWorktree.ts src/gitlab/reviewWorktree.test.ts
git commit -m "feat: 리뷰용 worktree 삭제"
```

---

### Task 4: terminalApp 설정과 서버 API

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/settings.test.ts`
- Modify: `src/gitlab/mrComparison.ts`
- Modify: `src/gitlab/reviewWorktree.ts`
- Modify: `src/server.ts`
- Create: `src/server.reviewWorktree.test.ts`

**Interfaces:**
- Consumes: Task 1~3의 `DEFAULT_WORKTREE_ROOT`, `reviewWorktreePath`, `getReviewWorktree`, `listChangedFiles`, `checkoutReviewWorktree`, `removeReviewWorktree`, `WorktreeGitError`. 기존 `MrComparisons`, `comparisonErrorResponse`, `loadSettings`
- Produces:
  - `Settings.terminalApp?: string`
  - `MrComparisons.prepare(iid: number, options: { refresh: boolean }): Promise<MrDetail>`
  - `openWithApp(args: string[]): Promise<void>` (`src/gitlab/reviewWorktree.ts`)
  - `AppOptions.reviewWorktreeRoot?: string`, `AppOptions.openApp?: (args: string[]) => Promise<void>`
  - API: `GET /api/review-worktree`, `GET /api/review-worktree/changes`, `POST /api/gitlab/mrs/:iid/checkout`, `POST /api/review-worktree/open-terminal`, `DELETE /api/review-worktree`. 응답 형태는 spec 4장 표와 같다.

- [ ] **Step 1: 설정 테스트 작성**

`src/settings.test.ts` 끝에 추가한다.

```ts
describe('terminalApp', () => {
  it('saves a trimmed string and ignores other types', async () => {
    const home = mkdtempSync(join(tmpdir(), 'diffx-home-'))
    vi.stubEnv('HOME', home)
    vi.resetModules()
    const { loadSettings, saveSettings } = await import('./settings')
    expect(loadSettings().terminalApp).toBeUndefined()
    saveSettings({ terminalApp: '  iTerm  ' })
    expect(loadSettings().terminalApp).toBe('iTerm')
    saveSettings({ terminalApp: 5 } as never)
    expect(loadSettings().terminalApp).toBe('iTerm')
    saveSettings({ terminalApp: '' })
    expect(loadSettings().terminalApp).toBe('')
    vi.unstubAllEnvs()
  })
})
```

- [ ] **Step 2: 설정 테스트 실패 확인**

Run: `pnpm exec vitest run src/settings.test.ts`
Expected: FAIL, `expected undefined to be 'iTerm'`

- [ ] **Step 3: 설정 구현**

`src/settings.ts`의 `Settings`와 `pick`을 바꾼다.

```ts
export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap?: boolean
  terminalApp?: string
}
```

`pick` 안 `softWrap` 줄 아래에 추가한다.

```ts
  if (typeof value.terminalApp === 'string') out.terminalApp = value.terminalApp.trim()
```

Run: `pnpm exec vitest run src/settings.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: 서버 테스트 작성**

`src/server.reviewWorktree.test.ts`를 만든다. 서버가 읽는 `~/.config/diffx/settings.json`이 실제 홈 폴더를 건드리지 않도록 `HOME`을 임시 폴더로 바꾸고 모듈을 다시 불러온다.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from './test/gitRepo'
import { fakeGlab } from './test/fakeGlab'
import { makeMrRepo, apiMr, pushMrCommit } from './test/mrRepo'

const PROJECT = { path_with_namespace: 'team/app', web_url: 'https://gitlab.example.com/team/app' }

beforeEach(() => {
  vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'diffx-home-')))
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function setup() {
  const { createApp } = await import('./server')
  const { saveSettings } = await import('./settings')
  const repo = makeMrRepo()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-worktrees-')))
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '<html></html>')
  const details: Record<number, unknown> = { 7: apiMr(7, repo.base, repo.head) }
  const { glab } = fakeGlab({
    'GET projects/:fullpath': PROJECT,
    'GET user': { username: 'me' },
    'GET projects/:fullpath/merge_requests/7': () => details[7],
  })
  const opened: string[][] = []
  let openError: Error | null = null
  const openApp = async (args: string[]) => {
    if (openError) throw openError
    opened.push(args)
  }
  const app = createApp({ repoPath: repo.local, clientDir, glab, reviewWorktreeRoot: root, openApp })
  const post = (path: string, body: unknown = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const status = async () => (await app.request('/api/review-worktree')).json()
  return {
    ...repo, app, root, details, opened, post, status, saveSettings,
    failOpen: (err: Error) => { openError = err },
  }
}

describe('review worktree APIs', () => {
  it('checks out the MR head and reports the worktree status', async () => {
    const { head, root, post, status } = await setup()
    expect(await status()).toEqual({ exists: false })
    const res = await post('/api/gitlab/mrs/7/checkout')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ path: expect.any(String), headSha: head, copiedEnvFiles: [] })
    expect(body.path.startsWith(`${root}/`)).toBe(true)
    expect(await status()).toEqual({ exists: true, path: body.path, headSha: head })
  })

  it('checks out new commits pushed to the MR', async () => {
    const { remote, base, head, details, post, status } = await setup()
    await post('/api/gitlab/mrs/7/checkout')
    const next = pushMrCommit(remote, 7, head, { 'c.txt': 'c\n' })
    details[7] = apiMr(7, base, next)
    expect(await (await post('/api/gitlab/mrs/7/checkout')).json()).toMatchObject({ headSha: next })
    expect(await status()).toMatchObject({ headSha: next })
  })

  it('returns 409 with changed files and checks out with force', async () => {
    const { app, head, post } = await setup()
    const { path } = await (await post('/api/gitlab/mrs/7/checkout')).json()
    writeFileSync(join(path, 'a.txt'), 'edited\n')
    const dirty = await post('/api/gitlab/mrs/7/checkout')
    expect(dirty.status).toBe(409)
    expect(await dirty.json()).toEqual({ error: 'dirty', files: ['a.txt'] })
    expect(await (await app.request('/api/review-worktree/changes')).json()).toEqual({ files: ['a.txt'] })
    const forced = await post('/api/gitlab/mrs/7/checkout', { force: true })
    expect(forced.status).toBe(200)
    expect(await forced.json()).toMatchObject({ headSha: head })
    expect(await (await app.request('/api/review-worktree/changes')).json()).toEqual({ files: [] })
  })

  it('returns 502 when the MR commits cannot be fetched', async () => {
    const { base, details, post } = await setup()
    details[7] = apiMr(7, base, 'f'.repeat(40))
    const res = await post('/api/gitlab/mrs/7/checkout')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'mr_fetch_failed' })
  })

  it('rejects invalid iids', async () => {
    const { post } = await setup()
    const res = await post('/api/gitlab/mrs/abc/checkout')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_iid' })
  })

  it('opens the worktree with the configured terminal app', async () => {
    const { post, opened, saveSettings } = await setup()
    const missing = await post('/api/review-worktree/open-terminal')
    expect(missing.status).toBe(404)
    expect(opened).toEqual([])
    const { path } = await (await post('/api/gitlab/mrs/7/checkout')).json()
    expect((await post('/api/review-worktree/open-terminal')).status).toBe(204)
    saveSettings({ terminalApp: 'Visual Studio Code' })
    await post('/api/review-worktree/open-terminal')
    saveSettings({ terminalApp: '' })
    await post('/api/review-worktree/open-terminal')
    expect(opened).toEqual([
      ['-a', 'Terminal', path],
      ['-a', 'Visual Studio Code', path],
      ['-a', 'Terminal', path],
    ])
  })

  it('returns the open error message', async () => {
    const { post, failOpen } = await setup()
    await post('/api/gitlab/mrs/7/checkout')
    failOpen(new Error("Unable to find application named 'Nope'"))
    const res = await post('/api/review-worktree/open-terminal')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'open_failed', message: "Unable to find application named 'Nope'" })
  })

  it('deletes the worktree', async () => {
    const { app, local, post, status } = await setup()
    const { path } = await (await post('/api/gitlab/mrs/7/checkout')).json()
    const res = await app.request('/api/review-worktree', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(existsSync(path)).toBe(false)
    expect(git(local, 'worktree', 'list', '--porcelain')).not.toContain(path)
    expect(await status()).toEqual({ exists: false })
  })
})
```

- [ ] **Step 5: 서버 테스트 실패 확인**

Run: `pnpm exec vitest run src/server.reviewWorktree.test.ts`
Expected: FAIL, `checks out the MR head`에서 `/api/review-worktree`가 `index.html`을 돌려주어 JSON 파싱 오류

- [ ] **Step 6: `MrComparisons.prepare` 분리**

`src/gitlab/mrComparison.ts`의 `resolve`를 아래처럼 바꾼다.

```ts
  async prepare(iid: number, options: { refresh: boolean }): Promise<MrDetail> {
    const mr = await this.detail(iid, { refresh: options.refresh })
    await ensureMrCommits(this.repo, await this.remote(), mr)
    return mr
  }

  async resolve(iid: number, options: { refresh: boolean }): Promise<MrResolved> {
    const mr = await this.prepare(iid, options)
    return {
      key: `mr:${iid}`,
      mode: 'mr',
      patch: this.rangeDiff(this.repo, mr.baseSha, mr.headSha),
      source: mr.headSha,
      target: mr.baseSha,
      sourceSha: mr.headSha,
      targetSha: mr.baseSha,
      mergeBase: mr.baseSha,
      mr,
    }
  }
```

- [ ] **Step 7: `open` 실행부 추가**

`src/gitlab/reviewWorktree.ts` 끝에 추가한다.

```ts
// 앱을 찾지 못하면 open이 "Unable to find application named '<앱>'"을 stderr로 출력한다.
export function openWithApp(args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile('open', args, { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) fail(new Error(stderr.trim() || err.message))
      else done()
    })
  })
}
```

- [ ] **Step 8: 서버 API 구현**

`src/server.ts`에 import를 추가한다.

```ts
import { DEFAULT_WORKTREE_ROOT, WorktreeGitError, checkoutReviewWorktree, getReviewWorktree, listChangedFiles, openWithApp, removeReviewWorktree, reviewWorktreePath } from './gitlab/reviewWorktree.js'
import { existsSync } from 'node:fs'
```

`AppOptions`에 추가한다.

```ts
  reviewWorktreeRoot?: string
  openApp?: (args: string[]) => Promise<void>
```

`comparisonErrorResponse`의 `if (err instanceof GlabError)` 블록 아래에 추가한다.

```ts
    if (err instanceof WorktreeGitError) {
      return c.json({ error: 'git', message: err.message }, 502)
    }
```

`app.post('/api/gitlab/mrs/:iid/publish', ...)` 블록 아래에 추가한다.

```ts
  const worktreeRoot = options.reviewWorktreeRoot ?? DEFAULT_WORKTREE_ROOT
  const openApp = options.openApp ?? openWithApp

  app.get('/api/review-worktree', async (c) => {
    try {
      return c.json(await getReviewWorktree(worktreeRoot, repo))
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.get('/api/review-worktree/changes', async (c) => {
    try {
      return c.json({ files: await listChangedFiles(worktreeRoot, repo) })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/gitlab/mrs/:iid/checkout', async (c) => {
    let body: { force?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    try {
      const mr = await mrComparisons.prepare(parseIid(c.req.param('iid')), { refresh: true })
      const result = await checkoutReviewWorktree(worktreeRoot, repo, mr.headSha, { force: body.force === true })
      if (result.kind === 'dirty') return c.json({ error: 'dirty', files: result.files }, 409)
      return c.json({ path: result.path, headSha: result.headSha, copiedEnvFiles: result.copiedEnvFiles })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/review-worktree/open-terminal', async (c) => {
    const path = reviewWorktreePath(worktreeRoot, repo)
    if (!existsSync(path)) {
      return c.json({ error: 'not_found', message: '리뷰용 worktree가 없습니다. 먼저 체크아웃해 주세요' }, 404)
    }
    try {
      await openApp(['-a', loadSettings().terminalApp || 'Terminal', path])
    } catch (err) {
      return c.json({ error: 'open_failed', message: (err as Error).message }, 502)
    }
    return c.body(null, 204)
  })

  app.delete('/api/review-worktree', async (c) => {
    try {
      await removeReviewWorktree(worktreeRoot, repo)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    return c.body(null, 204)
  })
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm exec vitest run src/server.reviewWorktree.test.ts src/server.gitlab.test.ts src/settings.test.ts`
Expected: PASS

- [ ] **Step 10: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모든 테스트 통과, tsc 출력 없음

- [ ] **Step 11: 커밋**

```bash
git add src/settings.ts src/settings.test.ts src/gitlab/mrComparison.ts src/gitlab/reviewWorktree.ts src/server.ts src/server.reviewWorktree.test.ts
git commit -m "feat: 리뷰용 worktree 체크아웃, 터미널 열기, 삭제 API 추가"
```

---

### Task 5: 체크아웃 영역 UI

**Files:**
- Create: `src/ui/reviewWorktree.ts`
- Create: `src/ui/reviewWorktree.test.ts`
- Create: `src/ui/hooks/useReviewWorktree.ts`
- Create: `src/ui/components/MrCheckout.tsx`
- Modify: `src/ui/components/Toolbar.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles/global.css`

**Interfaces:**
- Consumes: Task 1의 `ReviewWorktreeStatus` 타입, Task 4의 API
- Produces:
  - `type CheckoutState = 'loading' | 'none' | 'outdated' | 'current'`
  - `checkoutState(worktree: ReviewWorktreeStatus | undefined, mrHeadSha: string): CheckoutState`
  - `useReviewWorktree()` 반환값 `{ worktree, error, checkout, openTerminal, listChanges, remove }`
  - `MrCheckout({ iid, headSha })`
  - `ToolbarProps.mrCheckout?: ReactNode`

- [ ] **Step 1: 상태 결정 함수 테스트 작성**

`src/ui/reviewWorktree.test.ts`를 만든다.

```ts
import { describe, it, expect } from 'vitest'
import { checkoutState } from './reviewWorktree'

describe('checkoutState', () => {
  const head = 'a'.repeat(40)

  it('waits while the status is loading', () => {
    expect(checkoutState(undefined, head)).toBe('loading')
  })

  it('offers a checkout when there is no worktree', () => {
    expect(checkoutState({ exists: false }, head)).toBe('none')
  })

  it('compares the worktree HEAD with the MR head', () => {
    expect(checkoutState({ exists: true, path: '/wt/app-12345678', headSha: head }, head)).toBe('current')
    expect(checkoutState({ exists: true, path: '/wt/app-12345678', headSha: 'b'.repeat(40) }, head)).toBe('outdated')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/ui/reviewWorktree.test.ts`
Expected: FAIL, `Failed to resolve import "./reviewWorktree"`

- [ ] **Step 3: 상태 결정 함수 구현**

`src/ui/reviewWorktree.ts`를 만든다.

```ts
import type { ReviewWorktreeStatus } from '../gitlab/reviewWorktree'

export type CheckoutState = 'loading' | 'none' | 'outdated' | 'current'

export function checkoutState(worktree: ReviewWorktreeStatus | undefined, mrHeadSha: string): CheckoutState {
  if (!worktree) return 'loading'
  if (!worktree.exists) return 'none'
  return worktree.headSha === mrHeadSha ? 'current' : 'outdated'
}
```

Run: `pnpm exec vitest run src/ui/reviewWorktree.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: hook 작성**

`src/ui/hooks/useReviewWorktree.ts`를 만든다.

```ts
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReviewWorktreeStatus } from '../../gitlab/reviewWorktree'

const KEY = ['review-worktree']
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type CheckoutResponse =
  | { kind: 'done'; path: string; headSha: string; copiedEnvFiles: string[] }
  | { kind: 'dirty'; files: string[] }

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return body?.message ?? `HTTP ${res.status}`
}

export function useReviewWorktree() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ReviewWorktreeStatus> => {
      const res = await fetch('/api/review-worktree')
      if (!res.ok) throw new Error(await errorMessage(res))
      return res.json()
    },
  })

  const checkout = useCallback(async (iid: number, force: boolean): Promise<CheckoutResponse> => {
    const res = await fetch(`/api/gitlab/mrs/${iid}/checkout`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ force }) })
    if (res.status === 409) return { kind: 'dirty', files: (await res.json()).files }
    if (!res.ok) throw new Error(await errorMessage(res))
    const body: { path: string; headSha: string; copiedEnvFiles: string[] } = await res.json()
    queryClient.setQueryData<ReviewWorktreeStatus>(KEY, { exists: true, path: body.path, headSha: body.headSha })
    return { kind: 'done', ...body }
  }, [queryClient])

  const openTerminal = useCallback(async () => {
    const res = await fetch('/api/review-worktree/open-terminal', { method: 'POST', headers: JSON_HEADERS, body: '{}' })
    if (!res.ok) throw new Error(await errorMessage(res))
  }, [])

  const listChanges = useCallback(async (): Promise<string[]> => {
    const res = await fetch('/api/review-worktree/changes')
    if (!res.ok) throw new Error(await errorMessage(res))
    return (await res.json()).files
  }, [])

  const remove = useCallback(async () => {
    const res = await fetch('/api/review-worktree', { method: 'DELETE' })
    if (!res.ok) throw new Error(await errorMessage(res))
    queryClient.setQueryData<ReviewWorktreeStatus>(KEY, { exists: false })
  }, [queryClient])

  return { worktree: data, error: error ? (error as Error).message : null, checkout, openTerminal, listChanges, remove }
}
```

- [ ] **Step 5: `MrCheckout` 컴포넌트 작성**

`src/ui/components/MrCheckout.tsx`를 만든다. App에서 `key={iid}`로 그려서 다른 MR을 선택하면 컴포넌트가 새로 만들어진다. 그래서 팝오버와 안내 메시지가 닫히고, react-query가 mount 시점에 worktree 상태를 다시 조회한다.

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { Check, GitCommitHorizontal, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { useReviewWorktree } from '../hooks/useReviewWorktree'
import { checkoutState } from '../reviewWorktree'

type Busy = 'checkout' | 'terminal' | 'delete' | null
type Popover = { kind: 'dirty' | 'delete'; files: string[] } | null

function FileList({ files }: { files: string[] }) {
  if (files.length === 0) return null
  return (
    <ul className="mr-checkout-files">
      {files.map((file) => <li key={file}>{file}</li>)}
    </ul>
  )
}

export function MrCheckout({ iid, headSha }: { iid: number; headSha: string }) {
  const { worktree, error: statusError, checkout, openTerminal, listChanges, remove } = useReviewWorktree()
  const [busy, setBusy] = useState<Busy>(null)
  const [popover, setPopover] = useState<Popover>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setPopover(null)
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doCheckout = (force: boolean) => run('checkout', async () => {
    setPopover(null)
    const result = await checkout(iid, force)
    if (result.kind === 'dirty') setPopover({ kind: 'dirty', files: result.files })
    else if (result.copiedEnvFiles.length > 0) setNotice(`env 파일 ${result.copiedEnvFiles.length}개를 복사했습니다`)
  })
  const askRemove = () => run('delete', async () => setPopover({ kind: 'delete', files: await listChanges() }))
  const doRemove = () => run('delete', async () => {
    await remove()
    setPopover(null)
  })

  const state = checkoutState(worktree, headSha)
  if (state === 'loading') {
    return statusError ? <div className="mr-checkout"><span className="mr-checkout-danger">{statusError}</span></div> : null
  }
  const path = worktree?.exists ? worktree.path : undefined
  const icon = (kind: Busy, idle: ReactNode) => (busy === kind ? <RefreshCw size={14} className="spin" /> : idle)

  return (
    <div className="mr-checkout">
      {state === 'current' ? (
        <span className="mr-checkout-done" title={path}><Check size={14} /> 체크아웃됨</span>
      ) : (
        <button className="btn btn-sm" onClick={() => void doCheckout(false)} disabled={busy !== null}>
          {icon('checkout', <GitCommitHorizontal size={14} />)} 체크아웃
        </button>
      )}
      {state !== 'none' && (
        <>
          <button className="btn btn-sm" title={path} onClick={() => void run('terminal', openTerminal)} disabled={busy !== null}>
            {icon('terminal', <Terminal size={14} />)} 터미널에서 열기
          </button>
          <button className="btn btn-sm" onClick={() => void askRemove()} disabled={busy !== null}>
            {icon('delete', <Trash2 size={14} />)} worktree 삭제
          </button>
        </>
      )}
      {popover?.kind === 'dirty' && (
        <div className="mr-checkout-popover">
          <p>리뷰용 worktree에 커밋하지 않은 변경사항이 있습니다</p>
          <FileList files={popover.files} />
          <div className="mr-checkout-actions">
            <button className="btn btn-sm mr-checkout-danger" onClick={() => void doCheckout(true)} disabled={busy !== null}>변경사항을 버리고 체크아웃</button>
            <button className="btn btn-sm" onClick={() => setPopover(null)} disabled={busy !== null}>취소</button>
          </div>
        </div>
      )}
      {popover?.kind === 'delete' && (
        <div className="mr-checkout-popover">
          <p>리뷰용 worktree를 삭제합니다. 이 폴더에서 실행 중인 개발서버가 있으면 먼저 종료해 주세요</p>
          <FileList files={popover.files} />
          <div className="mr-checkout-actions">
            <button className="btn btn-sm mr-checkout-danger" onClick={() => void doRemove()} disabled={busy !== null}>삭제</button>
            <button className="btn btn-sm" onClick={() => setPopover(null)} disabled={busy !== null}>취소</button>
          </div>
        </div>
      )}
      {notice && <div className="mr-checkout-message">{notice}</div>}
      {error && <div className="mr-checkout-message mr-checkout-error">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 6: 툴바에 배치**

`src/ui/components/Toolbar.tsx`의 `ToolbarProps`에 `mrLink` 줄 아래로 추가한다.

```ts
  mrCheckout?: ReactNode
```

구조 분해 인자 목록의 `mrLink,` 아래에 `mrCheckout,`를 추가한다. JSX의 `{mrLink && (...)}` 블록 바로 아래에 추가한다.

```tsx
        {mrCheckout}
```

`src/ui/App.tsx`에 import를 추가한다.

```ts
import { MrCheckout } from './components/MrCheckout'
```

`<Toolbar>`의 `mrLink={...}` 줄 아래에 추가한다.

```tsx
        mrCheckout={comparison.mode === 'mr' && diffMr ? <MrCheckout key={diffMr.iid} iid={diffMr.iid} headSha={diffMr.headSha} /> : undefined}
```

- [ ] **Step 7: 스타일 추가**

`src/ui/styles/global.css`의 `.toolbar-mr-link:hover` 블록 아래에 추가한다.

```css
.mr-checkout {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
}

.mr-checkout .btn {
    gap: 4px;
}

.mr-checkout-done {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--success);
}

.mr-checkout-danger {
    color: var(--danger);
}

.mr-checkout-popover,
.mr-checkout-message {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 12px;
    white-space: normal;
}

.mr-checkout-popover {
    width: 360px;
    padding: 10px;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.mr-checkout-popover p {
    margin: 0;
}

.mr-checkout-files {
    margin: 0;
    padding-left: 16px;
    max-height: 160px;
    overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.mr-checkout-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
}

.mr-checkout-message {
    max-width: 360px;
    padding: 4px 8px;
    border-radius: 4px;
    z-index: 30;
}

.mr-checkout-error {
    border-color: var(--danger);
    color: var(--danger);
}
```

- [ ] **Step 8: 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모든 테스트 통과, tsc 출력 없음

- [ ] **Step 9: 커밋**

```bash
git add src/ui/reviewWorktree.ts src/ui/reviewWorktree.test.ts src/ui/hooks/useReviewWorktree.ts src/ui/components/MrCheckout.tsx src/ui/components/Toolbar.tsx src/ui/App.tsx src/ui/styles/global.css
git commit -m "feat: MR 모드 툴바에 체크아웃, 터미널 열기, worktree 삭제 버튼 추가"
```

---

### Task 6: 설정 팝오버 Terminal input과 README

**Files:**
- Modify: `src/ui/hooks/useSettings.ts`
- Modify: `src/ui/components/Toolbar.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 4의 `Settings.terminalApp`, `PUT /api/settings`
- Produces: `ToolbarProps.terminalApp: string`, `ToolbarProps.onTerminalAppChange: (app: string) => void`

- [ ] **Step 1: 클라이언트 설정에 terminalApp 추가**

`src/ui/hooks/useSettings.ts`의 `Settings`와 `DEFAULTS`에 추가한다.

```ts
export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap: boolean
  terminalApp: string
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
  softWrap: false,
  terminalApp: '',
}
```

서버 응답에 `terminalApp`이 없으면 input이 controlled에서 uncontrolled로 바뀌므로 기본값을 합친다. `setSettings(data)`를 바꾼다.

```ts
        setSettings({ ...DEFAULTS, ...data })
```

- [ ] **Step 2: 설정 팝오버에 input 추가**

`src/ui/components/Toolbar.tsx`의 `ToolbarProps`에 `onSoftWrapChange` 줄 아래로 추가한다.

```ts
  terminalApp: string
  onTerminalAppChange: (app: string) => void
```

구조 분해 인자 목록의 `onSoftWrapChange,` 아래에 `terminalApp,`, `onTerminalAppChange,`를 추가한다. 설정 팝오버의 `Default tab size` 블록(`<div className="settings-item settings-item-spaced">...</div>`) 바로 아래에 추가한다. 팝오버는 바깥 클릭 시 unmount되어 blur 시점 저장이 누락될 수 있으므로 입력할 때마다 저장한다.

```tsx
              <label className="settings-item settings-item-spaced">
                <span>Terminal</span>
                <input
                  className="settings-input"
                  value={terminalApp}
                  placeholder="Terminal"
                  onChange={(e) => onTerminalAppChange(e.target.value)}
                />
              </label>
```

`src/ui/App.tsx`의 `<Toolbar>`에서 `onSoftWrapChange={...}` 줄 아래에 추가한다.

```tsx
        terminalApp={settings.terminalApp}
        onTerminalAppChange={(terminalApp) => updateSettings({ terminalApp })}
```

- [ ] **Step 3: README 작성**

`README.md`의 `### GitLab MR 리뷰` 섹션에서 "`브랜치 비교` 탭에서 남긴 코멘트는 ..." 문단 아래에 추가한다.

```markdown
#### MR 코드 로컬에서 실행하기

MR 모드 툴바의 MR 제목 옆 버튼으로 MR 코드를 리뷰용 worktree에 체크아웃하고 터미널을 연다.

1. `체크아웃` 클릭 시 MR 소스 브랜치의 최신 커밋이 `~/.config/diffx/worktrees/<저장소명>-<해시>` 폴더에 detached HEAD로 체크아웃된다. 원본 저장소의 브랜치와 작업 중인 파일은 바뀌지 않는다.
2. 원본 저장소의 gitignore된 `.env*` 파일 중 worktree에 없는 파일이 복사된다. worktree에서 수정한 env 파일은 덮어쓰지 않는다.
3. `터미널에서 열기` 클릭 시 설정한 터미널 앱이 worktree 폴더에서 열린다. 터미널에서 `pnpm install`, `pnpm dev`를 직접 실행한다.
4. 다른 MR에서 `체크아웃`을 누르면 같은 폴더에서 커밋만 바뀐다. `node_modules`는 그대로 남고 실행 중인 개발서버에 변경이 반영된다.
5. worktree에서 git에 등록된 파일을 수정한 상태로 체크아웃하면 변경된 파일 목록이 나온다. `변경사항을 버리고 체크아웃` 클릭 시 수정 내용을 버리고 체크아웃한다.
6. `worktree 삭제` 클릭 후 `삭제`를 누르면 worktree 폴더가 삭제된다. 이 폴더에서 실행 중인 개발서버를 먼저 종료한다.

터미널 앱은 툴바 설정 팝오버의 `Terminal` input에 `/Applications`의 앱 이름(`iTerm`, `Warp`, `Ghostty`)으로 입력한다. 비워 두면 `Terminal`을 쓴다.
```

- [ ] **Step 4: 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모든 테스트 통과, tsc 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/ui/hooks/useSettings.ts src/ui/components/Toolbar.tsx src/ui/App.tsx README.md
git commit -m "feat: 설정 팝오버에 터미널 앱 입력 추가하고 README에 체크아웃 사용법 추가"
```

---

### Task 7: 사용자 실제 확인

에이전트는 앱을 실행하지 않는다. 아래 순서를 사용자에게 안내하고 결과를 받는다.

- [ ] **Step 1: 사용자에게 확인 요청**

사용자가 `pnpm run dev:app`으로 앱을 실행해 사내 GitLab MR 하나로 아래를 확인한다.

1. MR 선택 후 `체크아웃` 클릭 시 `체크아웃됨`으로 바뀌고 `~/.config/diffx/worktrees/`에 폴더가 생긴다.
2. `터미널에서 열기` 클릭 시 터미널 앱이 worktree 폴더에서 열린다. 설정 팝오버 `Terminal`에 `iTerm` 입력 후 다시 누르면 iTerm이 열린다.
3. 터미널에서 `pnpm install`, `pnpm dev`가 실행된다. env 파일이 복사되었으면 안내가 5초 동안 보인다.
4. 다른 MR을 선택하면 `체크아웃` 버튼이 다시 보이고, 누르면 같은 폴더에서 커밋이 바뀌어 개발서버에 반영된다.
5. worktree에서 파일을 수정한 뒤 `체크아웃` 클릭 시 변경 파일 목록 팝오버가 뜨고 `변경사항을 버리고 체크아웃`이 동작한다.
6. 개발서버를 종료하고 `worktree 삭제`, `삭제` 클릭 시 폴더가 사라지고 `체크아웃` 버튼만 남는다.
