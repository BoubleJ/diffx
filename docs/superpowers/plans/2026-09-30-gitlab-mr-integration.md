# GitLab MR 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱에서 GitLab MR 목록을 조회해 MR diff를 열고, diff 줄 코멘트와 기존 discussion 답글을 GitLab Draft Notes로 올린 뒤 `리뷰 제출`로 한 번에 공개한다.

**Architecture:** 서버가 `glab api`를 저장소 경로에서 실행해 GitLab을 호출한다(`src/gitlab/`). MR diff는 MR 커밋을 로컬로 fetch한 뒤 기존 브랜치 비교와 같은 `git diff <base_sha> <head_sha>`로 만들고 비교 조합 키 `mr:<iid>`로 구분한다. UI는 모드 탭에 `MR`을 추가하고 MR 모드에서만 코멘트를 `/api/gitlab/mrs/:iid/*`로 주고받는다.

**Tech Stack:** TypeScript, Hono, React 19, @tanstack/react-query, @pierre/diffs, vitest, glab CLI 1.89

**Spec:** `docs/superpowers/specs/2026-09-30-gitlab-mr-integration-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- GitLab 호출은 모두 `glab api`로 하고 경로는 `projects/:fullpath/...` 자리표시를 쓴다. 앱은 토큰을 저장하지 않는다.
- 작업 브랜치는 `main`에서 만든 `feature/gitlab-mr`이다. `develop` 브랜치에는 커밋, 머지, 푸시하지 않는다.
- 커밋 메시지는 한글로 쓰고 type prefix(`feat:`, `fix:`, `test:`, `docs:`)만 영문으로 쓴다. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 코드만으로 이유가 드러나지 않는 곳에만 단다. 이 계획에 적힌 주석 외에 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱(`pnpm run dev:app`, `dev:client`, `dev:server`)은 사용자가 직접 실행한다. 에이전트가 띄우지 않는다.
- UI 문구는 spec에 적힌 한국어 문구를 그대로 쓴다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 두 명령 모두 작업 시작 시점에 통과한다(테스트 150개).

## Review Focus

1. MR에 새 커밋이 push된 뒤 새로고침하면 새 `head_sha`의 커밋을 fetch하고 새 diff를 보여줘야 한다. Task 3 서버 테스트 `picks up new commits pushed to the MR`가 확인한다.
2. 머지 후 타겟 브랜치가 삭제된 MR도 열려야 한다. Task 3 `ensureMrCommits` 테스트 `falls back to fetching the base sha when the target branch is gone`가 확인한다.
3. 전체 파일 펼치기로 보이는 hunk 밖의 줄에 코멘트를 달아도 GitLab position의 `old_line`과 `new_line`이 맞아야 한다. Task 4 `locateLine` 테스트의 hunk 밖 줄 케이스가 확인한다.
4. 원격이 GitLab이 아닐 때 glab 메시지에 `glab auth login`이 들어 있어도 `auth`가 아니라 `not_gitlab`으로 안내해야 한다. Task 1 `classifyGlabError` 테스트가 확인한다.
5. 마지막으로 연 MR을 저장해 둔 상태에서 다음 실행 때 glab 로그인이 풀려 있으면 `작업 중 변경사항`으로 돌아가고 이유를 보여줘야 한다. Task 6 `reconcileMrAvailability` 테스트가 확인한다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/gitlab/glab.ts` (신규) | `glab api` 실행, 오류 분류(`GlabError`) |
| `src/gitlab/mr.ts` (신규) | 원격 URL 해석, GitLab 상태 확인, MR 목록, MR 상세, MR 커밋 fetch |
| `src/gitlab/mrComparison.ts` (신규) | iid 검사, MR 상세 캐시, `mr` 비교 조합 생성 |
| `src/gitlab/position.ts` (신규) | patch에서 diff 줄을 GitLab position으로 변환 |
| `src/gitlab/notes.ts` (신규) | discussion과 draft note를 `ReviewComment`로 변환 |
| `src/gitlab/__fixtures__/fake-glab.mjs` (신규) | glab 실행부 테스트용 가짜 CLI |
| `src/test/fakeGlab.ts` (신규) | 서버 테스트용 가짜 `GlabClient` |
| `src/test/mrRepo.ts` (신규) | MR ref가 있는 원격 저장소와 clone을 만드는 테스트 도우미 |
| `src/git.ts` | `listRemotes`, `hasCommit`, `fetchRefs` 추가 |
| `src/comparison.ts` | `mode: 'mr'`, `iid` 쿼리 추가 |
| `src/review/fingerprint.ts` | `mr` 모드를 sha 기준으로 계산 |
| `src/types.ts` | `ReviewComment.origin`, `author`, `discussionId`, `CommentReply.author`, `draft` |
| `src/server.ts` | `/api/gitlab/*`, 기존 API의 `mode=mr` 처리 |
| `src/ui/gitlab.ts` (신규) | 안내 문구, MR 모드 복원 판단 |
| `src/ui/mrFilterStorage.ts` (신규) | MR 목록 필터 localStorage 저장 |
| `src/ui/hooks/useGitlab.ts` (신규) | GitLab 상태, MR 목록 조회 |
| `src/ui/hooks/useMrComments.ts` (신규) | MR 코멘트 조회, 초안 작성과 삭제, 리뷰 제출 |
| `src/ui/components/MrSelect.tsx` (신규) | MR 선택 드롭다운 |
| `src/ui/comparison.ts`, `BranchPicker.tsx`, `App.tsx`, `Toolbar.tsx`, `useDiff.ts`, `useComments.ts`, `FileDiffCard.tsx`, `DiffViewer.tsx`, `CommentBubble.tsx`, `CommentForm.tsx`, `CommentTracker.tsx`, `global.css` | MR 모드 UI |

---

### Task 0: 작업 브랜치 만들기

- [ ] **Step 1: 브랜치 생성**

```bash
git switch main
git switch -c feature/gitlab-mr
```

- [ ] **Step 2: 기준 상태 확인**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: `Tests  150 passed`, tsc 출력 없음

---

### Task 1: glab 실행부

**Files:**
- Create: `src/gitlab/glab.ts`
- Create: `src/gitlab/__fixtures__/fake-glab.mjs`
- Test: `src/gitlab/glab.test.ts`

**Interfaces:**
- Produces:
  - `type GlabErrorKind = 'not_installed' | 'auth' | 'not_gitlab' | 'api'`
  - `class GlabError extends Error { kind: GlabErrorKind }`
  - `interface GlabRequest { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; paginate?: boolean }`
  - `type GlabClient = (path: string, request?: GlabRequest) => Promise<unknown>` (빈 응답은 `null`)
  - `createGlabClient(repoPath: string, options?: { bin?: string; prefixArgs?: string[]; timeoutMs?: number; env?: NodeJS.ProcessEnv }): GlabClient`
  - `classifyGlabError(stderr: string): GlabError`
  - `glabArgs(path: string, request?: GlabRequest): string[]`

- [ ] **Step 1: 가짜 glab 작성**

`src/gitlab/__fixtures__/fake-glab.mjs`:

```js
// 테스트용 glab. FAKE_GLAB_MODE 환경변수로 동작을 고른다.
const mode = process.env.FAKE_GLAB_MODE

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  if (mode === 'echo') {
    console.log(JSON.stringify({ args, stdin, cwd: process.cwd() }))
  } else if (mode === 'empty') {
    process.exit(0)
  } else if (mode === 'not_gitlab') {
    console.error('\n   ERROR  \n\n  Unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab\n  host. Please use `glab auth login` to authenticate and configure a new host for glab.\n')
    process.exit(1)
  } else if (mode === 'auth') {
    console.error('\n   ERROR  \n\n  Unauthenticated.\n')
    process.exit(1)
  } else if (mode === 'not_found') {
    console.log('{"message":"404 Project Not Found"}')
    console.error('glab: 404 Project Not Found (HTTP 404)')
    process.exit(1)
  } else if (mode === 'garbage') {
    console.log('not json')
  } else if (mode === 'hang') {
    setInterval(() => {}, 1000)
  }
})
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/gitlab/glab.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { createGlabClient, classifyGlabError, glabArgs, GlabError } from './glab'

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-glab.mjs', import.meta.url))
const CWD = realpathSync(tmpdir())

const client = (mode: string, timeoutMs?: number) =>
  createGlabClient(CWD, { bin: process.execPath, prefixArgs: [FAKE], timeoutMs, env: { ...process.env, FAKE_GLAB_MODE: mode } })

async function failure(p: Promise<unknown>): Promise<GlabError> {
  try {
    await p
  } catch (err) {
    if (err instanceof GlabError) return err
    throw err
  }
  throw new Error('expected failure')
}

describe('glabArgs', () => {
  it('builds GET, paginate and body args', () => {
    expect(glabArgs('projects/:fullpath')).toEqual(['api', 'projects/:fullpath', '-X', 'GET'])
    expect(glabArgs('x', { paginate: true })).toEqual(['api', 'x', '-X', 'GET', '--paginate'])
    expect(glabArgs('x', { method: 'POST', body: {} })).toEqual(['api', 'x', '-X', 'POST', '--input', '-', '-H', 'Content-Type: application/json'])
  })
})

describe('classifyGlabError', () => {
  it('treats the remote detection message as not_gitlab even though it mentions auth login', () => {
    const err = classifyGlabError('\n   ERROR  \n\n  Unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab\n  host. Please use `glab auth login` to authenticate and configure a new host for glab.\n')
    expect(err.kind).toBe('not_gitlab')
    expect(err.message).toBe('Unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab host. Please use `glab auth login` to authenticate and configure a new host for glab.')
  })

  it('treats a repo without remotes as not_gitlab', () => {
    expect(classifyGlabError('ERROR\nUnable to expand placeholder in path: no git remotes found.').kind).toBe('not_gitlab')
  })

  it('detects auth failures', () => {
    expect(classifyGlabError('\n   ERROR  \n\n  Unauthenticated.\n').kind).toBe('auth')
    expect(classifyGlabError('glab: 401 Unauthorized (HTTP 401)').kind).toBe('auth')
  })

  it('falls back to api with the cleaned message', () => {
    const err = classifyGlabError('glab: 404 Project Not Found (HTTP 404)\n')
    expect(err.kind).toBe('api')
    expect(err.message).toBe('glab: 404 Project Not Found (HTTP 404)')
  })
})

describe('createGlabClient', () => {
  it('runs in the repo directory and passes the body on stdin', async () => {
    const out = await client('echo')('projects/:fullpath/draft_notes', { method: 'POST', body: { note: '안녕' } }) as { args: string[]; stdin: string; cwd: string }
    expect(out.args).toEqual(['api', 'projects/:fullpath/draft_notes', '-X', 'POST', '--input', '-', '-H', 'Content-Type: application/json'])
    expect(JSON.parse(out.stdin)).toEqual({ note: '안녕' })
    expect(out.cwd).toBe(CWD)
  })

  it('returns null for an empty response', async () => {
    expect(await client('empty')('x', { method: 'DELETE' })).toBeNull()
  })

  it('classifies failures', async () => {
    expect((await failure(client('not_gitlab')('x'))).kind).toBe('not_gitlab')
    expect((await failure(client('auth')('x'))).kind).toBe('auth')
    expect((await failure(client('not_found')('x'))).kind).toBe('api')
    expect((await failure(client('garbage')('x'))).message).toBe('GitLab 응답을 JSON으로 읽지 못했습니다')
  })

  it('reports a missing binary as not_installed', async () => {
    const missing = createGlabClient(CWD, { bin: 'glab-does-not-exist-xyz' })
    expect(await failure(missing('x'))).toMatchObject({ kind: 'not_installed', message: 'glab이 설치되어 있지 않습니다' })
  })

  it('stops after the timeout', async () => {
    expect(await failure(client('hang', 300)('x'))).toMatchObject({ kind: 'api', message: 'GitLab 응답이 0.3초 안에 오지 않았습니다' })
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/glab.test.ts`
Expected: FAIL, `Failed to resolve import "./glab"`

- [ ] **Step 4: 구현**

`src/gitlab/glab.ts`:

```ts
import { execFile } from 'node:child_process'

export type GlabErrorKind = 'not_installed' | 'auth' | 'not_gitlab' | 'api'

export class GlabError extends Error {
  constructor(public kind: GlabErrorKind, message: string) {
    super(message)
  }
}

export interface GlabRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  paginate?: boolean
}

export type GlabClient = (path: string, request?: GlabRequest) => Promise<unknown>

export interface GlabClientOptions {
  bin?: string
  prefixArgs?: string[]
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

function cleanGlabMessage(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'ERROR')
    .join(' ')
}

export function classifyGlabError(stderr: string): GlabError {
  const message = cleanGlabMessage(stderr) || 'glab 실행에 실패했습니다'
  // 원격 판별 실패 메시지에도 `glab auth login` 안내가 들어 있어서 인증 오류보다 먼저 확인한다.
  if (/no git remotes|point to a known GitLab host/i.test(message)) return new GlabError('not_gitlab', message)
  if (/\b401\b|Unauthenticated|Unauthorized|not logged in|no token found/i.test(message)) return new GlabError('auth', message)
  return new GlabError('api', message)
}

export function glabArgs(path: string, request: GlabRequest = {}): string[] {
  const args = ['api', path, '-X', request.method ?? 'GET']
  if (request.paginate) args.push('--paginate')
  if (request.body !== undefined) args.push('--input', '-', '-H', 'Content-Type: application/json')
  return args
}

export function createGlabClient(repoPath: string, options: GlabClientOptions = {}): GlabClient {
  const { bin = 'glab', prefixArgs = [], timeoutMs = 30_000, env = process.env } = options
  return (path, request = {}) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        bin,
        [...prefixArgs, ...glabArgs(path, request)],
        { cwd: repoPath, timeout: timeoutMs, env: { ...env, NO_COLOR: '1' }, maxBuffer: 50 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return reject(new GlabError('not_installed', 'glab이 설치되어 있지 않습니다'))
            }
            if (err.killed) {
              return reject(new GlabError('api', `GitLab 응답이 ${timeoutMs / 1000}초 안에 오지 않았습니다`))
            }
            return reject(classifyGlabError(stderr.toString()))
          }
          const text = stdout.toString().trim()
          if (!text) return resolve(null)
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new GlabError('api', 'GitLab 응답을 JSON으로 읽지 못했습니다'))
          }
        },
      )
      child.stdin?.end(request.body === undefined ? undefined : JSON.stringify(request.body))
    })
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/glab.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/gitlab/glab.ts src/gitlab/glab.test.ts src/gitlab/__fixtures__/fake-glab.mjs
git commit -m "feat: glab api 실행과 오류 종류 분류 추가"
```

---

### Task 2: GitLab 상태 확인과 MR 목록 API

**Files:**
- Create: `src/gitlab/mr.ts`
- Create: `src/test/fakeGlab.ts`
- Modify: `src/git.ts` (파일 끝에 `listRemotes` 추가)
- Modify: `src/server.ts` (`AppOptions`, import, `/api/gitlab/status`, `/api/gitlab/mrs`)
- Test: `src/gitlab/mr.test.ts`, `src/server.gitlab.test.ts`

**Interfaces:**
- Consumes: `GlabClient`, `GlabError`, `GlabErrorKind` (Task 1)
- Produces:
  - `listRemotes(repo: string): RemoteInfo[]` in `src/git.ts`, `interface RemoteInfo { name: string; url: string }`
  - `parseRemoteUrl(url: string): { host: string; path: string } | null`
  - `findGitlabRemote(remotes: RemoteInfo[], host: string, project: string): string | null`
  - `type GitlabStatus = { available: true; host: string; project: string; webUrl: string; username: string } | { available: false; reason: GlabErrorKind; message: string; host?: string }`
  - `getGitlabStatus(glab: GlabClient, remotes: RemoteInfo[]): Promise<GitlabStatus>`
  - `type MrState = 'opened' | 'merged' | 'all'`, `interface MrListQuery { state: MrState; mine: boolean; search: string }`
  - `interface MrSummary { iid: number; title: string; state: string; sourceBranch: string; targetBranch: string; author: string; webUrl: string; updatedAt: string }`
  - `mrListPath(q: MrListQuery): string`, `listMrs(glab, q): Promise<MrSummary[]>`, `parseMrListQuery(get: (name: string) => string | undefined): MrListQuery`
  - `interface ApiMr` (GitLab MR 응답 형태, Task 3에서 사용)
  - `AppOptions.glab?: GlabClient`
  - `fakeGlab(routes)` in `src/test/fakeGlab.ts`: 키는 `"<METHOD> <경로에서 ? 앞부분>"`

- [ ] **Step 1: 가짜 GlabClient 작성**

`src/test/fakeGlab.ts`:

```ts
import type { GlabClient, GlabRequest } from '../gitlab/glab'

type Route = unknown | Error | ((request: GlabRequest, path: string) => unknown)

export function fakeGlab(routes: Record<string, Route>) {
  const calls: { path: string; request: GlabRequest }[] = []
  const glab: GlabClient = async (path, request = {}) => {
    calls.push({ path, request })
    const key = `${request.method ?? 'GET'} ${path.split('?')[0]}`
    if (!(key in routes)) throw new Error(`unexpected glab call: ${key}`)
    const route = routes[key]
    if (route instanceof Error) throw route
    return typeof route === 'function' ? (route as (r: GlabRequest, p: string) => unknown)(request, path) : route
  }
  return { glab, calls }
}
```

- [ ] **Step 2: `mr.ts` 단위 테스트 작성**

`src/gitlab/mr.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseRemoteUrl, findGitlabRemote, getGitlabStatus, mrListPath, listMrs, parseMrListQuery } from './mr'
import { GlabError } from './glab'
import { fakeGlab } from '../test/fakeGlab'

describe('parseRemoteUrl', () => {
  it('reads https, scp-style ssh and ssh urls', () => {
    expect(parseRemoteUrl('https://gitlab.mrblue.com/mrblue/app.git')).toEqual({ host: 'gitlab.mrblue.com', path: 'mrblue/app' })
    expect(parseRemoteUrl('https://user@GitLab.example.com/group/sub/app/')).toEqual({ host: 'gitlab.example.com', path: 'group/sub/app' })
    expect(parseRemoteUrl('git@gitlab.mrblue.com:mrblue/app.git')).toEqual({ host: 'gitlab.mrblue.com', path: 'mrblue/app' })
    expect(parseRemoteUrl('ssh://git@gitlab.mrblue.com:2222/mrblue/app.git')).toEqual({ host: 'gitlab.mrblue.com', path: 'mrblue/app' })
  })

  it('returns null for local paths', () => {
    expect(parseRemoteUrl('/tmp/remote')).toBeNull()
    expect(parseRemoteUrl('file:///tmp/remote')).toBeNull()
  })
})

describe('findGitlabRemote', () => {
  const remotes = [
    { name: 'github', url: 'https://github.com/me/app.git' },
    { name: 'company', url: 'git@gitlab.mrblue.com:mrblue/app.git' },
  ]
  it('picks the remote matching host and project', () => {
    expect(findGitlabRemote(remotes, 'gitlab.mrblue.com', 'mrblue/app')).toBe('company')
  })
  it('returns null when nothing matches', () => {
    expect(findGitlabRemote(remotes, 'gitlab.mrblue.com', 'mrblue/other')).toBeNull()
  })
})

describe('getGitlabStatus', () => {
  it('returns project and user info', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath': { path_with_namespace: 'mrblue/app', web_url: 'https://gitlab.mrblue.com/mrblue/app' },
      'GET user': { username: 'jung.j.dev' },
    })
    expect(await getGitlabStatus(glab, [])).toEqual({ available: true, host: 'gitlab.mrblue.com', project: 'mrblue/app', webUrl: 'https://gitlab.mrblue.com/mrblue/app', username: 'jung.j.dev' })
  })

  it('reports the failure kind with the origin host', async () => {
    const { glab } = fakeGlab({ 'GET projects/:fullpath': new GlabError('auth', 'Unauthenticated.') })
    const status = await getGitlabStatus(glab, [{ name: 'origin', url: 'https://gitlab.mrblue.com/mrblue/app.git' }])
    expect(status).toEqual({ available: false, reason: 'auth', message: 'Unauthenticated.', host: 'gitlab.mrblue.com' })
  })
})

describe('MR list', () => {
  it('builds the list path from the filter', () => {
    expect(mrListPath({ state: 'opened', mine: false, search: '' }))
      .toBe('projects/:fullpath/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50')
    expect(mrListPath({ state: 'merged', mine: true, search: ' 로그인 ' }))
      .toBe('projects/:fullpath/merge_requests?state=merged&order_by=updated_at&sort=desc&per_page=50&scope=assigned_to_me&search=%EB%A1%9C%EA%B7%B8%EC%9D%B8&in=title')
  })

  it('parses the query with defaults', () => {
    expect(parseMrListQuery(() => undefined)).toEqual({ state: 'opened', mine: false, search: '' })
    const q: Record<string, string> = { state: 'all', mine: 'true', search: 'x' }
    expect(parseMrListQuery((n) => q[n])).toEqual({ state: 'all', mine: true, search: 'x' })
    expect(parseMrListQuery((n) => (n === 'state' ? 'closed' : undefined)).state).toBe('opened')
  })

  it('maps GitLab fields', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath/merge_requests': [{
        iid: 12, title: '로그인 수정', state: 'merged', source_branch: 'feat/login', target_branch: 'main',
        author: { name: '김개발' }, web_url: 'https://gitlab.mrblue.com/mrblue/app/-/merge_requests/12', updated_at: '2026-09-29T07:58:41.879Z', diff_refs: null,
      }],
    })
    expect(await listMrs(glab, { state: 'all', mine: false, search: '' })).toEqual([{
      iid: 12, title: '로그인 수정', state: 'merged', sourceBranch: 'feat/login', targetBranch: 'main',
      author: '김개발', webUrl: 'https://gitlab.mrblue.com/mrblue/app/-/merge_requests/12', updatedAt: '2026-09-29T07:58:41.879Z',
    }])
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/mr.test.ts`
Expected: FAIL, `Failed to resolve import "./mr"`

- [ ] **Step 4: `listRemotes` 추가**

`src/git.ts` 끝에 추가:

```ts
export interface RemoteInfo {
  name: string
  url: string
}

export function listRemotes(repo: string): RemoteInfo[] {
  let output: string
  try {
    output = run(repo, ['remote', '-v'])
  } catch {
    return []
  }
  const remotes: RemoteInfo[] = []
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\t(\S+) \(fetch\)$/)
    if (match) remotes.push({ name: match[1], url: match[2] })
  }
  return remotes
}
```

- [ ] **Step 5: `mr.ts` 구현**

`src/gitlab/mr.ts`:

```ts
import type { RemoteInfo } from '../git.js'
import { GlabError, type GlabClient, type GlabErrorKind } from './glab.js'

export type GitlabStatus =
  | { available: true; host: string; project: string; webUrl: string; username: string }
  | { available: false; reason: GlabErrorKind; message: string; host?: string }

export type MrState = 'opened' | 'merged' | 'all'

export interface MrListQuery {
  state: MrState
  mine: boolean
  search: string
}

export interface MrSummary {
  iid: number
  title: string
  state: string
  sourceBranch: string
  targetBranch: string
  author: string
  webUrl: string
  updatedAt: string
}

export interface ApiMr {
  iid: number
  title: string
  state: string
  source_branch: string
  target_branch: string
  author: { name: string }
  web_url: string
  updated_at: string
  diff_refs: { base_sha: string; start_sha: string; head_sha: string } | null
}

export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  let host: string
  let path: string
  const scp = url.match(/^[^@/\s]+@([^:/\s]+):(.+)$/)
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    try {
      const parsed = new URL(url)
      if (!parsed.hostname) return null
      host = parsed.hostname
      path = parsed.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/, '')
  return path ? { host: host.toLowerCase(), path } : null
}

export function findGitlabRemote(remotes: RemoteInfo[], host: string, project: string): string | null {
  const match = remotes.find((r) => {
    const parsed = parseRemoteUrl(r.url)
    return parsed !== null && parsed.host === host.toLowerCase() && parsed.path === project
  })
  return match?.name ?? null
}

export async function getGitlabStatus(glab: GlabClient, remotes: RemoteInfo[]): Promise<GitlabStatus> {
  try {
    const project = await glab('projects/:fullpath') as { path_with_namespace: string; web_url: string }
    const user = await glab('user') as { username: string }
    return {
      available: true,
      host: new URL(project.web_url).hostname,
      project: project.path_with_namespace,
      webUrl: project.web_url,
      username: user.username,
    }
  } catch (err) {
    if (!(err instanceof GlabError)) throw err
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
    const host = origin ? parseRemoteUrl(origin.url)?.host : undefined
    return { available: false, reason: err.kind, message: err.message, ...(host ? { host } : {}) }
  }
}

export function parseMrListQuery(get: (name: string) => string | undefined): MrListQuery {
  const state = get('state')
  return {
    state: state === 'merged' || state === 'all' ? state : 'opened',
    mine: get('mine') === 'true',
    search: get('search') ?? '',
  }
}

export function mrListPath(q: MrListQuery): string {
  const params = new URLSearchParams({ state: q.state, order_by: 'updated_at', sort: 'desc', per_page: '50' })
  if (q.mine) params.set('scope', 'assigned_to_me')
  const search = q.search.trim()
  if (search) {
    params.set('search', search)
    params.set('in', 'title')
  }
  return `projects/:fullpath/merge_requests?${params}`
}

export async function listMrs(glab: GlabClient, q: MrListQuery): Promise<MrSummary[]> {
  const list = await glab(mrListPath(q)) as ApiMr[]
  return list.map((m) => ({
    iid: m.iid,
    title: m.title,
    state: m.state,
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    author: m.author.name,
    webUrl: m.web_url,
    updatedAt: m.updated_at,
  }))
}
```

- [ ] **Step 6: 단위 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/mr.test.ts`
Expected: PASS

- [ ] **Step 7: 서버 API 테스트 작성**

`src/server.gitlab.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { fakeGlab } from './test/fakeGlab'
import { GlabError } from './gitlab/glab'
import { createApp } from './server'

export function clientDir() {
  const dir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  return dir
}

export const PROJECT = { path_with_namespace: 'team/app', web_url: 'https://gitlab.example.com/team/app' }

function setup(routes: Record<string, unknown>) {
  const repo = makeRepo()
  commit(repo, { 'a.txt': 'a\n' }, 'base')
  git(repo, 'remote', 'add', 'origin', 'https://gitlab.example.com/team/app.git')
  const fake = fakeGlab(routes)
  const app = createApp({ repoPath: repo, clientDir: clientDir(), glab: fake.glab })
  return { app, repo, ...fake }
}

describe('GET /api/gitlab/status', () => {
  it('returns the status and reuses it until refresh=true', async () => {
    const { app, calls } = setup({ 'GET projects/:fullpath': PROJECT, 'GET user': { username: 'me' } })
    const first = await (await app.request('/api/gitlab/status')).json()
    expect(first).toEqual({ available: true, host: 'gitlab.example.com', project: 'team/app', webUrl: 'https://gitlab.example.com/team/app', username: 'me' })
    await app.request('/api/gitlab/status')
    expect(calls).toHaveLength(2)
    await app.request('/api/gitlab/status?refresh=true')
    expect(calls).toHaveLength(4)
  })

  it('reports why GitLab is unavailable', async () => {
    const { app } = setup({ 'GET projects/:fullpath': new GlabError('auth', 'Unauthenticated.') })
    expect(await (await app.request('/api/gitlab/status')).json())
      .toEqual({ available: false, reason: 'auth', message: 'Unauthenticated.', host: 'gitlab.example.com' })
  })
})

describe('GET /api/gitlab/mrs', () => {
  it('passes the filter to GitLab and maps the response', async () => {
    const { app, calls } = setup({
      'GET projects/:fullpath/merge_requests': [{
        iid: 3, title: 't', state: 'opened', source_branch: 's', target_branch: 'main',
        author: { name: 'a' }, web_url: 'u', updated_at: 'd', diff_refs: null,
      }],
    })
    const res = await app.request('/api/gitlab/mrs?state=merged&mine=true&search=abc')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ iid: 3, title: 't', state: 'opened', sourceBranch: 's', targetBranch: 'main', author: 'a', webUrl: 'u', updatedAt: 'd' }])
    expect(calls[0].path).toBe('projects/:fullpath/merge_requests?state=merged&order_by=updated_at&sort=desc&per_page=50&scope=assigned_to_me&search=abc&in=title')
  })

  it('returns 502 with the glab error kind', async () => {
    const { app } = setup({ 'GET projects/:fullpath/merge_requests': new GlabError('api', 'glab: 500') })
    const res = await app.request('/api/gitlab/mrs')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'api', message: 'glab: 500' })
  })
})
```

- [ ] **Step 8: 테스트 실패 확인**

Run: `pnpm exec vitest run src/server.gitlab.test.ts`
Expected: FAIL, `/api/gitlab/status` 응답이 index.html이라 JSON 파싱 실패

- [ ] **Step 9: 서버 구현**

`src/server.ts` import에 추가:

```ts
import { listRemotes } from './git.js'
import { createGlabClient, GlabError, type GlabClient } from './gitlab/glab.js'
import { getGitlabStatus, listMrs, parseMrListQuery, type GitlabStatus } from './gitlab/mr.js'
```

(`listRemotes`는 기존 `./git.js` import 줄에 합친다.)

`AppOptions`에 추가:

```ts
  glab?: GlabClient
```

`createApp` 안, `const providers = ...` 다음에 추가:

```ts
  const glab = options.glab ?? createGlabClient(repo)
  let gitlabStatus: Promise<GitlabStatus> | null = null
  const getStatus = (refresh = false) => {
    if (refresh || !gitlabStatus) gitlabStatus = getGitlabStatus(glab, listRemotes(repo))
    return gitlabStatus
  }
```

`comparisonErrorResponse`에 `GlabError` 처리를 추가한다:

```ts
  const comparisonErrorResponse = (c: Context, err: unknown) => {
    if (err instanceof ComparisonError) {
      return c.json({ error: err.code, message: err.message }, err.code === 'no_merge_base' ? 422 : 400)
    }
    if (err instanceof GlabError) {
      return c.json({ error: err.kind, message: err.message }, 502)
    }
    throw err
  }
```

`app.post('/api/fetch', ...)` 다음에 추가:

```ts
  app.get('/api/gitlab/status', async (c) => {
    return c.json(await getStatus(c.req.query('refresh') === 'true'))
  })

  app.get('/api/gitlab/mrs', async (c) => {
    try {
      return c.json(await listMrs(glab, parseMrListQuery((name) => c.req.query(name))))
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })
```

- [ ] **Step 10: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모두 PASS, tsc 출력 없음

- [ ] **Step 11: 커밋**

```bash
git add src/git.ts src/gitlab/mr.ts src/gitlab/mr.test.ts src/test/fakeGlab.ts src/server.ts src/server.gitlab.test.ts
git commit -m "feat: GitLab 연결 상태와 MR 목록 조회 API 추가"
```

---

### Task 3: MR diff

**Files:**
- Create: `src/gitlab/mrComparison.ts`
- Create: `src/test/mrRepo.ts`
- Modify: `src/git.ts` (`fetchAll` 정리, `hasCommit`, `fetchRefs` 추가)
- Modify: `src/gitlab/mr.ts` (`MrDetail`, `getMrDetail`, `MrFetchError`, `ensureMrCommits` 추가)
- Modify: `src/comparison.ts` (`ComparisonQuery.iid`, `ResolvedComparison.mode`에 `'mr'`)
- Modify: `src/review/fingerprint.ts`
- Modify: `src/server.ts` (`/api/diff`, `/api/file-content`, `/api/file-versions`, `/api/review` GET/POST)
- Test: `src/gitlab/mr.test.ts`, `src/server.gitlab.test.ts`

**Interfaces:**
- Consumes: `GlabClient`, `GlabError` (Task 1), `GitlabStatus`, `ApiMr`, `findGitlabRemote`, `listRemotes`, `fakeGlab`, `clientDir`, `PROJECT` (Task 2)
- Produces:
  - `hasCommit(repo: string, sha: string): boolean`, `fetchRefs(repo: string, remote: string, refspecs: string[], timeoutMs?: number): Promise<{ ok: true } | { ok: false; error: string }>` in `src/git.ts`
  - `interface MrDetail { iid: number; title: string; webUrl: string; sourceBranch: string; targetBranch: string; baseSha: string; startSha: string; headSha: string }`
  - `getMrDetail(glab: GlabClient, iid: number): Promise<MrDetail>`
  - `class MrFetchError extends Error`
  - `ensureMrCommits(repo: string, remote: string, mr: MrDetail, deps?: MrGitDeps): Promise<void>`
  - `class MrRequestError extends Error`, `parseIid(value: unknown): number`
  - `type MrResolved = ResolvedComparison & { mode: 'mr'; mr: MrDetail }`
  - `class MrComparisons { resolve(iid: number, options: { refresh: boolean }): Promise<MrResolved> }`
  - `/api/diff?mode=mr&iid=N` 응답의 `mr: MrDetail`
  - `makeMrRepo()`, `apiMr(iid, base, head, targetBranch?)` in `src/test/mrRepo.ts`

- [ ] **Step 1: MR 테스트 저장소 도우미 작성**

`src/test/mrRepo.ts`:

```ts
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './gitRepo'

// 원격 저장소의 MR 커밋은 refs/merge-requests/7/head로만 가리키고 브랜치가 없어서 clone에는 들어오지 않는다.
export function makeMrRepo() {
  const remote = makeRepo()
  const base = commit(remote, { 'a.txt': 'one\ntwo\nthree\n' }, 'base')
  git(remote, 'switch', '-q', '-c', 'feature')
  const head = commit(remote, { 'a.txt': 'one\nTWO\nthree\n', 'b.png': 'NEWPNG' }, 'feature')
  git(remote, 'update-ref', 'refs/merge-requests/7/head', head)
  git(remote, 'switch', '-q', 'main')
  git(remote, 'branch', '-q', '-D', 'feature')
  const local = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-clone-')))
  git(local, 'clone', '-q', remote, '.')
  return { remote, local, base, head }
}

export function apiMr(iid: number, base: string, head: string, targetBranch = 'main') {
  return {
    iid,
    title: '로그인 수정',
    state: 'opened',
    source_branch: 'feature',
    target_branch: targetBranch,
    author: { name: '김개발' },
    web_url: `https://gitlab.example.com/team/app/-/merge_requests/${iid}`,
    updated_at: '2026-09-30T00:00:00Z',
    diff_refs: { base_sha: base, start_sha: base, head_sha: head },
  }
}
```

- [ ] **Step 2: `ensureMrCommits`, `getMrDetail` 테스트 추가**

`src/gitlab/mr.test.ts` import 줄을 다음으로 바꾸고 파일 끝에 describe 블록을 추가한다:

```ts
import { parseRemoteUrl, findGitlabRemote, getGitlabStatus, mrListPath, listMrs, parseMrListQuery, getMrDetail, ensureMrCommits, MrFetchError, type MrDetail } from './mr'
```

```ts
describe('getMrDetail', () => {
  it('reads diff_refs', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath/merge_requests/7': {
        iid: 7, title: 't', state: 'opened', source_branch: 's', target_branch: 'main', author: { name: 'a' },
        web_url: 'u', updated_at: 'd', diff_refs: { base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: 'd'.repeat(40) },
      },
    })
    expect(await getMrDetail(glab, 7)).toEqual({
      iid: 7, title: 't', webUrl: 'u', sourceBranch: 's', targetBranch: 'main',
      baseSha: 'b'.repeat(40), startSha: 'c'.repeat(40), headSha: 'd'.repeat(40),
    })
  })

  it('fails when GitLab has no diff refs', async () => {
    const { glab } = fakeGlab({ 'GET projects/:fullpath/merge_requests/7': { iid: 7, diff_refs: null } })
    await expect(getMrDetail(glab, 7)).rejects.toMatchObject({ kind: 'api', message: 'MR의 diff 정보를 찾지 못했습니다' })
  })
})

describe('ensureMrCommits', () => {
  const mr: MrDetail = { iid: 7, title: 't', webUrl: 'u', sourceBranch: 's', targetBranch: 'release/1.0', baseSha: 'b'.repeat(40), startSha: 'b'.repeat(40), headSha: 'h'.repeat(40) }

  function deps(present: boolean[], results: ({ ok: true } | { ok: false; error: string })[]) {
    const fetches: string[][] = []
    let checks = 0
    return {
      fetches,
      deps: {
        hasCommit: () => present[Math.min(checks++, present.length - 1)],
        fetchRefs: async (_repo: string, remote: string, refspecs: string[]) => {
          fetches.push([remote, ...refspecs])
          return results.shift() ?? { ok: true as const }
        },
      },
    }
  }

  it('does not fetch when both commits exist', async () => {
    const d = deps([true], [])
    await ensureMrCommits('/repo', 'origin', mr, d.deps)
    expect(d.fetches).toEqual([])
  })

  it('fetches the MR ref and the target branch', async () => {
    const d = deps([false, true, true], [{ ok: true }])
    await ensureMrCommits('/repo', 'company', mr, d.deps)
    expect(d.fetches).toEqual([['company', 'refs/merge-requests/7/head', 'refs/heads/release/1.0']])
  })

  it('falls back to fetching the base sha when the target branch is gone', async () => {
    const d = deps([false, true, true], [{ ok: false, error: "couldn't find remote ref refs/heads/release/1.0" }, { ok: true }])
    await ensureMrCommits('/repo', 'origin', mr, d.deps)
    expect(d.fetches).toEqual([
      ['origin', 'refs/merge-requests/7/head', 'refs/heads/release/1.0'],
      ['origin', 'refs/merge-requests/7/head', 'b'.repeat(40)],
    ])
  })

  it('throws the git error when both fetches fail', async () => {
    const d = deps([false], [{ ok: false, error: 'first' }, { ok: false, error: 'second' }])
    const err = await ensureMrCommits('/repo', 'origin', mr, d.deps).catch((e) => e)
    expect(err).toBeInstanceOf(MrFetchError)
    expect(err.message).toBe('second')
  })

  it('throws when commits are still missing after fetch', async () => {
    const d = deps([false, false], [{ ok: true }])
    await expect(ensureMrCommits('/repo', 'origin', mr, d.deps)).rejects.toThrow('MR 기준 커밋을 가져오지 못했습니다')
  })
})
```

- [ ] **Step 3: 서버 MR diff 테스트 추가**

`src/server.gitlab.test.ts` import에 추가:

```ts
import { hasCommit } from './git'
import { makeMrRepo, apiMr } from './test/mrRepo'
```

파일 끝에 추가:

```ts
export function setupMr() {
  const repo = makeMrRepo()
  let detail = apiMr(7, repo.base, repo.head)
  const fake = fakeGlab({
    'GET projects/:fullpath': PROJECT,
    'GET user': { username: 'me' },
    'GET projects/:fullpath/merge_requests/7': () => detail,
  })
  const app = createApp({ repoPath: repo.local, clientDir: clientDir(), glab: fake.glab })
  return { app, ...repo, ...fake, setDetail: (d: typeof detail) => { detail = d } }
}

const detailCalls = (calls: { path: string }[]) => calls.filter((c) => c.path === 'projects/:fullpath/merge_requests/7').length

describe('GET /api/diff?mode=mr', () => {
  it('fetches the MR commits and returns the diff with MR info', async () => {
    const { app, local, base, head } = setupMr()
    expect(hasCommit(local, head)).toBe(false)
    const res = await app.request('/api/diff?mode=mr&iid=7')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patch).toContain('+TWO')
    expect(body).toMatchObject({ key: 'mr:7', mode: 'mr', sourceSha: head, targetSha: base, mergeBase: base, identical: false })
    expect(body.mr).toEqual({ iid: 7, title: '로그인 수정', webUrl: 'https://gitlab.example.com/team/app/-/merge_requests/7', sourceBranch: 'feature', targetBranch: 'main', baseSha: base, startSha: base, headSha: head })
    expect(hasCommit(local, head)).toBe(true)
  })

  it('picks up new commits pushed to the MR', async () => {
    const { app, remote, base, head, setDetail } = setupMr()
    await app.request('/api/diff?mode=mr&iid=7')
    git(remote, 'switch', '-q', '--detach', head)
    const next = commit(remote, { 'c.txt': 'new\n' }, 'more')
    git(remote, 'update-ref', 'refs/merge-requests/7/head', next)
    git(remote, 'switch', '-q', 'main')
    setDetail(apiMr(7, base, next))
    const body = await (await app.request('/api/diff?mode=mr&iid=7')).json()
    expect(body.sourceSha).toBe(next)
    expect(body.patch).toContain('+new')
  })

  it('rejects invalid iids and reports GitLab failures', async () => {
    const { app } = setupMr()
    const bad = await app.request('/api/diff?mode=mr&iid=abc')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'invalid_iid' })
    const missing = await app.request('/api/diff?mode=mr&iid=8')
    expect(missing.status).toBe(500)
  })

  it('returns 502 when the MR commits cannot be fetched', async () => {
    const { app, base, setDetail } = setupMr()
    setDetail(apiMr(7, base, 'f'.repeat(40)))
    const res = await app.request('/api/diff?mode=mr&iid=7')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'mr_fetch_failed' })
  })
})

describe('other APIs in mr mode', () => {
  it('reads file versions from base and head and reuses the cached MR detail', async () => {
    const { app, calls } = setupMr()
    await app.request('/api/diff?mode=mr&iid=7')
    expect(await (await app.request('/api/file-content?mode=mr&iid=7&path=a.txt&version=old')).text()).toBe('one\ntwo\nthree\n')
    expect(await (await app.request('/api/file-content?mode=mr&iid=7&path=b.png&version=new')).text()).toBe('NEWPNG')
    expect((await app.request('/api/file-content?mode=mr&iid=7&path=b.png&version=old')).status).toBe(404)
    expect(detailCalls(calls)).toBe(1)
  })

  it('looks up saved reviews by the MR key', async () => {
    const { app } = setupMr()
    const body = await (await app.request('/api/review?mode=mr&iid=7')).json()
    expect(body.key).toBe('mr:7')
  })
})
```

`/api/diff?mode=mr&iid=8`은 가짜 glab에 경로가 없어 일반 `Error`가 나고 Hono가 500을 돌려준다. 실제 GitLab의 404는 `GlabError('api')`라 502가 된다.

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/mr.test.ts src/server.gitlab.test.ts`
Expected: FAIL, `getMrDetail`와 `hasCommit` import 실패

- [ ] **Step 5: git 함수 추가**

`src/git.ts`의 `fetchAll`을 다음으로 바꾸고 `hasCommit`, `fetchRefs`를 추가한다:

```ts
export function hasCommit(repo: string, sha: string): boolean {
  if (!SHA_REGEX.test(sha)) return false
  try {
    run(repo, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

type FetchResult = { ok: true } | { ok: false; error: string }

function runFetch(repo: string, args: string[], timeoutMs: number): Promise<FetchResult> {
  return new Promise((done) => {
    execFile(
      'git',
      [...QUOTEPATH_OFF, 'fetch', ...args],
      { cwd: repo, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, _stdout, stderr) => {
        if (!err) return done({ ok: true })
        const message = stderr?.toString().trim() || err.message
        done({ ok: false, error: err.killed ? `git fetch가 ${timeoutMs / 1000}초 안에 끝나지 않았습니다` : message })
      },
    )
  })
}

export function fetchAll(repo: string, timeoutMs = 60_000): Promise<FetchResult> {
  return runFetch(repo, ['--all', '--prune'], timeoutMs)
}

export function fetchRefs(repo: string, remote: string, refspecs: string[], timeoutMs = 60_000): Promise<FetchResult> {
  if (remote.startsWith('-') || refspecs.some((r) => r.startsWith('-'))) {
    return Promise.resolve({ ok: false, error: 'invalid fetch arguments' })
  }
  return runFetch(repo, ['--no-tags', remote, ...refspecs], timeoutMs)
}
```

- [ ] **Step 6: `mr.ts`에 MR 상세와 fetch 추가**

`src/gitlab/mr.ts` import를 다음으로 바꾼다:

```ts
import { hasCommit, fetchRefs, type RemoteInfo } from '../git.js'
import { GlabError, type GlabClient, type GlabErrorKind } from './glab.js'
```

파일 끝에 추가:

```ts
export interface MrDetail {
  iid: number
  title: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  baseSha: string
  startSha: string
  headSha: string
}

export async function getMrDetail(glab: GlabClient, iid: number): Promise<MrDetail> {
  const m = await glab(`projects/:fullpath/merge_requests/${iid}`) as ApiMr
  if (!m.diff_refs) throw new GlabError('api', 'MR의 diff 정보를 찾지 못했습니다')
  return {
    iid: m.iid,
    title: m.title,
    webUrl: m.web_url,
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    baseSha: m.diff_refs.base_sha,
    startSha: m.diff_refs.start_sha,
    headSha: m.diff_refs.head_sha,
  }
}

export class MrFetchError extends Error {}

export interface MrGitDeps {
  hasCommit: (repo: string, sha: string) => boolean
  fetchRefs: (repo: string, remote: string, refspecs: string[]) => Promise<{ ok: true } | { ok: false; error: string }>
}

export async function ensureMrCommits(repo: string, remote: string, mr: MrDetail, deps: MrGitDeps = { hasCommit, fetchRefs }): Promise<void> {
  const present = () => deps.hasCommit(repo, mr.baseSha) && deps.hasCommit(repo, mr.headSha)
  if (present()) return
  const mrRef = `refs/merge-requests/${mr.iid}/head`
  let result = await deps.fetchRefs(repo, remote, [mrRef, `refs/heads/${mr.targetBranch}`])
  if (!result.ok) result = await deps.fetchRefs(repo, remote, [mrRef, mr.baseSha])
  if (!result.ok) throw new MrFetchError(result.error)
  if (!present()) throw new MrFetchError('MR 기준 커밋을 가져오지 못했습니다')
}
```

- [ ] **Step 7: `mrComparison.ts` 작성**

`src/gitlab/mrComparison.ts`:

```ts
import { getRangeDiff, listRemotes } from '../git.js'
import type { RangeDiff, ResolvedComparison } from '../comparison.js'
import { GlabError, type GlabClient } from './glab.js'
import { ensureMrCommits, findGitlabRemote, getMrDetail, type GitlabStatus, type MrDetail } from './mr.js'

export class MrRequestError extends Error {}

export function parseIid(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text)) throw new MrRequestError('MR 번호가 올바르지 않습니다')
  return Number(text)
}

export type MrResolved = ResolvedComparison & { mode: 'mr'; mr: MrDetail }

export class MrComparisons {
  private details = new Map<number, MrDetail>()

  constructor(
    private repo: string,
    private glab: GlabClient,
    private getStatus: () => Promise<GitlabStatus>,
    private rangeDiff: RangeDiff = getRangeDiff,
  ) {}

  async resolve(iid: number, options: { refresh: boolean }): Promise<MrResolved> {
    let mr = options.refresh ? undefined : this.details.get(iid)
    if (!mr) {
      mr = await getMrDetail(this.glab, iid)
      this.details.set(iid, mr)
    }
    await ensureMrCommits(this.repo, await this.remote(), mr)
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

  private async remote(): Promise<string> {
    const status = await this.getStatus()
    if (!status.available) throw new GlabError(status.reason, status.message)
    return findGitlabRemote(listRemotes(this.repo), status.host, status.project) ?? 'origin'
  }
}
```

- [ ] **Step 8: 비교 조합 타입과 fingerprint 수정**

`src/comparison.ts`:

```ts
export interface ComparisonQuery {
  mode?: string
  source?: string
  target?: string
  iid?: string
  staged?: boolean
  untracked?: boolean
}

export interface ResolvedComparison {
  key: string
  mode: 'worktree' | 'branch' | 'custom' | 'mr'
  // 나머지 필드는 그대로
}
```

`queryFromSearch`의 반환 객체에 `iid: get('iid'),`를 추가한다.

`src/review/fingerprint.ts`:

```ts
export function fingerprint(resolved: ResolvedComparison): string {
  if (resolved.mode === 'branch' || resolved.mode === 'mr') return `${resolved.sourceSha}:${resolved.targetSha}`
  return createHash('sha1').update(resolved.patch).digest('hex')
}
```

- [ ] **Step 9: 서버 연결**

`src/server.ts` import에 추가:

```ts
import { MrComparisons, MrRequestError, parseIid, type MrResolved } from './gitlab/mrComparison.js'
import { MrFetchError } from './gitlab/mr.js'
```

`resolveOptions` 정의와 `resolveFromRequest`를 다음으로 바꾼다. `glab`, `getStatus` 정의(Task 2)를 `resolveOptions` 위로 옮긴다:

```ts
  const resolveOptions = { diffCwd, rangeDiff: createRangeDiffCache() }
  const mrComparisons = new MrComparisons(repo, glab, () => getStatus(), resolveOptions.rangeDiff)
  const resolveFromRequest = async (c: Context, refresh = false): Promise<ResolvedComparison> => {
    const q = queryFromSearch((name) => c.req.query(name))
    if (q.mode === 'mr' && !isCustomMode) return mrComparisons.resolve(parseIid(q.iid), { refresh })
    return resolveComparison(repo, customDiffArgs, q, resolveOptions)
  }
```

`comparisonErrorResponse`에 두 오류를 추가한다(`GlabError` 분기 앞):

```ts
    if (err instanceof MrRequestError) {
      return c.json({ error: 'invalid_iid', message: err.message }, 400)
    }
    if (err instanceof MrFetchError) {
      return c.json({ error: 'mr_fetch_failed', message: err.message }, 502)
    }
```

`/api/diff` 핸들러를 `async`로 바꾸고 다음처럼 고친다:

```ts
  app.get('/api/diff', async (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = await resolveFromRequest(c, true)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    // activeKey, patch, untracked, binaryFiles, tabSizeMap 계산은 그대로
    return c.json({
      // 기존 필드 그대로
      mr: resolved.mode === 'mr' ? (resolved as MrResolved).mr : undefined,
      identical: (resolved.mode === 'branch' || resolved.mode === 'mr') && resolved.sourceSha === resolved.targetSha,
    })
  })
```

`/api/file-content` 핸들러를 `async`로 바꾸고 branch 분기를 다음으로 바꾼다:

```ts
    const mode = c.req.query('mode')
    let content: Buffer | null
    if ((mode === 'branch' || mode === 'mr') && !isCustomMode) {
      let refs: { mergeBase: string; sourceSha: string }
      try {
        if (mode === 'mr') {
          const resolved = await mrComparisons.resolve(parseIid(c.req.query('iid')), { refresh: false })
          refs = { mergeBase: resolved.mergeBase!, sourceSha: resolved.sourceSha! }
        } else {
          refs = resolveBranchRefs(repo, { source: c.req.query('source'), target: c.req.query('target') })
        }
      } catch (err) {
        return comparisonErrorResponse(c, err)
      }
      content = getFileAtCommit(repo, version === 'old' ? refs.mergeBase : refs.sourceSha, path)
    } else {
      content = getFileContent(repo, path, version)
    }
```

`/api/file-versions`와 `GET /api/review` 핸들러를 `async`로 바꾸고 `resolveFromRequest(c)` 호출 앞에 `await`를 붙인다.

`POST /api/review`의 body 타입에 `iid?: unknown`을 추가하고 비교 조합 계산과 `ctx`를 다음으로 바꾼다:

```ts
    try {
      resolved = body.mode === 'mr' && !isCustomMode
        ? await mrComparisons.resolve(parseIid(body.iid), { refresh: false })
        : resolveComparison(repo, customDiffArgs, { mode: body.mode, source: body.source, target: body.target, staged: body.staged, untracked: body.untracked }, resolveOptions)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
```

```ts
      ctx: {
        repoPath: repo,
        mode: resolved.mode === 'mr' ? 'branch' : resolved.mode,
        source: resolved.source,
        target: resolved.target,
        mergeBase: resolved.mergeBase,
        customArgs: customDiffArgs,
        staged: resolved.mode === 'worktree' && body.staged === true,
        sourceCheckedOut: (resolved.mode !== 'branch' && resolved.mode !== 'mr') || getHeadSha(repo) === resolved.sourceSha,
        files: parseFilePaths(patch),
        patch,
      },
```

- [ ] **Step 10: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모두 PASS, tsc 출력 없음

- [ ] **Step 11: 커밋**

```bash
git add src/git.ts src/gitlab/mr.ts src/gitlab/mr.test.ts src/gitlab/mrComparison.ts src/test/mrRepo.ts src/comparison.ts src/review/fingerprint.ts src/server.ts src/server.gitlab.test.ts
git commit -m "feat: MR 커밋을 fetch해 MR diff를 보여주는 mr 비교 모드 추가"
```

---

### Task 4: GitLab position 계산

**Files:**
- Create: `src/gitlab/position.ts`
- Test: `src/gitlab/position.test.ts`

**Interfaces:**
- Produces:
  - `interface MrShas { baseSha: string; startSha: string; headSha: string }` (`MrDetail`이 이 형태를 포함한다)
  - `interface GitlabPosition { position_type: 'text'; base_sha: string; start_sha: string; head_sha: string; old_path: string; new_path: string; old_line?: number; new_line?: number }`
  - `findFilePatch(patch: string, filePath: string): { oldPath: string; newPath: string; body: string[] } | null`
  - `locateLine(body: string[], side: 'additions' | 'deletions', lineNumber: number): { old_line?: number; new_line?: number }`
  - `buildPosition(patch: string, filePath: string, side: 'additions' | 'deletions', lineNumber: number, shas: MrShas): GitlabPosition | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/gitlab/position.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPosition, locateLine, findFilePatch } from './position'

const SHAS = { baseSha: 'b'.repeat(40), startSha: 's'.repeat(40), headSha: 'h'.repeat(40) }
const SHA_FIELDS = { position_type: 'text', base_sha: SHAS.baseSha, start_sha: SHAS.startSha, head_sha: SHAS.headSha }

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -2,4 +2,5 @@ header',
  ' line2',
  '-line3',
  '+line3 changed',
  '+inserted',
  ' line4',
  ' line5',
  '@@ -20,3 +21,2 @@',
  ' line20',
  '-line21',
  ' line22',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 90%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  'index 3333333..4444444 100644',
  '--- a/old/name.ts',
  '+++ b/new/name.ts',
  '@@ -1,2 +1,2 @@',
  '-a',
  '+b',
  ' c',
  'diff --git a/n.ts b/n.ts',
  'new file mode 100644',
  'index 0000000..5555555',
  '--- /dev/null',
  '+++ b/n.ts',
  '@@ -0,0 +1,2 @@',
  '+x',
  '+y',
  'diff --git a/d.ts b/d.ts',
  'deleted file mode 100644',
  'index 6666666..0000000',
  '--- a/d.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone',
  'diff --git a/i.png b/i.png',
  'index 7777777..8888888 100644',
  'Binary files a/i.png and b/i.png differ',
  '',
].join('\n')

const body = findFilePatch(PATCH, 'src/a.ts')!.body

describe('locateLine inside hunks', () => {
  it('maps added, deleted and context lines', () => {
    expect(locateLine(body, 'additions', 3)).toEqual({ new_line: 3 })
    expect(locateLine(body, 'additions', 4)).toEqual({ new_line: 4 })
    expect(locateLine(body, 'deletions', 3)).toEqual({ old_line: 3 })
    expect(locateLine(body, 'deletions', 21)).toEqual({ old_line: 21 })
    expect(locateLine(body, 'additions', 5)).toEqual({ old_line: 4, new_line: 5 })
    expect(locateLine(body, 'deletions', 20)).toEqual({ old_line: 20, new_line: 21 })
  })
})

describe('locateLine outside hunks (expanded context)', () => {
  it('uses the offset of the preceding hunk', () => {
    expect(locateLine(body, 'additions', 1)).toEqual({ old_line: 1, new_line: 1 })
    expect(locateLine(body, 'additions', 10)).toEqual({ old_line: 9, new_line: 10 })
    expect(locateLine(body, 'deletions', 9)).toEqual({ old_line: 9, new_line: 10 })
    expect(locateLine(body, 'additions', 30)).toEqual({ old_line: 30, new_line: 30 })
  })
})

describe('buildPosition', () => {
  it('fills shas and paths', () => {
    expect(buildPosition(PATCH, 'src/a.ts', 'additions', 3, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'src/a.ts', new_path: 'src/a.ts', new_line: 3 })
  })

  it('uses both paths for renamed files', () => {
    expect(buildPosition(PATCH, 'new/name.ts', 'additions', 1, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'old/name.ts', new_path: 'new/name.ts', new_line: 1 })
  })

  it('uses the new path on both sides for added files', () => {
    expect(buildPosition(PATCH, 'n.ts', 'additions', 2, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'n.ts', new_path: 'n.ts', new_line: 2 })
  })

  it('uses the old path on both sides for deleted files', () => {
    expect(buildPosition(PATCH, 'd.ts', 'deletions', 1, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'd.ts', new_path: 'd.ts', old_line: 1 })
  })

  it('returns null for binary and unknown files', () => {
    expect(buildPosition(PATCH, 'i.png', 'additions', 1, SHAS)).toBeNull()
    expect(buildPosition(PATCH, 'nope.ts', 'additions', 1, SHAS)).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/position.test.ts`
Expected: FAIL, `Failed to resolve import "./position"`

- [ ] **Step 3: 구현**

`src/gitlab/position.ts`:

```ts
export interface MrShas {
  baseSha: string
  startSha: string
  headSha: string
}

export interface GitlabPosition {
  position_type: 'text'
  base_sha: string
  start_sha: string
  head_sha: string
  old_path: string
  new_path: string
  old_line?: number
  new_line?: number
}

type Side = 'additions' | 'deletions'

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function findFilePatch(patch: string, filePath: string): { oldPath: string; newPath: string; body: string[] } | null {
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.split('\n')
    let oldPath: string | null = null
    let newPath: string | null = null
    let bodyStart = lines.length
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('@@')) {
        bodyStart = i
        break
      }
      if (line.startsWith('rename from ')) oldPath = line.slice('rename from '.length)
      else if (line.startsWith('rename to ')) newPath = line.slice('rename to '.length)
      else if (line.startsWith('--- a/')) oldPath = line.slice(6).replace(/\t$/, '')
      else if (line.startsWith('+++ b/')) newPath = line.slice(6).replace(/\t$/, '')
    }
    if (oldPath === null && newPath === null) continue
    const resolvedOld = oldPath ?? newPath!
    const resolvedNew = newPath ?? oldPath!
    if (filePath !== resolvedNew && filePath !== resolvedOld) continue
    return { oldPath: resolvedOld, newPath: resolvedNew, body: lines.slice(bodyStart) }
  }
  return null
}

export function locateLine(body: string[], side: Side, lineNumber: number): { old_line?: number; new_line?: number } {
  let delta = 0
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const line of body) {
    const header = line.match(HUNK_HEADER)
    if (header) {
      const oldStart = Number(header[1])
      const newStart = Number(header[2])
      if (lineNumber < (side === 'additions' ? newStart : oldStart)) break
      oldNo = oldStart
      newNo = newStart
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      if (side === 'additions' && newNo === lineNumber) return { new_line: newNo }
      newNo++
    } else if (line.startsWith('-')) {
      if (side === 'deletions' && oldNo === lineNumber) return { old_line: oldNo }
      oldNo++
    } else if (line.startsWith(' ')) {
      if ((side === 'additions' ? newNo : oldNo) === lineNumber) return { old_line: oldNo, new_line: newNo }
      oldNo++
      newNo++
    }
    delta = newNo - oldNo
  }
  return side === 'additions'
    ? { old_line: lineNumber - delta, new_line: lineNumber }
    : { old_line: lineNumber, new_line: lineNumber + delta }
}

export function buildPosition(patch: string, filePath: string, side: Side, lineNumber: number, shas: MrShas): GitlabPosition | null {
  const file = findFilePatch(patch, filePath)
  if (!file) return null
  return {
    position_type: 'text',
    base_sha: shas.baseSha,
    start_sha: shas.startSha,
    head_sha: shas.headSha,
    old_path: file.oldPath,
    new_path: file.newPath,
    ...locateLine(file.body, side, lineNumber),
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/position.test.ts`
Expected: PASS

`locateLine(body, 'additions', 10)` 계산: 첫 hunk가 끝나면 old 6, new 7이라 `delta`는 1이다. 두 번째 hunk 시작 new 21보다 10이 작아서 반복을 멈추고 `{ old_line: 9, new_line: 10 }`을 돌려준다.

- [ ] **Step 5: 커밋**

```bash
git add src/gitlab/position.ts src/gitlab/position.test.ts
git commit -m "feat: diff 줄을 GitLab 코멘트 position으로 변환하는 함수 추가"
```

---

### Task 5: MR 코멘트 API

**Files:**
- Create: `src/gitlab/notes.ts`
- Modify: `src/types.ts`
- Modify: `src/server.ts` (`POST /api/comments`에 `origin`, `/api/gitlab/mrs/:iid/*` 추가)
- Test: `src/gitlab/notes.test.ts`, `src/server.gitlab.test.ts`

**Interfaces:**
- Consumes: `MrComparisons`, `parseIid` (Task 3), `buildPosition` (Task 4), `setupMr` (Task 3 테스트)
- Produces:
  - `ReviewComment.origin: 'local' | 'draft' | 'gitlab'`, `ReviewComment.author?: string`, `ReviewComment.discussionId?: string`, `CommentReply.author?: string`, `CommentReply.draft?: boolean`
  - `interface MrThreads { comments: ReviewComment[]; outdatedCount: number; draftCount: number }`
  - `buildThreads(key: string, headSha: string, discussions: ApiDiscussion[], drafts: ApiDraftNote[]): MrThreads`
  - id 규칙: gitlab discussion은 discussion id, 답글은 `note:<note id>`, 초안은 `draft:<draft id>`
  - API: `GET /api/gitlab/mrs/:iid/threads` → `MrThreads`, `POST /api/gitlab/mrs/:iid/drafts` (본문 `{ filePath, side, lineNumber, body }` 또는 `{ discussionId, body }`) → 201 `{ ok: true }`, `DELETE /api/gitlab/mrs/:iid/drafts/:id` (숫자 id), `POST /api/gitlab/mrs/:iid/publish`

- [ ] **Step 1: 타입 수정**

`src/types.ts`:

```ts
export interface CommentReply {
  id: string
  body: string
  createdAt: number
  author?: string
  draft?: boolean
}

export interface ReviewComment {
  id: string
  key: string
  origin: 'local' | 'draft' | 'gitlab'
  filePath: string
  side: 'deletions' | 'additions'
  lineNumber: number
  lineContent: string
  body: string
  status: 'open' | 'resolved'
  createdAt: number
  replies: CommentReply[]
  author?: string
  discussionId?: string
}
```

`src/server.ts`의 `POST /api/comments`에서 만드는 객체에 `origin: 'local' as const,`를 `key` 다음 줄에 추가한다.

- [ ] **Step 2: 변환 함수 테스트 작성**

`src/gitlab/notes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildThreads, type ApiDiscussion, type ApiDraftNote } from './notes'

const HEAD = 'h'.repeat(40)
const OLD = 'o'.repeat(40)

function position(head: string, oldLine: number | null, newLine: number | null) {
  return { head_sha: head, old_path: 'src/old.ts', new_path: 'src/a.ts', old_line: oldLine, new_line: newLine }
}

function note(id: number, body: string, extra: object = {}) {
  return { id, type: 'DiffNote', system: false, body, author: { name: `사람${id}` }, created_at: '2026-09-29T07:32:59.987Z', ...extra }
}

const discussions: ApiDiscussion[] = [
  { id: 'd1', notes: [note(1, '첫 코멘트', { position: position(HEAD, null, 19), resolved: false }), note(2, '답글'), note(3, '시스템', { system: true })] },
  { id: 'd2', notes: [note(4, '삭제 줄', { position: position(HEAD, 7, null), resolved: true })] },
  { id: 'd3', notes: [note(5, '이전 버전', { position: position(OLD, null, 3) })] },
  { id: 'd4', notes: [{ ...note(6, '일반 코멘트'), type: null }] },
]

const drafts: ApiDraftNote[] = [
  { id: 10, note: '새 초안', discussion_id: null, position: position(HEAD, 4, 5) },
  { id: 11, note: '답글 초안', discussion_id: 'd1', position: null },
  { id: 12, note: '사라진 discussion 답글', discussion_id: 'gone', position: null },
  { id: 13, note: '이전 버전 초안', discussion_id: null, position: position(OLD, null, 1) },
]

describe('buildThreads', () => {
  const result = buildThreads('mr:7', HEAD, discussions, drafts)

  it('converts current diff discussions with replies', () => {
    expect(result.comments[0]).toEqual({
      id: 'd1', key: 'mr:7', origin: 'gitlab', discussionId: 'd1', author: '사람1',
      filePath: 'src/a.ts', side: 'additions', lineNumber: 19, lineContent: '', body: '첫 코멘트',
      status: 'open', createdAt: Date.parse('2026-09-29T07:32:59.987Z'),
      replies: [
        { id: 'note:2', body: '답글', createdAt: Date.parse('2026-09-29T07:32:59.987Z'), author: '사람2' },
        { id: 'draft:11', body: '답글 초안', createdAt: 0, draft: true },
      ],
    })
  })

  it('uses the old path and deletions side for removed lines', () => {
    expect(result.comments[1]).toMatchObject({ id: 'd2', filePath: 'src/old.ts', side: 'deletions', lineNumber: 7, status: 'resolved' })
  })

  it('adds top-level drafts', () => {
    expect(result.comments[2]).toEqual({
      id: 'draft:10', key: 'mr:7', origin: 'draft', filePath: 'src/a.ts', side: 'additions', lineNumber: 5,
      lineContent: '', body: '새 초안', status: 'open', createdAt: 0, replies: [],
    })
    expect(result.comments).toHaveLength(3)
  })

  it('counts outdated discussions and drafts and all drafts', () => {
    expect(result.outdatedCount).toBe(2)
    expect(result.draftCount).toBe(4)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec vitest run src/gitlab/notes.test.ts`
Expected: FAIL, `Failed to resolve import "./notes"`

- [ ] **Step 4: `notes.ts` 구현**

`src/gitlab/notes.ts`:

```ts
import type { ReviewComment } from '../types.js'

interface ApiPosition {
  head_sha: string
  old_path: string
  new_path: string
  old_line: number | null
  new_line: number | null
}

export interface ApiNote {
  id: number
  type: string | null
  system: boolean
  body: string
  author: { name: string }
  created_at: string
  resolved?: boolean
  position?: ApiPosition
}

export interface ApiDiscussion {
  id: string
  notes: ApiNote[]
}

export interface ApiDraftNote {
  id: number
  note: string
  discussion_id: string | null
  position: ApiPosition | null
}

export interface MrThreads {
  comments: ReviewComment[]
  outdatedCount: number
  draftCount: number
}

function lineOf(position: ApiPosition | null | undefined) {
  if (!position) return null
  if (position.new_line != null) return { filePath: position.new_path, side: 'additions' as const, lineNumber: position.new_line }
  if (position.old_line != null) return { filePath: position.old_path, side: 'deletions' as const, lineNumber: position.old_line }
  return null
}

export function buildThreads(key: string, headSha: string, discussions: ApiDiscussion[], drafts: ApiDraftNote[]): MrThreads {
  const comments: ReviewComment[] = []
  const byDiscussion = new Map<string, ReviewComment>()
  let outdatedCount = 0

  for (const discussion of discussions) {
    const first = discussion.notes[0]
    if (!first || first.type !== 'DiffNote') continue
    const line = lineOf(first.position)
    if (!line) continue
    if (first.position!.head_sha !== headSha) {
      outdatedCount++
      continue
    }
    const comment: ReviewComment = {
      id: discussion.id,
      key,
      origin: 'gitlab',
      discussionId: discussion.id,
      author: first.author.name,
      ...line,
      lineContent: '',
      body: first.body,
      status: first.resolved ? 'resolved' : 'open',
      createdAt: Date.parse(first.created_at),
      replies: discussion.notes
        .slice(1)
        .filter((n) => !n.system)
        .map((n) => ({ id: `note:${n.id}`, body: n.body, createdAt: Date.parse(n.created_at), author: n.author.name })),
    }
    comments.push(comment)
    byDiscussion.set(discussion.id, comment)
  }

  for (const draft of drafts) {
    if (draft.discussion_id) {
      byDiscussion.get(draft.discussion_id)?.replies.push({ id: `draft:${draft.id}`, body: draft.note, createdAt: 0, draft: true })
      continue
    }
    const line = lineOf(draft.position)
    if (!line) continue
    if (draft.position!.head_sha !== headSha) {
      outdatedCount++
      continue
    }
    comments.push({
      id: `draft:${draft.id}`,
      key,
      origin: 'draft',
      ...line,
      lineContent: '',
      body: draft.note,
      status: 'open',
      createdAt: 0,
      replies: [],
    })
  }

  return { comments, outdatedCount, draftCount: drafts.length }
}
```

- [ ] **Step 5: 변환 테스트 통과 확인**

Run: `pnpm exec vitest run src/gitlab/notes.test.ts`
Expected: PASS

- [ ] **Step 6: 서버 API 테스트 추가**

`src/server.gitlab.test.ts` 끝에 추가:

```ts
function setupNotes(extra: Record<string, unknown> = {}) {
  const ctx = setupMr()
  const mrApi = 'projects/:fullpath/merge_requests/7'
  const routes: Record<string, unknown> = {
    'GET projects/:fullpath': PROJECT,
    'GET user': { username: 'me' },
    [`GET ${mrApi}`]: apiMr(7, ctx.base, ctx.head),
    [`GET ${mrApi}/discussions`]: [],
    [`GET ${mrApi}/draft_notes`]: [],
    [`POST ${mrApi}/draft_notes`]: { id: 99 },
    [`DELETE ${mrApi}/draft_notes/5`]: null,
    [`POST ${mrApi}/draft_notes/bulk_publish`]: null,
    ...extra,
  }
  const fake = fakeGlab(routes)
  const app = createApp({ repoPath: ctx.local, clientDir: clientDir(), glab: fake.glab })
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ...ctx, app, calls: fake.calls, post, mrApi }
}

describe('MR comment APIs', () => {
  it('returns threads from paginated discussions and drafts', async () => {
    const { app, calls, mrApi } = setupNotes()
    const res = await app.request('/api/gitlab/mrs/7/threads')
    expect(await res.json()).toEqual({ comments: [], outdatedCount: 0, draftCount: 0 })
    expect(calls.filter((c) => c.request.paginate).map((c) => c.path)).toEqual([`${mrApi}/discussions?per_page=100`, `${mrApi}/draft_notes?per_page=100`])
  })

  it('creates a line draft with the computed position', async () => {
    const { post, calls, mrApi, head } = setupNotes()
    const res = await post('/api/gitlab/mrs/7/drafts', { filePath: 'a.txt', side: 'additions', lineNumber: 2, body: '확인 부탁' })
    expect(res.status).toBe(201)
    const sent = calls.find((c) => c.path === `${mrApi}/draft_notes` && c.request.method === 'POST')!
    expect(sent.request.body).toEqual({
      note: '확인 부탁',
      position: { position_type: 'text', base_sha: expect.any(String), start_sha: expect.any(String), head_sha: head, old_path: 'a.txt', new_path: 'a.txt', new_line: 2 },
    })
  })

  it('creates a reply draft', async () => {
    const { post, calls, mrApi } = setupNotes()
    await post('/api/gitlab/mrs/7/drafts', { discussionId: 'abc', body: '동의합니다' })
    const sent = calls.find((c) => c.path === `${mrApi}/draft_notes` && c.request.method === 'POST')!
    expect(sent.request.body).toEqual({ note: '동의합니다', in_reply_to_discussion_id: 'abc' })
  })

  it('rejects empty bodies and lines outside the diff files', async () => {
    const { post } = setupNotes()
    expect((await post('/api/gitlab/mrs/7/drafts', { discussionId: 'abc', body: '  ' })).status).toBe(400)
    const res = await post('/api/gitlab/mrs/7/drafts', { filePath: 'nope.txt', side: 'additions', lineNumber: 1, body: 'x' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_position' })
  })

  it('deletes a draft and publishes all drafts', async () => {
    const { app, post, calls, mrApi } = setupNotes()
    expect((await app.request('/api/gitlab/mrs/7/drafts/5', { method: 'DELETE' })).status).toBe(200)
    expect((await app.request('/api/gitlab/mrs/7/drafts/x', { method: 'DELETE' })).status).toBe(400)
    expect((await post('/api/gitlab/mrs/7/publish', {})).status).toBe(200)
    expect(calls.map((c) => `${c.request.method ?? 'GET'} ${c.path}`)).toContain(`POST ${mrApi}/draft_notes/bulk_publish`)
  })

  it('returns 502 when GitLab rejects the draft', async () => {
    const { post } = setupNotes({ 'POST projects/:fullpath/merge_requests/7/draft_notes': new GlabError('api', 'glab: 400 Bad Request') })
    const res = await post('/api/gitlab/mrs/7/drafts', { discussionId: 'abc', body: 'x' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'api', message: 'glab: 400 Bad Request' })
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm exec vitest run src/server.gitlab.test.ts`
Expected: FAIL, `/api/gitlab/mrs/7/threads` 응답이 index.html

- [ ] **Step 8: 서버 API 구현**

`src/server.ts` import에 추가:

```ts
import { buildPosition } from './gitlab/position.js'
import { buildThreads, type ApiDiscussion, type ApiDraftNote } from './gitlab/notes.js'
```

`/api/gitlab/mrs` 핸들러 다음에 추가:

```ts
  const mrPath = (iid: number) => `projects/:fullpath/merge_requests/${iid}`

  app.get('/api/gitlab/mrs/:iid/threads', async (c) => {
    try {
      const iid = parseIid(c.req.param('iid'))
      const { mr } = await mrComparisons.resolve(iid, { refresh: false })
      const [discussions, drafts] = await Promise.all([
        glab(`${mrPath(iid)}/discussions?per_page=100`, { paginate: true }) as Promise<ApiDiscussion[]>,
        glab(`${mrPath(iid)}/draft_notes?per_page=100`, { paginate: true }) as Promise<ApiDraftNote[]>,
      ])
      return c.json(buildThreads(`mr:${iid}`, mr.headSha, discussions, drafts))
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/gitlab/mrs/:iid/drafts', async (c) => {
    let body: { filePath?: unknown; side?: unknown; lineNumber?: unknown; discussionId?: unknown; body?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    if (typeof body.body !== 'string' || !body.body.trim()) {
      return c.json({ error: 'invalid_body', message: '코멘트 내용을 입력해 주세요' }, 400)
    }
    try {
      const iid = parseIid(c.req.param('iid'))
      const path = `${mrPath(iid)}/draft_notes`
      if (typeof body.discussionId === 'string' && body.discussionId) {
        await glab(path, { method: 'POST', body: { note: body.body, in_reply_to_discussion_id: body.discussionId } })
        return c.json({ ok: true }, 201)
      }
      const resolved = await mrComparisons.resolve(iid, { refresh: false })
      const position = typeof body.filePath === 'string' && (body.side === 'additions' || body.side === 'deletions') && Number.isInteger(body.lineNumber)
        ? buildPosition(resolved.patch, body.filePath, body.side, body.lineNumber as number, resolved.mr)
        : null
      if (!position) {
        return c.json({ error: 'invalid_position', message: '이 줄에는 GitLab 코멘트를 달 수 없습니다' }, 400)
      }
      await glab(path, { method: 'POST', body: { note: body.body, position } })
      return c.json({ ok: true }, 201)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.delete('/api/gitlab/mrs/:iid/drafts/:id', async (c) => {
    const id = c.req.param('id')
    if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)
    try {
      await glab(`${mrPath(parseIid(c.req.param('iid')))}/draft_notes/${id}`, { method: 'DELETE' })
      return c.json({ ok: true })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/gitlab/mrs/:iid/publish', async (c) => {
    try {
      await glab(`${mrPath(parseIid(c.req.param('iid')))}/draft_notes/bulk_publish`, { method: 'POST' })
      return c.json({ ok: true })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })
```

- [ ] **Step 9: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모두 PASS. tsc가 UI의 `ReviewComment` 사용처에서 오류를 내지 않는다(UI는 서버 응답을 받기만 하고 `ReviewComment`를 직접 만들지 않는다).

- [ ] **Step 10: 커밋**

```bash
git add src/types.ts src/gitlab/notes.ts src/gitlab/notes.test.ts src/server.ts src/server.gitlab.test.ts
git commit -m "feat: MR discussion 조회와 draft note 작성, 삭제, 제출 API 추가"
```

---

### Task 6: MR 모드 탭, MR 선택 드롭다운, MR diff 화면

**Files:**
- Create: `src/ui/gitlab.ts`, `src/ui/mrFilterStorage.ts`, `src/ui/hooks/useGitlab.ts`, `src/ui/components/MrSelect.tsx`
- Modify: `src/ui/comparison.ts`, `src/ui/hooks/useDiff.ts`, `src/ui/components/BranchPicker.tsx`, `src/ui/components/Toolbar.tsx`, `src/ui/App.tsx`, `src/ui/styles/global.css`
- Test: `src/ui/comparison.test.ts`, `src/ui/gitlab.test.ts`, `src/ui/mrFilterStorage.test.ts`

**Interfaces:**
- Consumes: `GitlabStatus`, `MrState`, `MrSummary`, `MrDetail` 타입 (Task 2, 3). UI는 `import type`으로만 가져온다.
- Produces:
  - `Comparison`에 `{ mode: 'mr'; iid: number | null }` 추가, `comparisonParams(...)`가 `URLSearchParams | null`을 돌려준다(MR 미선택 시 `null`)
  - `gitlabUnavailableMessage(status: Extract<GitlabStatus, { available: false }>): string`
  - `reconcileMrAvailability(c: Comparison, status: GitlabStatus | undefined): { comparison: Comparison; notice: string | null }`
  - `interface MrFilter { state: MrState; mine: boolean }`, `DEFAULT_MR_FILTER`, `loadMrFilter(repoRoot, storage?)`, `saveMrFilter(repoRoot, filter, storage?)`
  - `useGitlabStatus(enabled: boolean): { status: GitlabStatus | undefined; refresh: () => Promise<void> }`
  - `useMrList(filter: MrFilter, search: string, enabled: boolean): { mrs: MrSummary[]; loading: boolean; error: string | null }`
  - `useDiff(...)` 반환값에 `mr: MrDetail | undefined`
  - `Toolbar` prop `mrLink?: { iid: number; title: string; webUrl: string }`

- [ ] **Step 1: 비교 조합 테스트 수정과 추가**

`src/ui/comparison.test.ts`의 `comparisonParams` 테스트에서 `.toString()`을 `?.toString()`으로 바꾸고 다음 테스트를 추가한다:

```ts
describe('mr comparison', () => {
  it('builds params only when an MR is selected', () => {
    expect(comparisonParams({ mode: 'mr', iid: 7 }, { staged: true, untracked: true })?.toString()).toBe('mode=mr&iid=7')
    expect(comparisonParams({ mode: 'mr', iid: null }, { staged: true, untracked: true })).toBeNull()
  })

  it('saves and loads the selected MR', () => {
    const s = memoryStorage()
    saveComparison('/repo/a', { mode: 'mr', iid: 7 }, s)
    expect(loadComparison('/repo/a', s)).toEqual({ mode: 'mr', iid: 7 })
    s.setItem('diffx-comparison:/repo/a', JSON.stringify({ mode: 'mr', iid: 'x' }))
    expect(loadComparison('/repo/a', s)).toEqual({ mode: 'mr', iid: null })
  })

  it('keeps a saved MR during branch reconciliation', () => {
    expect(reconcileComparison({ mode: 'mr', iid: 7 }, branches)).toEqual({ comparison: { mode: 'mr', iid: 7 }, missing: [] })
  })
})
```

- [ ] **Step 2: 안내 문구와 필터 저장 테스트 작성**

`src/ui/gitlab.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gitlabUnavailableMessage, reconcileMrAvailability } from './gitlab'

describe('gitlabUnavailableMessage', () => {
  it('explains each reason', () => {
    expect(gitlabUnavailableMessage({ available: false, reason: 'not_installed', message: '' })).toBe('glab이 설치되어 있지 않습니다 (brew install glab)')
    expect(gitlabUnavailableMessage({ available: false, reason: 'auth', message: '', host: 'gitlab.mrblue.com' }))
      .toBe('glab 로그인이 필요합니다. 터미널에서 `glab auth login --hostname gitlab.mrblue.com`를 실행해 주세요')
    expect(gitlabUnavailableMessage({ available: false, reason: 'auth', message: '' }))
      .toBe('glab 로그인이 필요합니다. 터미널에서 `glab auth login`를 실행해 주세요')
    expect(gitlabUnavailableMessage({ available: false, reason: 'not_gitlab', message: '' })).toBe('원격 저장소가 GitLab이 아닙니다')
    expect(gitlabUnavailableMessage({ available: false, reason: 'api', message: 'glab: 500' })).toBe('glab: 500')
  })
})

describe('reconcileMrAvailability', () => {
  const ok = { available: true as const, host: 'h', project: 'p', webUrl: 'w', username: 'u' }

  it('keeps the MR while the status is loading or available', () => {
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, undefined)).toEqual({ comparison: { mode: 'mr', iid: 7 }, notice: null })
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, ok)).toEqual({ comparison: { mode: 'mr', iid: 7 }, notice: null })
  })

  it('returns to worktree with the reason when glab is unavailable', () => {
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, { available: false, reason: 'not_gitlab', message: '' }))
      .toEqual({ comparison: { mode: 'worktree' }, notice: '원격 저장소가 GitLab이 아닙니다' })
  })

  it('ignores other modes', () => {
    expect(reconcileMrAvailability({ mode: 'worktree' }, { available: false, reason: 'auth', message: '' }))
      .toEqual({ comparison: { mode: 'worktree' }, notice: null })
  })
})
```

`src/ui/mrFilterStorage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadMrFilter, saveMrFilter, DEFAULT_MR_FILTER } from './mrFilterStorage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}

describe('mrFilterStorage', () => {
  it('defaults to opened MRs without the mine filter', () => {
    expect(DEFAULT_MR_FILTER).toEqual({ state: 'opened', mine: false })
    expect(loadMrFilter('/repo', memoryStorage())).toEqual(DEFAULT_MR_FILTER)
  })

  it('stores the filter per repo', () => {
    const s = memoryStorage()
    saveMrFilter('/repo/a', { state: 'merged', mine: true }, s)
    expect(loadMrFilter('/repo/a', s)).toEqual({ state: 'merged', mine: true })
    expect(loadMrFilter('/repo/b', s)).toEqual(DEFAULT_MR_FILTER)
  })

  it('ignores broken values', () => {
    const s = memoryStorage()
    s.setItem('diffx-mr-filter:/repo', JSON.stringify({ state: 'closed', mine: true }))
    expect(loadMrFilter('/repo', s)).toEqual(DEFAULT_MR_FILTER)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec vitest run src/ui`
Expected: FAIL, `./gitlab`, `./mrFilterStorage` import 실패와 mr comparison 테스트 실패

- [ ] **Step 4: `src/ui/comparison.ts` 수정**

```ts
export type Comparison =
  | { mode: 'worktree' }
  | { mode: 'branch'; source: string; target: string }
  | { mode: 'mr'; iid: number | null }

export function comparisonParams(c: Comparison, opts: { staged: boolean; untracked: boolean }): URLSearchParams | null {
  if (c.mode === 'mr') return c.iid === null ? null : new URLSearchParams({ mode: 'mr', iid: String(c.iid) })
  if (c.mode === 'branch') {
    return new URLSearchParams({ mode: 'branch', source: c.source, target: c.target })
  }
  return new URLSearchParams({ mode: 'worktree', staged: String(opts.staged), untracked: String(opts.untracked) })
}
```

`loadComparison`의 `worktree` 분기 다음에 추가:

```ts
    if (parsed?.mode === 'mr') {
      return { mode: 'mr', iid: Number.isInteger(parsed.iid) && parsed.iid > 0 ? parsed.iid : null }
    }
```

`reconcileComparison` 첫 줄 다음에 추가:

```ts
  if (saved.mode === 'mr') return { comparison: saved, missing: [] }
```

- [ ] **Step 5: `src/ui/gitlab.ts`, `src/ui/mrFilterStorage.ts` 작성**

`src/ui/gitlab.ts`:

```ts
import type { GitlabStatus } from '../gitlab/mr'
import type { Comparison } from './comparison'

export function gitlabUnavailableMessage(status: Extract<GitlabStatus, { available: false }>): string {
  switch (status.reason) {
    case 'not_installed':
      return 'glab이 설치되어 있지 않습니다 (brew install glab)'
    case 'auth':
      return `glab 로그인이 필요합니다. 터미널에서 \`glab auth login${status.host ? ` --hostname ${status.host}` : ''}\`를 실행해 주세요`
    case 'not_gitlab':
      return '원격 저장소가 GitLab이 아닙니다'
    default:
      return status.message
  }
}

export function reconcileMrAvailability(c: Comparison, status: GitlabStatus | undefined): { comparison: Comparison; notice: string | null } {
  if (c.mode !== 'mr' || !status || status.available) return { comparison: c, notice: null }
  return { comparison: { mode: 'worktree' }, notice: gitlabUnavailableMessage(status) }
}
```

`src/ui/mrFilterStorage.ts`:

```ts
import type { MrState } from '../gitlab/mr'

export interface MrFilter {
  state: MrState
  mine: boolean
}

export const DEFAULT_MR_FILTER: MrFilter = { state: 'opened', mine: false }

const STORAGE_PREFIX = 'diffx-mr-filter:'
const STATES: MrState[] = ['opened', 'merged', 'all']

export function loadMrFilter(repoRoot: string, storage: Pick<Storage, 'getItem'> = localStorage): MrFilter {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_PREFIX + repoRoot) ?? 'null')
    if (parsed && STATES.includes(parsed.state) && typeof parsed.mine === 'boolean') {
      return { state: parsed.state, mine: parsed.mine }
    }
  } catch {}
  return DEFAULT_MR_FILTER
}

export function saveMrFilter(repoRoot: string, filter: MrFilter, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_PREFIX + repoRoot, JSON.stringify(filter))
  } catch {}
}
```

- [ ] **Step 6: UI 단위 테스트 통과 확인**

Run: `pnpm exec vitest run src/ui`
Expected: PASS

- [ ] **Step 7: `useGitlab.ts` 작성**

`src/ui/hooks/useGitlab.ts`:

```ts
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { GitlabStatus, MrSummary } from '../../gitlab/mr'
import type { MrFilter } from '../mrFilterStorage'

const STATUS_KEY = ['gitlab-status']

export function useGitlabStatus(enabled: boolean) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async (): Promise<GitlabStatus> => (await fetch('/api/gitlab/status')).json(),
    enabled,
    staleTime: Infinity,
  })
  const refresh = useCallback(async () => {
    const next: GitlabStatus = await (await fetch('/api/gitlab/status?refresh=true')).json()
    queryClient.setQueryData(STATUS_KEY, next)
  }, [queryClient])
  return { status: data, refresh }
}

export function useMrList(filter: MrFilter, search: string, enabled: boolean) {
  const { data, isFetching, error } = useQuery({
    queryKey: ['mr-list', filter.state, filter.mine, search],
    queryFn: async (): Promise<MrSummary[]> => {
      const params = new URLSearchParams({ state: filter.state, mine: String(filter.mine), search })
      const res = await fetch(`/api/gitlab/mrs?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      return body
    },
    enabled,
  })
  return { mrs: data ?? [], loading: isFetching, error: error ? (error as Error).message : null }
}
```

- [ ] **Step 8: `MrSelect.tsx` 작성**

`src/ui/components/MrSelect.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MrState } from '../../gitlab/mr'
import { useMrList } from '../hooks/useGitlab'
import { loadMrFilter, saveMrFilter, type MrFilter } from '../mrFilterStorage'

const STATE_OPTIONS: { value: MrState; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'opened', label: '열린 MR' },
  { value: 'merged', label: '머지된 MR' },
]

const STATE_BADGE: Record<string, string> = { merged: '머지됨', closed: '닫힘' }

interface MrSelectProps {
  repoRoot: string
  value: number | null
  title: string | null
  onChange: (iid: number) => void
}

export function MrSelect({ repoRoot, value, title, onChange }: MrSelectProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MrFilter>(() => loadMrFilter(repoRoot))
  const rootRef = useRef<HTMLDivElement>(null)
  const { mrs, loading, error } = useMrList(filter, search, open)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input])

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const updateFilter = (next: MrFilter) => {
    setFilter(next)
    saveMrFilter(repoRoot, next)
  }

  const select = (iid: number) => {
    onChange(iid)
    setOpen(false)
  }

  return (
    <div className="ref-select" ref={rootRef}>
      <button className="btn btn-sm ref-select-button mr-select-button" onClick={() => setOpen(!open)} title={title ?? 'MR 선택'}>
        <span className="ref-select-value">{value === null ? 'MR 선택' : `!${value} ${title ?? ''}`}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ref-select-menu mr-select-menu">
          <input
            className="ref-select-search"
            autoFocus
            placeholder="MR 제목 검색"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="mr-select-filters">
            <div className="toolbar-toggle">
              {STATE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`btn btn-sm ${filter.state === o.value ? 'btn-active' : ''}`}
                  onClick={() => updateFilter({ ...filter, state: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <label className="mr-select-mine">
              <input
                type="checkbox"
                checked={filter.mine}
                onChange={(e) => updateFilter({ ...filter, mine: e.target.checked })}
              />
              내가 올린 MR
            </label>
          </div>
          <div className="ref-select-list">
            {error && <div className="ref-select-empty mr-select-error">{error}</div>}
            {!error && loading && mrs.length === 0 && <div className="ref-select-empty">불러오는 중</div>}
            {!error && !loading && mrs.length === 0 && <div className="ref-select-empty">MR이 없습니다</div>}
            {mrs.map((mr) => (
              <button
                key={mr.iid}
                className={`mr-select-item ${mr.iid === value ? 'ref-select-item-active' : ''}`}
                onClick={() => select(mr.iid)}
              >
                <span className="mr-select-title">
                  !{mr.iid} {mr.title}
                  {STATE_BADGE[mr.state] && <span className="mr-badge">{STATE_BADGE[mr.state]}</span>}
                </span>
                <span className="mr-select-meta">
                  <span>{mr.sourceBranch} → {mr.targetBranch}</span>
                  <span>{mr.author}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 9: `BranchPicker.tsx` 수정**

import와 props를 추가한다:

```tsx
import type { GitlabStatus } from '../../gitlab/mr'
import { gitlabUnavailableMessage } from '../gitlab'
import { MrSelect } from './MrSelect'

interface BranchPickerProps {
  // 기존 props 그대로
  repoRoot: string
  gitlab: GitlabStatus | undefined
  mrTitle: string | null
  mrRefreshing: boolean
  onRefreshMr: () => void
}
```

함수 인자 구조 분해에 `repoRoot, gitlab, mrTitle, mrRefreshing, onRefreshMr`를 추가하고 본문을 다음처럼 바꾼다:

```tsx
  const mrUnavailable = gitlab && !gitlab.available ? gitlabUnavailableMessage(gitlab) : null

  return (
    <div className="branch-picker">
      <div className="toolbar-toggle">
        {/* 작업 중 변경사항, 브랜치 비교 버튼은 그대로 */}
        <span title={mrUnavailable ?? undefined}>
          <button
            className={`btn btn-sm ${comparison.mode === 'mr' ? 'btn-active' : ''}`}
            onClick={() => comparison.mode !== 'mr' && onChange({ mode: 'mr', iid: null })}
            disabled={!gitlab?.available}
          >
            MR
          </button>
        </span>
      </div>
      {/* comparison.mode === 'branch' 블록은 그대로 */}
      {comparison.mode === 'mr' && (
        <div className="branch-picker-refs">
          <MrSelect
            repoRoot={repoRoot}
            value={comparison.iid}
            title={mrTitle}
            onChange={(iid) => onChange({ mode: 'mr', iid })}
          />
          <button
            className="btn btn-sm"
            onClick={onRefreshMr}
            disabled={mrRefreshing}
            title="MR 목록, diff, 코멘트 새로고침"
          >
            <RefreshCw size={14} className={mrRefreshing ? 'spin' : ''} />
          </button>
        </div>
      )}
      {/* 메시지 블록은 그대로 */}
    </div>
  )
```

비활성 버튼은 마우스 이벤트를 받지 않아 `title` 툴팁이 뜨지 않을 수 있어서 `span`에 `title`을 둔다.

- [ ] **Step 10: `useDiff.ts` 수정**

`DiffData`에 `mr?: MrDetail`을 추가하고(`import type { MrDetail } from '../../gitlab/mr'`), `mode` 타입에 `'mr'`을 추가한다. effect 첫 줄을 다음으로 바꿔 MR 미선택 시 이전 diff를 지운다:

```ts
    if (query === null) {
      setData(null)
      setLoading(false)
      return
    }
```

반환값에 `mr: data?.mr,`를 추가한다.

- [ ] **Step 11: `Toolbar.tsx`에 MR 링크 추가**

props에 `mrLink?: { iid: number; title: string; webUrl: string }`를 추가하고 `branchPicker` 렌더 앞에 넣는다:

```tsx
        {mrLink && (
          <a className="toolbar-mr-link" href={mrLink.webUrl} target="_blank" rel="noreferrer" title="GitLab에서 열기">
            !{mrLink.iid} {mrLink.title}
          </a>
        )}
```

Electron 창은 `setWindowOpenHandler`가 `target="_blank"` 링크를 외부 브라우저로 연다(`electron/repoWindows.ts`).

- [ ] **Step 12: `App.tsx` 연결**

import 추가:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useGitlabStatus } from './hooks/useGitlab'
import { reconcileMrAvailability } from './gitlab'
```

`useBranches` 호출 다음에 추가:

```tsx
  const gitlab = useGitlabStatus(branchMode)
  const queryClient = useQueryClient()
```

비교 조합 복원 effect에서 `reconcileComparison` 결과에 MR 가용성을 적용하고 deps에 `gitlab.status`를 추가한다:

```tsx
    const base = comparison ?? loadComparison(repo.root)
    const { comparison: reconciled, missing } = reconcileComparison(base, branches)
    const { comparison: next, notice: mrNotice } = reconcileMrAvailability(reconciled, gitlab.status)
    if (missing.length > 0) {
      setNotice(`저장된 브랜치 ${missing.join(', ')}을 찾지 못해 기본값으로 바꿨습니다`)
    }
    if (mrNotice) setNotice(mrNotice)
    if (JSON.stringify(next) !== JSON.stringify(comparison)) setComparison(next)
  }, [repo, branches, branchesError, gitlab.status])
```

`useDiff` 구조 분해에 `mr: diffMr`를 추가하고 `handleFetch` 다음에 새로고침 핸들러를 추가한다:

```tsx
  const [mrRefreshing, setMrRefreshing] = useState(false)
  const handleRefreshMr = useCallback(async () => {
    setMrRefreshing(true)
    try {
      await gitlab.refresh()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mr-list'] }),
        queryClient.invalidateQueries({ queryKey: ['mr-threads'] }),
      ])
      setDiffReloadToken((t) => t + 1)
    } finally {
      setMrRefreshing(false)
    }
  }, [gitlab.refresh, queryClient])
```

`BranchPicker`에 props를 넘긴다:

```tsx
          <BranchPicker
            comparison={comparison}
            branches={branches}
            fetching={fetching}
            fetchError={fetchError}
            notice={notice}
            onChange={handleComparisonChange}
            onFetch={handleFetch}
            repoRoot={repo.root}
            gitlab={gitlab.status}
            mrTitle={diffMr?.title ?? null}
            mrRefreshing={mrRefreshing}
            onRefreshMr={handleRefreshMr}
          />
```

`Toolbar`에 `mrLink={comparison.mode === 'mr' && diffMr ? diffMr : undefined}`를 넘긴다.

`<main>` 안의 조건 렌더를 다음으로 바꾼다:

```tsx
          {comparison.mode === 'mr' && comparison.iid === null ? (
            <div className="empty-state"><p>MR을 선택해 주세요</p></div>
          ) : loading ? (
            <div className="loading"><p>{comparison.mode === 'mr' ? 'MR 커밋을 가져오는 중입니다' : 'Loading diff...'}</p></div>
          ) : error ? (
            <div className="empty-state">
              <p>{error}</p>
              {comparison.mode === 'mr' && (
                <button className="btn btn-sm" onClick={() => setDiffReloadToken((t) => t + 1)}>다시 시도</button>
              )}
            </div>
          ) : identical ? (
```

- [ ] **Step 13: CSS 추가**

`src/ui/styles/global.css`의 `.ref-select-item-active` 규칙 다음에 추가:

```css
.mr-select-menu {
    width: 420px;
}

.mr-select-filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
}

.mr-select-mine {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    white-space: nowrap;
}

.mr-select-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 6px 10px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
}

.mr-select-item:hover {
    background: var(--bg-secondary);
}

.mr-select-title {
    font-size: 13px;
    white-space: normal;
}

.mr-select-meta {
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.mr-select-error {
    color: var(--danger);
    white-space: normal;
}

.mr-badge {
    margin-left: 6px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-secondary);
}

.toolbar-mr-link {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    color: var(--primary);
    text-decoration: none;
}

.toolbar-mr-link:hover {
    text-decoration: underline;
}
```

- [ ] **Step 14: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build`
Expected: 모두 성공. `vite build`가 `src/gitlab/mr.ts`의 node 모듈을 번들에 넣지 않는다(UI는 `import type`만 쓴다). 빌드 결과 `dist/client/assets/*.js`에 `child_process`가 없는지 `grep -l child_process dist/client/assets/*.js`로 확인한다. Expected: 출력 없음

- [ ] **Step 15: 커밋**

```bash
git add src/ui
git commit -m "feat: MR 모드 탭과 MR 선택 드롭다운, MR diff 화면 추가"
```

---

### Task 7: MR 코멘트 화면과 리뷰 제출

**Files:**
- Create: `src/ui/hooks/useMrComments.ts`
- Modify: `src/ui/hooks/useComments.ts`, `src/ui/components/CommentForm.tsx`, `src/ui/components/CommentBubble.tsx`, `src/ui/components/FileDiffCard.tsx`, `src/ui/components/DiffViewer.tsx`, `src/ui/components/CommentTracker.tsx`, `src/ui/components/Toolbar.tsx`, `src/ui/App.tsx`, `src/ui/styles/global.css`
- Test: `src/ui/formatComments.test.ts`

**Interfaces:**
- Consumes: `MrThreads` 타입 (Task 5), `ReviewComment.origin` (Task 5), MR 코멘트 API (Task 5)
- Produces:
  - `formatComments(comments: ReviewComment[]): string` (`useComments.ts`에서 export)
  - `useComments(key).addComment(...)`가 `Promise<void>`를 돌려준다
  - `useMrComments(iid: number | null): MrThreads & { addDraft, addReply, deleteDraft, publish, submitting, submitError }`
  - `CommentForm` props `onSubmit: (body: string) => void | Promise<void>`, `error?: string | null`, `placeholder?: string`
  - `CommentBubble` prop `onReply?: (discussionId: string, body: string) => Promise<void>`
  - `FileDiffCard`, `DiffViewer`의 `onAddComment` 반환 타입 `void | Promise<void>`, 새 prop `onReplyComment?`
  - `Toolbar` prop `submitReview?: { count: number; submitting: boolean; error: string | null; onSubmit: () => void }`

- [ ] **Step 1: `formatComments` 테스트 작성**

`src/ui/formatComments.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatComments } from './hooks/useComments'
import type { ReviewComment } from '../types'

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: '1', key: 'k', origin: 'local', filePath: 'a.ts', side: 'additions', lineNumber: 3,
  lineContent: 'x', body: '확인', status: 'open', createdAt: 0, replies: [], ...over,
})

describe('formatComments', () => {
  it('returns an empty string without comments', () => {
    expect(formatComments([])).toBe('')
  })

  it('groups comments by file', () => {
    expect(formatComments([comment({}), comment({ id: '2', side: 'deletions', lineNumber: 1, lineContent: 'y', body: '삭제' })])).toBe([
      '<code-review-comments>',
      '<file path="a.ts">',
      '<comment line="3">',
      '<code>+ x</code>',
      '확인',
      '</comment>',
      '<comment line="1">',
      '<code>- y</code>',
      '삭제',
      '</comment>',
      '</file>',
      '</code-review-comments>',
    ].join('\n'))
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec vitest run src/ui/formatComments.test.ts`
Expected: FAIL, `formatComments is not a function`

- [ ] **Step 3: `useComments.ts` 수정**

`formatAllComments` 내부 로직을 모듈 함수로 옮긴다:

```ts
export function formatComments(comments: ReviewComment[]): string {
  if (comments.length === 0) return ''

  const grouped = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    const list = grouped.get(comment.filePath) ?? []
    list.push(comment)
    grouped.set(comment.filePath, list)
  }

  const lines: string[] = ['<code-review-comments>']
  for (const [filePath, fileComments] of grouped) {
    lines.push(`<file path="${filePath}">`)
    for (const comment of fileComments) {
      lines.push(`<comment line="${comment.lineNumber}">`)
      const prefix = comment.side === 'additions' ? '+' : '-'
      lines.push(`<code>${prefix} ${comment.lineContent}</code>`)
      lines.push(comment.body)
      lines.push('</comment>')
    }
    lines.push('</file>')
  }
  lines.push('</code-review-comments>')

  return lines.join('\n')
}
```

훅 안에서는 다음처럼 쓴다:

```ts
  const formatAllComments = useCallback(() => formatComments(comments), [comments])

  const addComment = useCallback(
    async (filePath: string, side: 'deletions' | 'additions', lineNumber: number, lineContent: string, body: string) => {
      await addMutation.mutateAsync({ filePath, side, lineNumber, lineContent, body })
    },
    [addMutation],
  )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec vitest run src/ui/formatComments.test.ts`
Expected: PASS

- [ ] **Step 5: `useMrComments.ts` 작성**

`src/ui/hooks/useMrComments.ts`:

```ts
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReviewComment } from '../../types'
import type { MrThreads } from '../../gitlab/notes'

const EMPTY: MrThreads = { comments: [], outdatedCount: 0, draftCount: 0 }

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init)
  if (res.ok) return
  const body = await res.json().catch(() => null)
  throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`)
}

function postJson(payload: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}

export function useMrComments(iid: number | null) {
  const queryClient = useQueryClient()
  const { data = EMPTY } = useQuery({
    queryKey: ['mr-threads', iid],
    queryFn: async (): Promise<MrThreads> => {
      const res = await fetch(`/api/gitlab/mrs/${iid}/threads`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`)
      return body
    },
    enabled: iid !== null,
    refetchInterval: 30_000,
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const base = `/api/gitlab/mrs/${iid}`
  const refetch = useCallback(() => queryClient.invalidateQueries({ queryKey: ['mr-threads', iid] }), [queryClient, iid])

  const addDraft = useCallback(
    async (filePath: string, side: ReviewComment['side'], lineNumber: number, _lineContent: string, body: string) => {
      await send(`${base}/drafts`, postJson({ filePath, side, lineNumber, body }))
      await refetch()
    },
    [base, refetch],
  )

  const addReply = useCallback(
    async (discussionId: string, body: string) => {
      await send(`${base}/drafts`, postJson({ discussionId, body }))
      await refetch()
    },
    [base, refetch],
  )

  const deleteDraft = useCallback(
    async (id: string) => {
      await send(`${base}/drafts/${id.replace(/^draft:/, '')}`, { method: 'DELETE' })
      await refetch()
    },
    [base, refetch],
  )

  const publish = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await send(`${base}/publish`, { method: 'POST' })
      await refetch()
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }, [base, refetch])

  return { ...data, addDraft, addReply, deleteDraft, publish, submitting, submitError }
}
```

- [ ] **Step 6: `CommentForm.tsx` 수정**

```tsx
interface CommentFormProps {
  onSubmit: (body: string) => void | Promise<void>
  onCancel: () => void
  error?: string | null
  placeholder?: string
}

export function CommentForm({ onSubmit, onCancel, error, placeholder = 'Leave a review comment...' }: CommentFormProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
    } finally {
      setSubmitting(false)
    }
  }
```

`handleKeyDown`은 그대로 두고 `handleSubmit()` 호출은 `void handleSubmit()`으로 바꾼다. textarea의 `placeholder`를 `{placeholder}`로 바꾸고 액션 영역 위에 오류를 보여준다:

```tsx
      {error && <div className="comment-form-error">{error}</div>}
      <div className="comment-form-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={!body.trim() || submitting}>
          Comment
        </button>
      </div>
```

- [ ] **Step 7: `CommentBubble.tsx` 수정**

```tsx
import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot } from 'lucide-react'
import type { ReviewComment } from '../../types'
import { timeAgo } from '../utils'
import { CommentForm } from './CommentForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onReply?: (discussionId: string, body: string) => Promise<void>
}

export function CommentBubble({ comment, onDelete, onReply }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const isResolved = comment.status === 'resolved'
  const canDelete = comment.origin !== 'gitlab' && !isResolved

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const submitReply = async (body: string) => {
    try {
      await onReply!(comment.discussionId!, body)
      setReplying(false)
      setReplyError(null)
    } catch (err) {
      setReplyError((err as Error).message)
    }
  }

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        {comment.author && <span className="comment-bubble-author">{comment.author}</span>}
        {comment.origin === 'draft'
          ? <span className="comment-badge-draft">초안</span>
          : <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>}
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
        )}
        {canDelete && (
          <button className="comment-bubble-delete" onClick={() => onDelete(comment.id)} title="Delete comment">
            &times;
          </button>
        )}
      </div>
      <div className="comment-bubble-body">{comment.body}</div>
      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="comment-reply">
              <div className="comment-reply-header">
                {reply.author
                  ? <span className="comment-bubble-author">{reply.author}</span>
                  : !reply.draft && <Bot size={16} className="comment-reply-avatar" />}
                {reply.draft
                  ? <span className="comment-badge-draft">초안</span>
                  : <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>}
                {reply.draft && (
                  <button className="comment-bubble-delete" onClick={() => onDelete(reply.id)} title="초안 삭제">
                    &times;
                  </button>
                )}
              </div>
              <div className="comment-reply-body">{reply.body}</div>
            </div>
          ))}
        </div>
      )}
      {comment.origin === 'gitlab' && onReply && comment.discussionId && (
        replying ? (
          <CommentForm
            placeholder="답글 작성"
            error={replyError}
            onSubmit={submitReply}
            onCancel={() => {
              setReplying(false)
              setReplyError(null)
            }}
          />
        ) : (
          <button className="btn btn-sm comment-reply-button" onClick={() => setReplying(true)}>
            답글
          </button>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 8: `FileDiffCard.tsx`, `DiffViewer.tsx` 수정**

`FileDiffCard` props:

```tsx
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void | Promise<void>
  onReplyComment?: (discussionId: string, body: string) => Promise<void>
```

구조 분해에 `onReplyComment`를 추가하고 `const [pendingError, setPendingError] = useState<string | null>(null)`를 추가한다. `renderAnnotation`의 두 분기를 다음으로 바꾼다:

```tsx
              if ('_pending' in annotation.metadata) {
                const target = pending!
                return (
                  <CommentForm
                    error={pendingError}
                    onSubmit={async (body) => {
                      const lineContent = getLineContent(target.side, target.lineNumber)
                      try {
                        await onAddComment(filePath, target.side, target.lineNumber, lineContent, body)
                        setPending(null)
                        setPendingError(null)
                      } catch (err) {
                        setPendingError((err as Error).message)
                      }
                    }}
                    onCancel={() => {
                      setPending(null)
                      setPendingError(null)
                    }}
                  />
                )
              }
              return (
                <CommentBubble
                  comment={annotation.metadata as ReviewComment}
                  onDelete={onDeleteComment}
                  onReply={onReplyComment}
                />
              )
```

`DiffViewer`의 props 타입에 같은 `onAddComment` 반환 타입과 `onReplyComment?: (discussionId: string, body: string) => Promise<void>`를 추가하고, 구조 분해에 넣은 뒤 `FileDiffCard`에 `onReplyComment={onReplyComment}`로 넘긴다.

- [ ] **Step 9: `CommentTracker.tsx` 수정**

`<span className="ct-item-time">`의 내용을 다음으로 바꾼다:

```tsx
                  <span className="ct-item-time">{comment.origin === 'draft' ? '초안' : timeAgo(comment.createdAt)}</span>
```

- [ ] **Step 10: `Toolbar.tsx`에 리뷰 제출 버튼 추가**

props에 `submitReview?: { count: number; submitting: boolean; error: string | null; onSubmit: () => void }`를 추가하고 `Copy comments` 버튼 앞에 넣는다(`RefreshCw`를 lucide-react import에 추가):

```tsx
        {submitReview && (
          <div className="toolbar-submit">
            <button
              className="btn btn-primary btn-sm"
              onClick={submitReview.onSubmit}
              disabled={submitReview.count === 0 || submitReview.submitting}
            >
              {submitReview.submitting && <RefreshCw size={14} className="spin" />}
              리뷰 제출 ({submitReview.count})
            </button>
            {submitReview.error && <div className="toolbar-submit-error">{submitReview.error}</div>}
          </div>
        )}
```

- [ ] **Step 11: `App.tsx` 연결**

import 추가:

```tsx
import { useComments, formatComments } from './hooks/useComments'
import { useMrComments } from './hooks/useMrComments'
```

기존 `const { comments, addComment, removeComment, copyAllComments } = useComments(key)`를 다음으로 바꾼다:

```tsx
  const isMr = comparison?.mode === 'mr'
  const mrIid = comparison?.mode === 'mr' ? comparison.iid : null
  const localComments = useComments(isMr ? null : key)
  const mrComments = useMrComments(mrIid)
  const comments = isMr ? mrComments.comments : localComments.comments
  const addComment = isMr ? mrComments.addDraft : localComments.addComment
  const removeComment = useCallback((id: string) => {
    if (!isMr) return localComments.removeComment(id)
    mrComments.deleteDraft(id).catch((err) => window.alert(`초안 삭제 실패: ${(err as Error).message}`))
  }, [isMr, localComments.removeComment, mrComments.deleteDraft])
  const copyAllComments = useCallback(() => navigator.clipboard.writeText(formatComments(comments)), [comments])
```

`sidebarContent`의 `CommentTracker` 앞에 이전 버전 코멘트 안내를 추가한다:

```tsx
      {!sidebar.collapsed && isMr && diffMr && mrComments.outdatedCount > 0 && (
        <div className="mr-outdated-notice">
          이전 버전에 남은 코멘트 {mrComments.outdatedCount}개는 <a href={diffMr.webUrl} target="_blank" rel="noreferrer">GitLab</a>에서 확인해 주세요
        </div>
      )}
```

`Toolbar`에 넘긴다:

```tsx
        submitReview={isMr && mrIid !== null ? {
          count: mrComments.draftCount,
          submitting: mrComments.submitting,
          error: mrComments.submitError,
          onSubmit: () => void mrComments.publish(),
        } : undefined}
```

`DiffViewer`에 `onReplyComment={isMr ? mrComments.addReply : undefined}`를 넘긴다.

- [ ] **Step 12: CSS 추가**

`src/ui/styles/global.css`의 `.comment-reply-body` 규칙 다음에 추가:

```css
.comment-bubble-author {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
}

.comment-badge-draft {
    padding: 0 6px;
    border: 1px solid var(--comment-border);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-secondary);
}

.comment-reply-button {
    margin-top: 8px;
}

.comment-form-error {
    margin: 4px 0;
    font-size: 12px;
    color: var(--danger);
}

.toolbar-submit {
    position: relative;
}

.toolbar-submit-error {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    max-width: 360px;
    padding: 4px 8px;
    background: var(--bg);
    border: 1px solid var(--danger);
    border-radius: 4px;
    font-size: 12px;
    color: var(--danger);
    white-space: normal;
    z-index: 30;
}

.mr-outdated-notice {
    margin: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-secondary);
}
```

- [ ] **Step 13: 전체 테스트, 타입 검사, 빌드**

Run: `pnpm test && pnpm exec tsc --noEmit -p . && pnpm run build`
Expected: 모두 성공

- [ ] **Step 14: 커밋**

```bash
git add src/ui
git commit -m "feat: MR 코멘트 초안 작성, 답글, 리뷰 제출 화면 추가"
```

---

### Task 8: 실제 GitLab 확인과 문서

**Files:**
- Modify: `README.md`
- Modify: `docs/backlog/gitlab-mr-integration.md`

- [ ] **Step 1: 사내 저장소로 읽기 API 확인 (사용자 확인 후)**

이 단계는 사내 저장소에서 `git fetch`를 실행해 그 저장소의 로컬 객체를 늘린다. 사용자에게 대상 저장소 경로를 확인받은 뒤 실행한다. 스크래치 디렉터리에 아래 스크립트를 두고 `pnpm exec tsx <스크립트> <저장소 경로> <MR iid>`로 실행한다:

```ts
import { createApp } from '/Users/byeonjaejeong/Desktop/diffx/src/server'

const [repoPath, iid] = process.argv.slice(2)
const app = createApp({ repoPath, clientDir: '/tmp' })
const show = async (path: string) => {
  const res = await app.request(path)
  const text = await res.text()
  console.log(res.status, path, text.slice(0, 300))
}
await show('/api/gitlab/status')
await show('/api/gitlab/mrs?state=opened')
await show('/api/gitlab/mrs?state=merged&mine=true')
await show(`/api/diff?mode=mr&iid=${iid}`)
await show(`/api/gitlab/mrs/${iid}/threads`)
```

Expected: 다섯 요청 모두 200. diff 응답에 `"key":"mr:<iid>"`, threads 응답에 `comments` 배열

- [ ] **Step 2: 앱에서 직접 확인 (사용자가 실행)**

사용자에게 `pnpm run dev:app` 실행을 요청하고 다음을 함께 확인한다.

1. 사내 저장소를 연 뒤 툴바 `MR` 탭 클릭 시 MR 선택 드롭다운이 나온다.
2. 드롭다운 기본값이 `열린 MR`, `내가 올린 MR` 체크 해제다. `머지된 MR` 클릭 시 머지된 MR 목록으로 바뀌고 `머지됨` 배지가 보인다. 창을 닫았다 열어도 필터가 유지된다.
3. MR 클릭 시 "MR 커밋을 가져오는 중입니다" 안내 후 diff가 나온다. 툴바의 MR 제목 클릭 시 외부 브라우저에서 GitLab MR이 열린다.
4. 기존 discussion이 해당 줄에 작성자 이름과 함께 보인다.
5. GitHub 원격 저장소(이 저장소)를 열면 `MR` 버튼이 비활성이고 마우스를 올리면 "원격 저장소가 GitLab이 아닙니다"가 보인다.

- [ ] **Step 3: 코멘트 등록 확인 (사용자가 MR 지정)**

실제 MR에 코멘트가 공개되므로 사용자가 테스트용 MR을 지정한 경우에만 진행한다.

1. 추가 줄, 삭제 줄, 변경되지 않은 줄, 펼친 context 줄에 각각 코멘트 저장 시 `초안` 배지와 함께 보이고 `리뷰 제출 (4)`가 된다.
2. GitLab 웹의 MR 화면에서 같은 줄에 pending 코멘트 4개가 보인다.
3. 기존 discussion의 `답글` 클릭 후 저장 시 답글 목록 끝에 `초안` 답글이 보이고 `리뷰 제출 (5)`가 된다.
4. 초안 하나를 삭제하면 `리뷰 제출 (4)`가 된다.
5. `리뷰 제출` 클릭 후 초안 배지가 사라지고 GitLab 웹에서 코멘트가 공개되어 있다.

- [ ] **Step 4: README와 백로그 문서 갱신**

`README.md`의 기존 한국어 추가 섹션 뒤에 다음 섹션을 추가한다:

```markdown
## GitLab MR 리뷰

`MR` 탭에서 현재 저장소의 GitLab MR을 골라 diff를 보고 코멘트를 남길 수 있습니다.

1. glab을 설치하고 사내 GitLab에 로그인합니다.
   ```bash
   brew install glab
   glab auth login --hostname gitlab.mrblue.com
   ```
2. 앱에서 저장소를 열고 툴바의 `MR` 탭을 클릭합니다. 원격 저장소가 GitLab이 아니거나 glab 로그인이 안 되어 있으면 `MR` 버튼이 비활성으로 보이고 마우스를 올리면 이유가 나옵니다.
3. MR 선택 드롭다운에서 MR을 고르면 그 MR의 diff가 열립니다.
4. diff 줄에 남긴 코멘트와 기존 코멘트의 답글은 GitLab에 초안으로 저장됩니다. 툴바의 `리뷰 제출` 클릭 시 초안이 모두 공개됩니다.

`브랜치 비교` 탭에서 남긴 코멘트는 GitLab에 보내지 않고 앱 안에서만 보입니다.
```

`docs/backlog/gitlab-mr-integration.md`의 1~3번 제목 끝에 ` (구현됨)`을 붙이고, `## 구현 전에 정할 것` 섹션을 다음으로 바꾼다:

```markdown
## 1~3번 결정 사항

`docs/superpowers/specs/2026-09-30-gitlab-mr-integration-design.md`에 정리했다.
```

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/backlog/gitlab-mr-integration.md
git commit -m "docs: GitLab MR 리뷰 사용법과 백로그 상태 갱신"
```
