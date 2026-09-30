# 작업 중 변경사항 모드와 CLI 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱에서 `작업 중 변경사항` 모드를 없애고 사용자용 CLI와 custom 모드를 제거한다. 앱은 `브랜치 비교`와 `MR` 모드만 남기고, 개발 스크립트는 `dev:app`, `dev:server`, `dev:client`와 빌드, 테스트만 남긴다.

**Architecture:** 서버의 비교 조합을 `branch`와 `mr` 두 가지로 줄이고, 그 외 요청은 `ComparisonError('missing_mode')`로 400을 돌려준다. CLI(`src/cli.ts`)는 지우고, `dev:server`는 새 `src/devServer.ts`로 토큰 없는 서버를 3433 포트에 띄운다. UI는 `Comparison` 타입에서 `worktree`를 빼고 첫 화면을 브랜치 비교 기본값으로 바꾼다.

**Tech Stack:** TypeScript, Hono, React 19, vitest, tsdown, electron-builder

**Spec:** `docs/superpowers/specs/2026-09-30-remove-worktree-mode-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다. `open`, `get-port`, `@changesets/cli`, `@changesets/changelog-git`는 제거한다.
- 남기는 스크립트: `dev:app`, `dev:server`, `dev:client`, `build:electron`, `build:app`, `test`, `test:watch`
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다.
- 오류 문구: "비교 방식을 선택해 주세요", "브랜치 목록을 불러오지 못했습니다: <오류>"
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 빌드: `pnpm run build:electron`. 작업 시작 시점에 테스트 269개가 통과한다.
- 작업 브랜치: 브랜치 정리(사용자 승인 필요) 후 정한다. 정리 전이면 현재 `feature/code-hyperlink`에서 이어 간다.

## Review Focus

1. 이전에 `작업 중 변경사항`을 마지막으로 연 사용자가 앱을 열면 오류 없이 브랜치 비교 기본값으로 시작해야 한다. Task 4 `loadComparison` 테스트 `ignores a saved worktree comparison`이 확인한다.
2. 기존 `~/.config/diffx/settings.json`에 `staged`, `untracked`, `browser`가 남아 있어도 설정 API 응답에 섞이지 않아야 한다. Task 1 `loadSettings` 테스트가 확인한다.
3. 코멘트 API를 `key` 없이 부르는 외부 도구(원본 diffx의 skill)가 `/api/diff`를 부르기 전이면 빈 목록을 받아야 한다. Task 1 서버 테스트 `returns no comments without a key before any diff`가 확인한다.
4. 브랜치 목록 조회가 실패해도 화면이 `Loading diff...`에 멈추지 않아야 한다. Task 4에서 `App.tsx`가 `MR` 탭으로 시작하고 안내 줄에 오류를 보여주도록 처리하고, Task 6 앱 확인 항목에 넣는다.
5. `dev:client`를 쓰는 개발자가 `dev:server`를 저장소 밖에서 실행하면 바로 원인을 알아야 한다. Task 3 `devServer` 테스트가 확인한다.

---

### Task 1: 서버의 비교 조합, 설정, git 함수 정리

**Files:**
- Modify: `src/comparison.ts`, `src/settings.ts`, `src/git.ts`, `src/server.ts`
- Test: `src/comparison.test.ts`, `src/git.test.ts`, `src/server.test.ts`, `src/server.definition.test.ts`, `src/settings.test.ts`(신규)

**Interfaces:**
- Produces:
  - `ComparisonError.code`에 `'missing_mode'` 추가
  - `ComparisonQuery = { mode?: string; source?: string; target?: string; iid?: string }`
  - `ResolvedComparison.mode: 'branch' | 'mr'`
  - `comparisonKey(q: { source: string; target: string }): string` (`branch:<target>...<source>`)
  - `resolveComparison(repo: string, q: ComparisonQuery, options?: { rangeDiff?: RangeDiff }): ResolvedComparison` (custom 인자 매개변수 삭제, `mode !== 'branch'`이면 `missing_mode`)
  - `Settings = { diffStyle: 'split' | 'unified'; defaultTabSize: number; softWrap?: boolean }` (기존 필드 중 `staged`, `untracked`, `browser` 삭제. `softWrap`이 기존에 있으면 유지)
  - `AppOptions`에서 `customDiffArgs`, `diffCwd` 삭제
  - `/api/repo` 응답 `{ root, name }`, `/api/diff` 응답에서 `untrackedFiles`, `customMode` 삭제

- [ ] **Step 1: 실패하는 테스트 작성**

`src/settings.test.ts`(신규). `settings.ts`가 `homedir()` 기준 경로를 쓰므로 테스트는 `HOME`을 임시 폴더로 바꾼 뒤 모듈을 동적으로 불러온다:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('loadSettings', () => {
  it('drops settings that no longer exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'diffx-home-'))
    mkdirSync(join(home, '.config', 'diffx'), { recursive: true })
    writeFileSync(join(home, '.config', 'diffx', 'settings.json'), JSON.stringify({ staged: false, untracked: false, browser: 'chrome', diffStyle: 'unified' }))
    vi.stubEnv('HOME', home)
    vi.resetModules()
    const { loadSettings } = await import('./settings')
    const settings = loadSettings()
    expect(settings.diffStyle).toBe('unified')
    expect(settings).not.toHaveProperty('staged')
    expect(settings).not.toHaveProperty('untracked')
    expect(settings).not.toHaveProperty('browser')
    vi.unstubAllEnvs()
  })
})
```

`settings.ts`의 `CONFIG_DIR`가 모듈 최상단에서 `homedir()`로 정해지므로, 동적 import 전에 `HOME`을 바꿔야 한다. `os.homedir()`는 macOS에서 `HOME` 환경변수를 먼저 읽는다.

`src/server.test.ts`에 추가(기존 `setupApp`을 쓴다):

```ts
describe('comparison mode is required', () => {
  it('rejects requests without a branch or mr mode', async () => {
    const { app } = setupApp()
    for (const path of ['/api/diff', '/api/diff?mode=worktree', '/api/file-content?path=a.txt&version=new', '/api/definition?path=a.txt&side=additions&line=1&col=0']) {
      const res = await app.request(path)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'missing_mode', message: '비교 방식을 선택해 주세요' })
    }
  })

  it('returns no comments without a key before any diff', async () => {
    const { app } = setupApp()
    expect(await (await app.request('/api/comments')).json()).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/settings.test.ts src/server.test.ts`
Expected: FAIL. settings 테스트는 `staged` 속성이 있어서, 서버 테스트는 `/api/diff`가 200(worktree)을 돌려줘서 실패한다.

- [ ] **Step 3: 구현**

`src/comparison.ts`:
- import를 `import { getMergeBase, getRangeDiff, resolveCommit } from './git.js'`로 바꾼다.
- `ComparisonQuery`에서 `staged`, `untracked`를 지운다. `queryFromSearch`에서도 두 필드를 지운다.
- `ResolvedComparison.mode`를 `'branch' | 'mr'`로 바꾼다.
- `ComparisonError`의 `code` 타입에 `'missing_mode'`를 추가한다.
- `comparisonKey`를 다음으로 바꾼다:

```ts
export function comparisonKey(q: { source: string; target: string }): string {
  return `branch:${q.target}...${q.source}`
}
```

- `ResolveOptions`에서 `diffCwd`를 지우고 `resolveComparison`을 다음으로 바꾼다:

```ts
export interface ResolveOptions {
  rangeDiff?: RangeDiff
}

export function resolveComparison(repo: string, q: ComparisonQuery, options: ResolveOptions = {}): ResolvedComparison {
  if (q.mode !== 'branch') throw new ComparisonError('missing_mode', '비교 방식을 선택해 주세요')
  const refs = resolveBranchRefs(repo, q)
  const rangeDiff = options.rangeDiff ?? getRangeDiff
  return {
    key: comparisonKey({ source: refs.source, target: refs.target }),
    mode: 'branch',
    patch: rangeDiff(repo, refs.mergeBase, refs.sourceSha),
    ...refs,
  }
}
```

`src/settings.ts`:

```ts
export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
}

function pick(value: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (value.diffStyle === 'split' || value.diffStyle === 'unified') out.diffStyle = value.diffStyle
  if (typeof value.defaultTabSize === 'number') out.defaultTabSize = value.defaultTabSize
  return out
}
```

`loadSettings`는 `{ ...DEFAULTS, ...pick(JSON.parse(data)) }`, `saveSettings`는 `{ ...current, ...pick(settings) }`로 바꾼다. UI 설정에 `softWrap`이 있으면(`src/ui/hooks/useSettings.ts` 확인) `Settings`와 `pick`에 `softWrap: boolean`을 같은 방식으로 추가한다.

`src/git.ts`에서 다음을 지운다: `getFileContent`, `isBinaryFile`, `getCustomGitDiff`, `getGitDiff`, `getUntrackedFilePaths`, `getUntrackedFilesDiff`, 그리고 이 함수들만 쓰던 import(`readFileSync` 등은 다른 함수가 쓰는지 확인 후).

`src/server.ts`:
- `AppOptions`에서 `customDiffArgs`, `diffCwd`를 지우고 `createApp` 구조 분해에서도 지운다.
- `isCustomMode`와 이를 쓰는 조건을 모두 지운다(`&& !isCustomMode`는 조건에서 빼고, custom 전용 분기는 삭제).
- `let activeKey: string | null = null`, `const keyFrom = (value: string | undefined) => value || activeKey`로 바꾸고, `/api/comments`와 `/api/viewed`에서 `keyFrom(...)`이 `null`이면 `[]` 또는 `{}`를 돌려준다. `POST /api/comments`와 `PUT /api/viewed`에서 키가 `null`이면 400 `{ error: 'missing_key' }`를 돌려준다.
- `resolveOptions`를 `{ rangeDiff: createRangeDiffCache() }`로, `resolveFromRequest`의 마지막 줄을 `return resolveComparison(repo, q, resolveOptions)`로 바꾼다.
- `/api/diff`: `untracked`, `untrackedFiles` 계산을 지우고 `parseBinaryFiles(patch)`로 호출한다. 응답에서 `customMode`, `untrackedFiles`를 지운다. `parseBinaryFiles`의 `untrackedFiles` 매개변수와 `'untracked'` 분기, `BinaryFileInfo.type`의 `'untracked'`를 지운다.
- `/api/file-content`: 모드가 `branch`나 `mr`가 아니면 `comparisonErrorResponse(c, new ComparisonError('missing_mode', '비교 방식을 선택해 주세요'))`를 돌려주고 `getFileContent` 분기를 지운다.
- `/api/file-versions`: `newContent` 계산에서 `?? getWorktreeFileContent(repo, path)`를 지운다.
- `/api/definition`의 `readerFor`: 마지막 세 줄(worktree reader, HEAD reader)을 `throw new ComparisonError('missing_mode', '비교 방식을 선택해 주세요')`로 바꾼다. 반환 타입을 `Promise<SourceReader>`로 바꾸고 `if (!reader)` 분기를 지운다. `worktreeReader` import를 지운다.
- `/api/repo`: `{ root: repo, name: getRepoName(repo) }`를 돌려준다.
- `POST /api/review`: 본문 타입에서 `staged`, `untracked`를 지우고 `resolveComparison(repo, { mode: body.mode, source: body.source, target: body.target }, resolveOptions)`로 부른다. `ctx`에서 `mode`, `customArgs`, `staged`를 Task 2 인터페이스에 맞춘다(`mode: 'branch'`, `customArgs`와 `staged` 삭제, `sourceCheckedOut: getHeadSha(repo) === resolved.sourceSha`).
- import에서 `getFileContent`, `getWorktreeFileContent`, `getUntrackedFilePaths`, `comparisonKey`(더 쓰지 않으면)를 지운다.

- [ ] **Step 4: 기존 테스트 변환**

각 파일에서 다음 규칙으로 고친다.

- `src/comparison.test.ts`: worktree와 custom 케이스를 지우고, `comparisonKey`를 `{ source, target }`로 부른다. `resolveComparison(repo, undefined, q)` 형태의 호출은 `resolveComparison(repo, q)`로 바꾼다. `mode` 없는 호출이 `missing_mode`를 던지는 케이스를 하나 둔다.
- `src/git.test.ts`: `reads branch and diff of the given repo regardless of process.cwd()`에서 `getGitDiff` 부분을 지우고 브랜치 이름과 저장소 이름 확인만 남긴다. `prints paths unquoted in diffs and untracked lists`는 `getRangeDiff`로 한글 경로가 따옴표 없이 나오는지만 확인하도록 바꾼다.
- `src/server.test.ts`:
  - `returns repo info and branch lists`의 기대값을 `{ root: repo, name: ... }`로 바꾼다.
  - `worktree mode keeps reading the worktree for the new version`을 지운다.
  - `separates comments per key and defaults to the last diffed key`와 `separates viewed state per key`에서 worktree 조합을 두 번째 브랜치 조합(`mode=branch&source=main&target=origin/main`)으로 바꾼다.
  - `runs custom git diff args from diffCwd so pathspecs are relative to it`를 지운다. `setupApp`의 `customDiffArgs` 매개변수를 지운다.
- `src/server.definition.test.ts`: `uses the working tree and HEAD in worktree mode`를 지우고, `mode` 없는 요청이 400인 케이스를 `rejects invalid queries`의 목록에 추가한다.

- [ ] **Step 5: 테스트, 타입 검사**

Run: `pnpm exec vitest run src/settings.test.ts src/server.test.ts src/comparison.test.ts src/git.test.ts src/server.definition.test.ts src/server.gitlab.test.ts`
Expected: PASS. `pnpm exec tsc --noEmit -p .`는 Task 2~4가 끝날 때까지 `src/review/`, `src/cli.ts`, `src/ui/`에서 오류가 날 수 있다. 이 Task에서는 서버 쪽 파일(`src/server.ts`, `src/comparison.ts`, `src/git.ts`, `src/settings.ts`)에 오류가 없는지만 본다.

- [ ] **Step 6: 커밋**

```bash
git add src/comparison.ts src/comparison.test.ts src/settings.ts src/settings.test.ts src/git.ts src/git.test.ts src/server.ts src/server.test.ts src/server.definition.test.ts
git commit -m "refactor: 서버에서 작업 중 변경사항과 custom 비교 모드 제거"
```

---

### Task 2: AI 리뷰에서 작업 트리와 custom 모드 제거

**Files:**
- Modify: `src/review/types.ts`, `src/review/prompt.ts`, `src/review/runner.ts`, `src/review/fingerprint.ts`
- Test: `src/review/prompt.test.ts`, `src/review/runner.test.ts`, `src/review/jobs.test.ts`, `src/review/store.test.ts`, `src/review/providers/claude.test.ts`, `src/server.review.test.ts`

**Interfaces:**
- Consumes: `ResolvedComparison.mode: 'branch' | 'mr'` (Task 1)
- Produces: `ReviewContext = { repoPath: string; mode: 'branch'; source: string; target: string; mergeBase: string; sourceCheckedOut: boolean; files: string[]; patch: string; instruction?: string }`

- [ ] **Step 1: 테스트 변환(먼저)**

- `prompt.test.ts`: worktree와 custom 케이스를 지운다. 남은 케이스는 기존 `base`(branch)를 쓴다. 다음 케이스를 추가한다:

```ts
  it('does not mention the working tree', () => {
    expect(buildPrompt(base)).not.toContain('작업 트리의 커밋하지 않은 변경사항')
  })
```

- `runner.test.ts`, `jobs.test.ts`, `store.test.ts`, `providers/claude.test.ts`: `mode: 'worktree'`인 `ReviewContext`를 `{ repoPath, mode: 'branch', source: 'feature/x', target: 'main', mergeBase: 'abc123', sourceCheckedOut: true, files, patch }`로 바꾼다.
- `server.review.test.ts`: `passes staged to the review context in worktree mode`를 지운다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/review src/server.review.test.ts`
Expected: `does not mention the working tree`는 통과할 수 있지만 `tsc`는 `ReviewContext`의 `source` 필수화 전이라 통과한다. 타입 변경 전후를 확인하기 위해 Step 3 뒤 `tsc`로 검증한다.

- [ ] **Step 3: 구현**

`src/review/types.ts`의 `ReviewContext`를 Interfaces의 형태로 바꾼다(`customArgs`, `staged` 삭제, `mode: 'branch'`, `source`, `target`, `mergeBase` 필수).

`src/review/prompt.ts`:

```ts
function describeComparison(ctx: ReviewContext): string {
  return [
    `비교 대상: ${ctx.target}...${ctx.source} (GitLab MR과 같은 방식)`,
    `- 소스 브랜치: ${ctx.source}`,
    `- 타겟 브랜치: ${ctx.target}`,
    `- merge-base 커밋: ${ctx.mergeBase}`,
  ].join('\n')
}

function fileReadingGuide(ctx: ReviewContext): string {
  if (!ctx.sourceCheckedOut) {
    return `소스 브랜치가 체크아웃되어 있지 않아서 작업 트리의 파일은 리뷰 대상과 다를 수 있습니다. 파일 전체 내용은 \`git show ${ctx.source}:<경로>\`로 읽으세요.`
  }
  return '작업 트리의 파일이 리뷰 대상 코드와 같습니다. 파일을 직접 읽어도 됩니다.'
}

function diffCommand(ctx: ReviewContext): string {
  return `git diff ${ctx.mergeBase} ${ctx.source} -- <경로>`
}
```

`src/review/runner.ts`의 `PROBE_CONTEXT`:

```ts
const PROBE_CONTEXT: ReviewContext = { repoPath: process.cwd(), mode: 'branch', source: 'HEAD', target: 'HEAD', mergeBase: 'HEAD', sourceCheckedOut: true, files: [], patch: '' }
```

`src/review/fingerprint.ts`: 모든 모드가 sha를 가지므로 `return \`${resolved.sourceSha}:${resolved.targetSha}\``만 남기고 `createHash` import를 지운다.

`src/server.ts`의 `POST /api/review` `ctx`에서 `source: resolved.source!`, `target: resolved.target!`, `mergeBase: resolved.mergeBase!`로 쓴다.

- [ ] **Step 4: 테스트와 타입 검사**

Run: `pnpm exec vitest run src/review src/server.review.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/review src/server.ts src/server.review.test.ts
git commit -m "refactor: AI 리뷰에서 작업 트리와 custom 모드 제거"
```

---

### Task 3: CLI 제거와 개발용 서버

**Files:**
- Create: `src/devServer.ts`
- Delete: `src/cli.ts`, `.changeset/`
- Modify: `package.json`, `tsdown.config.ts`, `pnpm-lock.yaml`(의존성 제거 결과)
- Test: `src/devServer.test.ts`

**Interfaces:**
- Consumes: `startServer(options: StartOptions)` (`src/server.ts`, Task 1에서 `customDiffArgs`, `diffCwd` 삭제됨), `isGitRepo`, `getRepoRoot` (`src/git.ts`)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/devServer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('devServer', () => {
  it('exits with 1 outside a git repository', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-nogit-')))
    const res = spawnSync(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'src/devServer.ts')], { cwd: dir, encoding: 'utf-8' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('git 저장소가 아닙니다')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/devServer.test.ts`
Expected: FAIL (`src/devServer.ts` 없음으로 tsx가 다른 오류 문구로 종료)

- [ ] **Step 3: 구현**

`src/devServer.ts`:

```ts
import { resolve } from 'node:path'
import { getRepoRoot, isGitRepo } from './git.js'
import { startServer } from './server.js'

const PORT = 3433

if (!isGitRepo(process.cwd())) {
  console.error('git 저장소가 아닙니다. 저장소 폴더에서 실행해 주세요.')
  process.exit(1)
}

const repoPath = getRepoRoot(process.cwd())
const clientDir = resolve(process.cwd(), 'dist/client')
const { close } = await startServer({ repoPath, clientDir, port: PORT, host: '127.0.0.1' })
console.log(`개발용 서버: http://127.0.0.1:${PORT} (${repoPath})`)

const shutdown = async () => {
  await Promise.race([close(), new Promise((r) => setTimeout(r, 1000))])
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
```

`package.json`:
- `scripts`를 다음으로 바꾼다:

```json
  "scripts": {
    "dev:app": "pnpm run build:electron && electron .",
    "dev:server": "tsx src/devServer.ts",
    "dev:client": "vite",
    "build:electron": "vite build && tsdown",
    "build:app": "pnpm run build:electron && electron-builder --mac zip --arm64",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- `bin`, `files` 필드를 지운다.
- 의존성 제거: `pnpm remove open get-port @changesets/cli @changesets/changelog-git`

`tsdown.config.ts`에서 첫 번째 항목(`entry: ['src/cli.ts']`)을 지운다.

`src/cli.ts`와 `.changeset/` 폴더를 지운다: `git rm -r src/cli.ts .changeset`

- [ ] **Step 4: 테스트, 타입 검사, 빌드**

Run: `pnpm exec vitest run src/devServer.test.ts && pnpm run build:electron`
Expected: PASS, 빌드 성공. `dist/cli.mjs`가 새로 생기지 않는다(기존 파일은 `dist`가 git에 없으므로 무시한다).

- [ ] **Step 5: 커밋**

```bash
git add -A src/devServer.ts src/devServer.test.ts package.json pnpm-lock.yaml tsdown.config.ts
git commit -m "refactor: 사용자용 CLI를 제거하고 개발용 서버 스크립트로 대체"
```

---

### Task 4: UI에서 작업 중 변경사항과 custom 모드 제거

**Files:**
- Modify: `src/ui/comparison.ts`, `src/ui/gitlab.ts`, `src/ui/App.tsx`, `src/ui/components/BranchPicker.tsx`, `src/ui/components/Toolbar.tsx`, `src/ui/components/FileTree.tsx`, `src/ui/components/BinaryFileDiff.tsx`, `src/ui/hooks/useDiff.ts`, `src/ui/hooks/useRepo.ts`, `src/ui/hooks/useSettings.ts`, `src/ui/hooks/useReview.ts`
- Test: `src/ui/comparison.test.ts`, `src/ui/gitlab.test.ts`, `src/ui/hooks/useReview.test.ts`

**Interfaces:**
- Consumes: `/api/repo` 응답 `{ root, name }`, `/api/diff` 응답에서 `untrackedFiles`, `customMode` 삭제 (Task 1)
- Produces:
  - `type Comparison = { mode: 'branch'; source: string; target: string } | { mode: 'mr'; iid: number | null }`
  - `comparisonParams(c: Comparison): URLSearchParams | null`
  - `reconcileComparison(saved: Comparison | null, branches: BranchInfo): { comparison: Comparison; missing: string[] }` (저장값이 없으면 `defaultBranchComparison(branches)`)
  - `reconcileMrAvailability(c: Comparison, status: GitlabStatus | undefined, branches: BranchInfo): { comparison: Comparison; notice: string | null }`

- [ ] **Step 1: 실패하는 테스트 작성과 기존 테스트 변환**

`src/ui/comparison.test.ts`:
- `comparisonParams` 테스트의 worktree 케이스를 지우고 두 번째 인자(`{ staged, untracked }`)를 모두 뺀다.
- `defaults to worktree when nothing is saved`를 다음으로 바꾼다:

```ts
  it('defaults to the branch comparison when nothing is saved', () => {
    expect(reconcileComparison(null, branches)).toEqual({ comparison: { mode: 'branch', source: 'feature/x', target: 'origin/main' }, missing: [] })
  })
```

- `load/saveComparison`에 추가:

```ts
  it('ignores a saved worktree comparison', () => {
    const s = memoryStorage()
    s.setItem('diffx-comparison:/repo/a', JSON.stringify({ mode: 'worktree' }))
    expect(loadComparison('/repo/a', s)).toBeNull()
  })
```

`src/ui/gitlab.test.ts`의 `reconcileMrAvailability` 테스트는 세 번째 인자로 `branches`(위와 같은 값)를 넘기고, glab을 쓸 수 없을 때 기대값을 `{ comparison: { mode: 'branch', source: 'feature/x', target: 'origin/main' }, notice: '원격 저장소가 GitLab이 아닙니다' }`로 바꾼다. `ignores other modes` 케이스는 브랜치 비교 입력으로 바꾼다.

`src/ui/hooks/useReview.test.ts`: `staged`, `untracked` 파라미터를 쓰는 부분을 브랜치 파라미터로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec vitest run src/ui`
Expected: FAIL (`defaults to the branch comparison`, `ignores a saved worktree comparison`, `reconcileMrAvailability`)

- [ ] **Step 3: 구현**

`src/ui/comparison.ts`:

```ts
export type Comparison = { mode: 'branch'; source: string; target: string } | { mode: 'mr'; iid: number | null }

export function comparisonParams(c: Comparison): URLSearchParams | null {
  if (c.mode === 'mr') return c.iid === null ? null : new URLSearchParams({ mode: 'mr', iid: String(c.iid) })
  return new URLSearchParams({ mode: 'branch', source: c.source, target: c.target })
}
```

- `loadComparison`에서 `worktree` 분기를 지운다(저장값이 `worktree`면 마지막 `return null`에 도달한다).
- `defaultBranchComparison`의 반환 타입을 `Extract<Comparison, { mode: 'branch' }>`로 바꾼다.
- `reconcileComparison` 첫 줄을 `if (!saved) return { comparison: defaultBranchComparison(branches), missing: [] }`로 바꾼다. 이후 `as { mode: 'branch'; ... }` 단언을 지운다.

`src/ui/gitlab.ts`:

```ts
export function reconcileMrAvailability(c: Comparison, status: GitlabStatus | undefined, branches: BranchInfo): { comparison: Comparison; notice: string | null } {
  if (c.mode !== 'mr' || !status || status.available) return { comparison: c, notice: null }
  return { comparison: defaultBranchComparison(branches), notice: gitlabUnavailableMessage(status) }
}
```

`BranchInfo`는 `src/ui/comparison.ts`에서 export해서 가져온다.

`src/ui/App.tsx`:
- 비교 조합 복원 effect를 다음으로 바꾼다:

```tsx
  useEffect(() => {
    if (!repo) return
    if (!branches) {
      if (branchesError) {
        setNotice(`브랜치 목록을 불러오지 못했습니다: ${branchesError}`)
        if (!comparison) setComparison({ mode: 'mr', iid: null })
      }
      return
    }
    const base = comparison ?? loadComparison(repo.root)
    const { comparison: reconciled, missing } = reconcileComparison(base, branches)
    const { comparison: next, notice: mrNotice } = reconcileMrAvailability(reconciled, gitlab.status, branches)
    if (missing.length > 0) setNotice(`저장된 브랜치 ${missing.join(', ')}을 찾지 못해 기본값으로 바꿨습니다`)
    if (mrNotice) setNotice(mrNotice)
    if (JSON.stringify(next) !== JSON.stringify(comparison)) setComparison(next)
  }, [repo, branches, branchesError, gitlab.status])
```

- `const branchMode = !!repo && !repo.customMode`를 `const branchMode = !!repo`로 바꾼다.
- `params`를 `useMemo(() => (comparison ? comparisonParams(comparison) : null), [comparison])`로 바꾼다.
- `useDiff` 구조 분해에서 `untrackedFiles`를 지우고 `untrackedSet`, `FileTree`의 `untrackedFiles` prop, 바이너리 합성 파일의 `bf.type === 'untracked'` 조건을 지운다.
- `Toolbar`에 넘기던 `showWorktreeOptions`, `diffOptions`, `onDiffOptionsChange`, `browser`, `onBrowserChange`를 지운다. `branchPicker`는 `repo.customMode ? undefined : (...)` 조건 없이 항상 넘긴다.

`src/ui/components/BranchPicker.tsx`: `작업 중 변경사항` 버튼을 지운다. `브랜치 비교` 버튼의 `switchToBranch`는 그대로 둔다.

`src/ui/components/Toolbar.tsx`: props와 설정 메뉴에서 `showWorktreeOptions`, `diffOptions`, `onDiffOptionsChange`, `browser`, `onBrowserChange`와 `Show staged`, `Show untracked`, `Browser` 항목을 지운다. `DiffOptions` import를 지운다.

`src/ui/components/FileTree.tsx`: `untrackedFiles` prop과 `inferChangeType`의 untracked 분기, `FileQuestion` 아이콘 분기를 지운다.

`src/ui/components/BinaryFileDiff.tsx`: `'untracked'` 비교를 지운다.

`src/ui/hooks/useDiff.ts`: `DiffData`에서 `untrackedFiles`, `customMode`를 지우고, `mode` 타입을 `'branch' | 'mr'`로, `BinaryFileInfo.type`에서 `'untracked'`를 지운다. `DiffOptions` export를 지운다.

`src/ui/hooks/useRepo.ts`: 응답 타입에서 `customMode`를 지운다.

`src/ui/hooks/useSettings.ts`: `staged`, `untracked`, `browser`를 지운다.

`src/ui/hooks/useReview.ts`: 요청 본문의 `staged`, `untracked`를 지우고 `body: JSON.stringify({ provider, ...Object.fromEntries(params), exclude, instruction })`로 바꾼다. `작업 트리 모드는 ...` 주석과 그 주석이 설명하던 쿼리 키 처리(요청 파라미터를 query key에 넣는 부분)는 브랜치와 MR 키만 남으므로 `key`만 쓰도록 단순화한다. 단순화가 `useReview.test.ts`와 충돌하면 기존 동작을 유지하고 ledger에 Ruling으로 남긴다.

- [ ] **Step 4: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build:electron`
Expected: 모두 성공

- [ ] **Step 5: 커밋**

```bash
git add src/ui
git commit -m "refactor: 앱에서 작업 중 변경사항 탭과 staged, untracked, 브라우저 설정 제거"
```

---

### Task 5: README 정리

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 수정**

- `## Install`, `## Usage`(하위 `### Options` 포함), `## Agent Skills` 섹션을 지운다.
- `## Features`에서 `Staged / Untracked toggles`, `Custom diff commands` 항목을 지운다.
- `## macOS 데스크톱 앱` 섹션 뒤에 추가:

```markdown
## 개발

| 명령 | 용도 |
|---|---|
| `pnpm run dev:app` | UI와 Electron 코드를 빌드하고 데스크톱 앱을 띄운다. 코드를 고치면 앱을 다시 실행해야 반영된다 |
| `pnpm run dev:server` | 현재 폴더의 저장소로 3433 포트에 개발용 서버를 띄운다. 브라우저는 열지 않는다 |
| `pnpm run dev:client` | vite 개발 서버를 띄운다. `/api` 요청을 `dev:server`로 넘기며, UI 코드를 저장하면 브라우저에 바로 반영된다 |
| `pnpm run build:app` | 배포용 `.app`과 zip을 만든다 |
| `pnpm test` | 테스트를 실행한다 |

UI를 고칠 때는 터미널 두 개에서 `dev:server`와 `dev:client`를 함께 띄우고 vite가 출력한 주소를 브라우저로 연다.
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: CLI 사용법을 지우고 개발 스크립트 안내 추가"
```

---

### Task 6: 앱 확인 (사용자가 실행)

- [ ] **Step 1: 사용자에게 `pnpm run dev:app` 실행을 요청하고 다음을 함께 확인한다**

1. 저장소를 열면 모드 탭이 `브랜치 비교 / MR` 두 개이고 `브랜치 비교`(소스: 현재 브랜치, 타겟: 기본 브랜치)로 시작한다.
2. 이전에 `작업 중 변경사항`을 마지막으로 연 저장소를 열어도 오류 없이 `브랜치 비교`로 시작한다.
3. 툴바 설정 메뉴에 `Show staged`, `Show untracked`, `Browser`가 없다.
4. `MR` 탭, AI 리뷰, 코드 하이퍼링크가 이전과 같이 동작한다.
5. 브랜치 목록 조회가 실패하는 경우 `MR` 탭으로 시작하고 모드 탭 아래에 "브랜치 목록을 불러오지 못했습니다: …"가 보인다. `Loading diff...`에 멈추지 않는다.
