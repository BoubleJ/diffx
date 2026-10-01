# AI 리뷰 대화 보존 기간과 대화 목록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정한 일 수가 지난 AI 리뷰 대화를 자동으로 삭제하고, 오른쪽 패널 `대화 목록` 탭에서 저장소의 대화를 보고 삭제하거나 그 비교 대상으로 이동한다. `AI 리뷰` 탭의 `새 대화` 버튼은 `대화 삭제`로 바꾼다.

**Architecture:** 서버는 `settings.ts`에 `reviewRetentionDays`를 추가하고 `ReviewStore`에 `list`와 `prune`을 추가한다. `prune`은 서버 시작 시와 설정 저장 시 실행한다. `GET /api/review/conversations`를 새로 만들고 `DELETE /api/review/conversation`은 `key` 쿼리를 받는다. UI는 키 해석과 표시용 순수 함수를 `comparison.ts`와 `reviewConversations.ts`에 두고, `ConversationList`가 react-query `['review', 'conversations']` 키로 목록을 불러온다. 기존 `useReview`가 `['review']`를 무효화하므로 답변 완료와 삭제 시 목록도 함께 갱신된다.

**Tech Stack:** TypeScript, Hono, React 19, @tanstack/react-query, vitest

**Spec:** `docs/superpowers/specs/2026-10-01-review-conversation-management-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 설정 키: `reviewRetentionDays: number | null`. 기본값 30. `null`은 삭제 안 함. 0은 `null`로 저장한다.
- 보존 기간 기준: 그 대화의 마지막 질문 시각(`messages[].createdAt` 중 최댓값). 메시지가 없거나 읽지 못한 파일은 파일 수정 시각.
- 정리 범위: `reviews` 폴더 아래 모든 저장소 폴더. 빈 저장소 폴더도 지운다.
- 대화 목록 범위: 지금 연 저장소의 대화만.
- 화면 문구(그대로 쓴다)
  - 설정 항목 `AI 대화 보존 기간`, 단위 `일`, placeholder `삭제 안 함`
  - 탭 버튼 `대화 목록`
  - 목록 줄 `질문 N개 · YYYY-MM-DD HH:mm`, 버튼 `삭제`
  - 브랜치 표시 `<source> → <target>`, MR 표시 `MR !<iid>`
  - `저장된 대화가 없습니다`, `대화 목록을 불러오지 못했습니다`, `답변을 만드는 중인 대화는 삭제할 수 없습니다`
  - 확인 창: 목록 `이 대화의 모든 질문과 답변을 삭제할까요?`, AI 리뷰 탭 `이 비교의 모든 질문과 답변을 삭제할까요?`
  - AI 리뷰 탭 버튼 `대화 삭제`
- API: `GET /api/review/conversations` → `{ key, questionCount, lastAt, running }[]`. `DELETE /api/review/conversation?key=<key>` → 잘못된 키 400 `{ error: 'invalid_key' }`, 답변 중 409 `{ error: 'running' }`.
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다. 사용자가 실행을 요청하면 에이전트가 실행한다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 빌드: `pnpm run build:electron`. 작업 시작 시점에 테스트 411개가 통과한다.
- 작업 위치: `main`에서 worktree `../reviewHelper-conversations`와 브랜치 `feature/review-conversations`를 만들어 작업한다.

## Review Focus

1. `useSettings`의 `updateSettings`는 설정 하나를 바꿀 때도 전체 설정을 PUT한다. 그래서 Soft wrap만 바꿔도 `reviewRetentionDays`가 본문에 실려 정리가 실행된다. 같은 값으로 다시 정리하므로 결과는 같아야 한다. Task 3 테스트 `prunes old conversations when the retention days are saved`가 같은 값 저장을 확인한다.
2. 보존 기간 input에 `3`을 거쳐 `30`을 입력하는 도중에 `3`일 기준으로 정리되면 안 된다. 저장은 blur와 Enter에서만 한다. Task 5 `RetentionInput`에서 처리하고 앱 확인 1번에서 확인한다.
3. 보존 기간 input에 `abc`, `-1`, `1.5`를 넣으면 `삭제 안 함`으로 저장되면 안 된다. `type="number"` input은 이런 입력에서 `value`를 빈 문자열로 돌려주므로 `type="text"`와 `inputMode="numeric"`을 쓴다. Task 4 테스트 `parseRetentionInput`이 확인한다.
4. 대화 파일 중 JSON이 깨진 파일이 있어도 목록 조회와 정리가 예외로 멈추면 안 된다. Task 2 테스트 `skips unreadable files in list and prunes them by modification time`이 확인한다.
5. 브랜치 이름에 `/`가 들어 있어도(`feature/login`) 대화 목록 클릭으로 올바른 비교 대상이 열려야 한다. Task 4 테스트 `parses branch and MR keys`가 확인한다.

---

### Task 1: 보존 기간 설정 값

**Files:**
- Modify: `src/settings.ts`
- Test: `src/settings.test.ts`

**Interfaces:**
- Produces: `Settings.reviewRetentionDays: number | null` (기본값 30), `loadSettings()`, `saveSettings(partial)`의 검사 규칙

- [ ] **Step 1: worktree 만들기**

```bash
cd /Users/byeonjaejeong/Desktop/reviewHelper
git status --short
git worktree add ../reviewHelper-conversations -b feature/review-conversations
cd ../reviewHelper-conversations
pnpm install --frozen-lockfile
```

`git status --short`에 출력이 있으면 멈추고 사용자에게 묻는다. 이후 모든 단계는 `../reviewHelper-conversations`에서 실행한다.

- [ ] **Step 2: `settings.test.ts`에 테스트 추가**

파일 끝에 추가한다.

```ts
describe('reviewRetentionDays', () => {
  it('defaults to 30 days and stores positive integers, with 0 and null meaning no deletion', async () => {
    const home = mkdtempSync(join(tmpdir(), 'diffx-home-'))
    vi.stubEnv('HOME', home)
    vi.resetModules()
    const { loadSettings, saveSettings } = await import('./settings')
    expect(loadSettings().reviewRetentionDays).toBe(30)
    saveSettings({ reviewRetentionDays: 7 })
    expect(loadSettings().reviewRetentionDays).toBe(7)
    saveSettings({ reviewRetentionDays: 0 })
    expect(loadSettings().reviewRetentionDays).toBeNull()
    saveSettings({ reviewRetentionDays: 14 })
    saveSettings({ reviewRetentionDays: null })
    expect(loadSettings().reviewRetentionDays).toBeNull()
    vi.unstubAllEnvs()
  })

  it('ignores negative, fractional and non-number values', async () => {
    const home = mkdtempSync(join(tmpdir(), 'diffx-home-'))
    vi.stubEnv('HOME', home)
    vi.resetModules()
    const { loadSettings, saveSettings } = await import('./settings')
    saveSettings({ reviewRetentionDays: 10 })
    saveSettings({ reviewRetentionDays: -1 })
    saveSettings({ reviewRetentionDays: 1.5 })
    saveSettings({ reviewRetentionDays: '5' } as never)
    expect(loadSettings().reviewRetentionDays).toBe(10)
    vi.unstubAllEnvs()
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run src/settings.test.ts`
Expected: FAIL, `expected undefined to be 30`

- [ ] **Step 4: `settings.ts` 수정**

`Settings`와 `DEFAULTS`를 바꾼다.

```ts
export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap?: boolean
  terminalApp?: string
  reviewRetentionDays: number | null
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
  reviewRetentionDays: 30,
}
```

`pick()`의 `terminalApp` 줄 아래에 추가한다.

```ts
  const days = value.reviewRetentionDays
  if (days === null || days === 0) out.reviewRetentionDays = null
  else if (typeof days === 'number' && Number.isInteger(days) && days > 0) out.reviewRetentionDays = days
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run src/settings.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS (4 tests), 타입 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/settings.ts src/settings.test.ts
git commit -m "feat: AI 대화 보존 기간 설정 값 추가"
```

---

### Task 2: 대화 목록 조회와 오래된 대화 정리

**Files:**
- Modify: `src/review/store.ts`
- Test: `src/review/store.test.ts`

**Interfaces:**
- Produces:
  - `interface ConversationSummary { key: string; questionCount: number; lastAt: number }`
  - `ReviewStore.list(repoPath: string): ConversationSummary[]` (`lastAt` 내림차순, 메시지 없는 파일과 읽지 못한 파일 제외)
  - `ReviewStore.prune(retentionDays: number | null, now?: number): number` (지운 파일 수)

- [ ] **Step 1: `store.test.ts`에 테스트 추가**

import를 바꾼다.

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
```

파일 끝에 추가한다.

```ts
const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

describe('ReviewStore.prune', () => {
  const setupStore = () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    return { dir, store: new ReviewStore(dir) }
  }

  it('removes conversations whose last question is older than the retention days', () => {
    const { store } = setupStore()
    store.append('/repo', 'mr:1', appendInput(message('m1', { createdAt: NOW - 10 * DAY })))
    store.append('/repo', 'mr:2', appendInput(message('m2', { createdAt: NOW - DAY })))
    expect(store.prune(7, NOW)).toBe(1)
    expect(store.load('/repo', 'mr:1')).toBeNull()
    expect(store.load('/repo', 'mr:2')).not.toBeNull()
  })

  it('uses the last question time of the conversation', () => {
    const { store } = setupStore()
    store.append('/repo', 'mr:1', appendInput(message('m1', { createdAt: NOW - 30 * DAY })))
    store.append('/repo', 'mr:1', appendInput(message('m2', { createdAt: NOW - DAY })))
    expect(store.prune(7, NOW)).toBe(0)
    expect(store.load('/repo', 'mr:1')?.messages).toHaveLength(2)
  })

  it('removes nothing when retention is null', () => {
    const { store } = setupStore()
    store.append('/repo', 'mr:1', appendInput(message('m1', { createdAt: 0 })))
    expect(store.prune(null, NOW)).toBe(0)
    expect(store.load('/repo', 'mr:1')).not.toBeNull()
  })

  it('prunes other repositories and removes empty repository folders', () => {
    const { dir, store } = setupStore()
    store.append('/other', 'mr:1', appendInput(message('m1', { createdAt: NOW - 10 * DAY })))
    expect(store.prune(7, NOW)).toBe(1)
    expect(existsSync(join(dir, sha1('/other')))).toBe(false)
  })

  it('uses createdAt for legacy files', () => {
    const { dir, store } = setupStore()
    writeLegacy(dir, '/repo', { ...legacy, createdAt: NOW - 10 * DAY })
    expect(store.prune(7, NOW)).toBe(1)
    expect(store.load('/repo', key)).toBeNull()
  })

  it('skips unreadable files in list and prunes them by modification time', () => {
    const { dir, store } = setupStore()
    const broken = join(dir, sha1('/repo'), `${sha1('mr:9')}.json`)
    mkdirSync(join(dir, sha1('/repo')), { recursive: true })
    writeFileSync(broken, '{not json')
    const old = (NOW - 10 * DAY) / 1000
    utimesSync(broken, old, old)
    expect(store.list('/repo')).toEqual([])
    expect(store.prune(7, NOW)).toBe(1)
    expect(existsSync(broken)).toBe(false)
  })
})

describe('ReviewStore.list', () => {
  it('lists only this repository conversations by last question time', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', 'mr:1', appendInput(message('m1', { createdAt: 2 })))
    store.append('/repo', 'branch:main...feature/x', appendInput(message('m2', { createdAt: 5 })))
    store.append('/repo', 'branch:main...feature/x', appendInput(message('m3', { createdAt: 3 })))
    store.append('/other', 'mr:2', appendInput(message('m4', { createdAt: 9 })))
    expect(store.list('/repo')).toEqual([
      { key: 'branch:main...feature/x', questionCount: 2, lastAt: 5 },
      { key: 'mr:1', questionCount: 1, lastAt: 2 },
    ])
  })

  it('skips conversations without messages', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', 'mr:1', appendInput(message('m1')))
    store.removeMessage('/repo', 'mr:1', 'm1')
    expect(store.list('/repo')).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/review/store.test.ts`
Expected: FAIL, `store.prune is not a function`, `store.list is not a function`

- [ ] **Step 3: `store.ts` 수정**

fs import를 바꾼다.

```ts
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
```

`AppendInput` 인터페이스 아래에 추가한다.

```ts
export interface ConversationSummary {
  key: string
  questionCount: number
  lastAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function lastQuestionAt(conversation: ReviewConversation): number | null {
  if (conversation.messages.length === 0) return null
  return Math.max(...conversation.messages.map((m) => m.createdAt))
}
```

`ReviewStore`의 `load`를 아래 `read`와 `load`로 바꾼다.

```ts
  private read(path: string): ReviewConversation | null {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return null
    }
    if ((data as { version?: unknown } | null)?.version === 2) return data as ReviewConversation
    if (isLegacy(data)) return fromLegacy(data)
    return null
  }

  load(repoPath: string, key: string): ReviewConversation | null {
    return this.read(this.file(repoPath, key))
  }
```

`clear` 아래에 추가한다.

```ts
  list(repoPath: string): ConversationSummary[] {
    const dir = join(this.baseDir, sha1(repoPath))
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    const summaries: ConversationSummary[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const conversation = this.read(join(dir, name))
      const lastAt = conversation ? lastQuestionAt(conversation) : null
      if (!conversation || lastAt === null) continue
      summaries.push({ key: conversation.key, questionCount: conversation.messages.length, lastAt })
    }
    return summaries.sort((a, b) => b.lastAt - a.lastAt)
  }

  prune(retentionDays: number | null, now = Date.now()): number {
    if (retentionDays === null) return 0
    const cutoff = now - retentionDays * DAY_MS
    let repoDirs: string[]
    try {
      repoDirs = readdirSync(this.baseDir)
    } catch {
      return 0
    }
    let removed = 0
    for (const repoDir of repoDirs) {
      const dir = join(this.baseDir, repoDir)
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const path = join(dir, name)
        const conversation = this.read(path)
        const lastAt = (conversation ? lastQuestionAt(conversation) : null) ?? statSync(path).mtimeMs
        if (lastAt < cutoff) {
          rmSync(path, { force: true })
          removed++
        }
      }
      if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true })
    }
    return removed
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/review/store.test.ts`
Expected: PASS (기존 테스트와 새 테스트 8개 모두)

- [ ] **Step 5: 커밋**

```bash
git add src/review/store.ts src/review/store.test.ts
git commit -m "feat: AI 대화 목록 조회와 보존 기간이 지난 대화 정리 추가"
```

---

### Task 3: 서버 API와 정리 실행 시점

**Files:**
- Modify: `src/server.ts` (`/api/review/conversation` DELETE, `/api/settings` PUT, `startServer`)
- Test: `src/server.review.test.ts`, `src/server.settings.test.ts`(신규)

**Interfaces:**
- Consumes: Task 1의 `Settings.reviewRetentionDays`, Task 2의 `ReviewStore.list`, `ReviewStore.prune`
- Produces: `GET /api/review/conversations`, `DELETE /api/review/conversation?key=`

- [ ] **Step 1: `server.review.test.ts`에 테스트 추가**

`describe('review API', ...)` 블록 안 마지막에 추가한다.

```ts
  it('lists conversations of this repository with running state', async () => {
    const { app, repo, store } = setup(() => new Promise(() => {}))
    const saved = (id: string, createdAt: number) => ({ provider: 'claude' as const, providerLabel: 'Fake', sessionId: 's-1', message: { id, createdAt, kind: 'review' as const, question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
    store.append(repo, 'mr:3', saved('m1', 10))
    store.append(repo, 'branch:main...feature/x', saved('m2', 5))
    await postReview(app, { kind: 'question', question: '진행 중' })
    expect(await (await app.request('/api/review/conversations')).json()).toEqual([
      { key: 'mr:3', questionCount: 1, lastAt: 10, running: false },
      { key: 'branch:main...feature/x', questionCount: 1, lastAt: 5, running: true },
    ])
  })

  it('deletes a conversation by key', async () => {
    const { app, repo, store } = setup(async () => ({ answer: 's', locations: [] }))
    store.append(repo, 'mr:3', { provider: 'claude', providerLabel: 'Fake', sessionId: 's-1', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
    const res = await app.request(`/api/review/conversation?key=${encodeURIComponent('mr:3')}`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    expect(store.load(repo, 'mr:3')).toBeNull()
  })

  it('rejects an invalid conversation key', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await app.request('/api/review/conversation?key=foo', { method: 'DELETE' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_key' })
  })

  it('refuses to delete a running conversation by key', async () => {
    const { app } = setup(() => new Promise(() => {}))
    await postReview(app, { kind: 'question', question: '진행 중' })
    const res = await app.request(`/api/review/conversation?key=${encodeURIComponent('branch:main...feature/x')}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'running' })
  })
```

- [ ] **Step 2: `server.settings.test.ts` 작성**

```ts
import { afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DAY = 24 * 60 * 60 * 1000

async function setup() {
  vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'diffx-home-')))
  vi.resetModules()
  const { createApp, startServer } = await import('./server')
  const { ReviewStore } = await import('./review/store')
  const { makeRepo } = await import('./test/gitRepo')
  const repo = makeRepo()
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '')
  const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
  const save = (key: string, createdAt: number) =>
    store.append(repo, key, { provider: 'claude', providerLabel: 'Fake', sessionId: 's-1', message: { id: key, createdAt, kind: 'review', question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
  save('mr:1', Date.now() - 40 * DAY)
  save('mr:2', Date.now() - 10 * DAY)
  save('mr:3', Date.now())
  return { createApp, startServer, repo, clientDir, store }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('review retention', () => {
  it('prunes old conversations when the retention days are saved', async () => {
    const { createApp, repo, clientDir, store } = await setup()
    const app = createApp({ repoPath: repo, clientDir, reviewStore: store })
    const put = (body: unknown) => app.request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await (await put({ reviewRetentionDays: 7 })).json()).reviewRetentionDays).toBe(7)
    expect(store.list(repo).map((s) => s.key)).toEqual(['mr:3'])
    await put({ reviewRetentionDays: 7 })
    expect(store.list(repo).map((s) => s.key)).toEqual(['mr:3'])
  })

  it('prunes with the saved retention days when the server starts', async () => {
    const { startServer, repo, clientDir, store } = await setup()
    const server = await startServer({ repoPath: repo, clientDir, reviewStore: store, port: 0, host: '127.0.0.1' })
    expect(store.list(repo).map((s) => s.key)).toEqual(['mr:3', 'mr:2'])
    await server.close()
  })
})
```

두 번째 테스트는 `settings.json`이 없는 HOME이라 기본값 30일이 적용된다. 40일 지난 `mr:1`만 지워진다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run src/server.review.test.ts src/server.settings.test.ts`
Expected: FAIL. `lists conversations`는 404 응답 본문 때문에, `deletes a conversation by key`는 비교 조건이 없어 400으로, retention 테스트 두 개는 대화가 지워지지 않아서 실패한다.

- [ ] **Step 4: `server.ts` 수정**

`app.delete('/api/review/conversation', ...)` 핸들러 전체를 아래로 바꾸고, 바로 위에 목록 API를 추가한다.

```ts
  app.get('/api/review/conversations', (c) => {
    return c.json(reviewStore.list(repo).map((summary) => ({ ...summary, running: reviewJobs.runningFor(repo, summary.key) !== null })))
  })

  app.delete('/api/review/conversation', async (c) => {
    let key = c.req.query('key')
    if (key !== undefined) {
      if (!/^(branch|mr):./.test(key)) return c.json({ error: 'invalid_key' }, 400)
    } else {
      try {
        key = (await resolveFromRequest(c)).key
      } catch (err) {
        return comparisonErrorResponse(c, err)
      }
    }
    if (reviewJobs.runningFor(repo, key)) return c.json({ error: 'running' }, 409)
    reviewStore.clear(repo, key)
    return c.json({ ok: true })
  })
```

`app.put('/api/settings', ...)` 핸들러를 바꾼다.

```ts
  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    if (body && typeof body === 'object' && 'reviewRetentionDays' in body) reviewStore.prune(settings.reviewRetentionDays)
    return c.json(settings)
  })
```

`startServer`의 `const app = createApp({ ...options, reviewStore, reviewJobs })` 바로 아래에 추가한다.

```ts
  reviewStore.prune(loadSettings().reviewRetentionDays)
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run src/server.review.test.ts src/server.settings.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS, 타입 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/server.ts src/server.review.test.ts src/server.settings.test.ts
git commit -m "feat: AI 대화 목록과 키로 삭제하는 API, 보존 기간 정리 실행 추가"
```

---

### Task 4: 키 해석과 표시용 함수, 패널 탭 저장

**Files:**
- Modify: `src/ui/comparison.ts`, `src/ui/reviewPanelStorage.ts`
- Create: `src/ui/reviewConversations.ts`
- Test: `src/ui/comparison.test.ts`, `src/ui/reviewPanelStorage.test.ts`, `src/ui/reviewConversations.test.ts`(신규)

**Interfaces:**
- Produces:
  - `comparisonFromKey(key: string): Comparison | null`
  - `interface ConversationItem { key: string; questionCount: number; lastAt: number; running: boolean }`
  - `conversationLabel(key: string): string`
  - `formatLastAt(ms: number): string` (`YYYY-MM-DD HH:mm`, 로컬 시간대)
  - `parseRetentionInput(text: string): number | null | undefined` (`undefined`는 잘못된 입력)
  - `ReviewPanelPrefs.tab: 'review' | 'explore' | 'conversations'`

- [ ] **Step 1: 테스트 작성**

`src/ui/comparison.test.ts`의 import에 `comparisonFromKey`를 추가하고 파일 끝에 추가한다.

```ts
describe('comparisonFromKey', () => {
  it('parses branch and MR keys', () => {
    expect(comparisonFromKey('branch:develop...feature/login')).toEqual({ mode: 'branch', source: 'feature/login', target: 'develop' })
    expect(comparisonFromKey('branch:origin/main...feature/a/b')).toEqual({ mode: 'branch', source: 'feature/a/b', target: 'origin/main' })
    expect(comparisonFromKey('mr:128')).toEqual({ mode: 'mr', iid: 128 })
  })

  it('returns null for malformed keys', () => {
    expect(comparisonFromKey('branch:develop')).toBeNull()
    expect(comparisonFromKey('branch:...feature')).toBeNull()
    expect(comparisonFromKey('mr:0')).toBeNull()
    expect(comparisonFromKey('mr:abc')).toBeNull()
    expect(comparisonFromKey('worktree')).toBeNull()
  })
})
```

`src/ui/reviewPanelStorage.test.ts`의 첫 번째 `describe` 블록 안 마지막에 추가한다.

```ts
  it('keeps the conversations tab', () => {
    const s = memoryStorage()
    saveReviewPanel({ open: true, size: 500, tab: 'conversations' }, s)
    expect(loadReviewPanel(s).tab).toBe('conversations')
  })
```

`src/ui/reviewConversations.test.ts`를 만든다.

```ts
import { describe, it, expect } from 'vitest'
import { conversationLabel, formatLastAt, parseRetentionInput } from './reviewConversations'

describe('conversationLabel', () => {
  it('names branch comparisons and MRs', () => {
    expect(conversationLabel('branch:develop...feature/login')).toBe('feature/login → develop')
    expect(conversationLabel('mr:128')).toBe('MR !128')
    expect(conversationLabel('unknown')).toBe('unknown')
  })
})

describe('formatLastAt', () => {
  it('formats local time as YYYY-MM-DD HH:mm', () => {
    expect(formatLastAt(new Date(2026, 8, 3, 7, 5).getTime())).toBe('2026-09-03 07:05')
  })
})

describe('parseRetentionInput', () => {
  it('reads empty and 0 as no deletion and positive integers as days', () => {
    expect(parseRetentionInput('')).toBeNull()
    expect(parseRetentionInput(' 0 ')).toBeNull()
    expect(parseRetentionInput('30')).toBe(30)
  })

  it('returns undefined for other input', () => {
    expect(parseRetentionInput('abc')).toBeUndefined()
    expect(parseRetentionInput('-1')).toBeUndefined()
    expect(parseRetentionInput('1.5')).toBeUndefined()
  })
})
```


- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/ui/comparison.test.ts src/ui/reviewPanelStorage.test.ts src/ui/reviewConversations.test.ts`
Expected: FAIL. `comparisonFromKey`가 없고, `reviewConversations` 모듈이 없고, 탭이 `review`로 읽힌다.

- [ ] **Step 3: 구현**

`src/ui/comparison.ts` 끝에 추가한다.

```ts
export function comparisonFromKey(key: string): Comparison | null {
  if (key.startsWith('branch:')) {
    const rest = key.slice('branch:'.length)
    const at = rest.indexOf('...')
    if (at < 0) return null
    const target = rest.slice(0, at)
    const source = rest.slice(at + 3)
    return target && source ? { mode: 'branch', source, target } : null
  }
  if (key.startsWith('mr:')) {
    const rest = key.slice('mr:'.length)
    return /^[1-9]\d*$/.test(rest) ? { mode: 'mr', iid: Number(rest) } : null
  }
  return null
}
```

`src/ui/reviewPanelStorage.ts`에서 탭 타입과 읽기를 바꾼다.

```ts
export type ReviewPanelTab = 'review' | 'explore' | 'conversations'

export interface ReviewPanelPrefs {
  open: boolean
  size: number
  tab: ReviewPanelTab
}
```

`loadReviewPanel`의 return 줄을 바꾼다.

```ts
      const tab: ReviewPanelTab = parsed.tab === 'explore' || parsed.tab === 'conversations' ? parsed.tab : 'review'
      return { open: parsed.open, size: Math.max(REVIEW_PANEL_MIN, parsed.size), tab }
```

`src/ui/reviewConversations.ts`를 만든다.

```ts
import { comparisonFromKey } from './comparison'

export interface ConversationItem {
  key: string
  questionCount: number
  lastAt: number
  running: boolean
}

export function conversationLabel(key: string): string {
  const comparison = comparisonFromKey(key)
  if (!comparison) return key
  return comparison.mode === 'mr' ? `MR !${comparison.iid}` : `${comparison.source} → ${comparison.target}`
}

export function formatLastAt(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseRetentionInput(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const days = Number(trimmed)
  return days === 0 ? null : days
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/ui/comparison.test.ts src/ui/reviewPanelStorage.test.ts src/ui/reviewConversations.test.ts`
Expected: PASS

이 Task에서는 타입 검사를 돌리지 않는다. `ReviewPanelPrefs.tab`에 `conversations`가 추가되면서 `App.tsx`가 넘기는 탭 값이 `SidePanel`의 두 가지 탭 타입과 맞지 않아 타입 오류가 난다. Task 5 Step 5에서 `SidePanel`을 바꾸고 Step 11에서 타입 검사를 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/ui/comparison.ts src/ui/comparison.test.ts src/ui/reviewPanelStorage.ts src/ui/reviewPanelStorage.test.ts src/ui/reviewConversations.ts src/ui/reviewConversations.test.ts
git commit -m "feat: 대화 키 해석과 대화 목록 표시용 함수 추가"
```

---

### Task 5: 대화 목록 탭, 보존 기간 input, 대화 삭제 문구

**Files:**
- Create: `src/ui/components/ConversationList.tsx`
- Modify: `src/ui/components/SidePanel.tsx`, `src/ui/components/ReviewPanel.tsx`, `src/ui/components/Toolbar.tsx`, `src/ui/hooks/useSettings.ts`, `src/ui/App.tsx`, `src/ui/styles/global.css`
- Test: `src/ui/components/ConversationList.test.ts`(신규)

**Interfaces:**
- Consumes: Task 4의 `comparisonFromKey`, `ConversationItem`, `conversationLabel`, `formatLastAt`, `parseRetentionInput`, `ReviewPanelTab`. Task 3의 API
- Produces:
  - `ConversationRows(props: { items: ConversationItem[]; currentKey: string | null; onOpen: (key: string) => void; onDelete: (key: string) => void })`
  - `ConversationList(props: { active: boolean; currentKey: string | null; onOpen: (key: string) => void })`
  - `useSettings().updateSettings(patch): Promise<void>`
  - `Toolbar` props `reviewRetentionDays: number | null`, `onReviewRetentionDaysChange: (days: number | null) => void`

spec은 줄 클릭과 `삭제` 클릭을 이벤트 전파 차단으로 나눈다고 적었지만, 줄의 이름 영역을 별도 `button`으로 만들어 키보드로도 누를 수 있게 하고 `삭제` 버튼과 겹치지 않게 한다. 보존 기간 input은 Review Focus 3번 때문에 `type="text"`와 `inputMode="numeric"`을 쓴다.

- [ ] **Step 1: `ConversationList.test.ts` 작성**

```ts
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationRows } from './ConversationList'

const noop = () => {}
const at = new Date(2026, 8, 30, 18, 20).getTime()

const render = (items: { key: string; questionCount: number; lastAt: number; running: boolean }[], currentKey: string | null = null) =>
  renderToStaticMarkup(createElement(ConversationRows, { items, currentKey, onOpen: noop, onDelete: noop }))

describe('ConversationRows', () => {
  it('renders the label, question count and time and marks the current conversation', () => {
    const html = render([
      { key: 'branch:develop...feature/login', questionCount: 4, lastAt: at, running: false },
      { key: 'mr:128', questionCount: 1, lastAt: at, running: false },
    ], 'mr:128')
    expect(html).toContain('feature/login → develop')
    expect(html).toContain('질문 4개 · 2026-09-30 18:20')
    expect(html).toMatch(/<li class="conv-item conv-item-current">.*MR !128/)
  })

  it('disables delete for a running conversation', () => {
    const html = render([{ key: 'mr:1', questionCount: 1, lastAt: at, running: true }])
    expect(html).toContain('disabled=""')
  })

  it('shows a message when there is no conversation', () => {
    expect(render([])).toContain('저장된 대화가 없습니다')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/ui/components/ConversationList.test.ts`
Expected: FAIL, `Cannot find module './ConversationList'`

- [ ] **Step 3: `ConversationList.tsx` 작성**

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { conversationLabel, formatLastAt, type ConversationItem } from '../reviewConversations'

interface ConversationRowsProps {
  items: ConversationItem[]
  currentKey: string | null
  onOpen: (key: string) => void
  onDelete: (key: string) => void
}

export function ConversationRows({ items, currentKey, onOpen, onDelete }: ConversationRowsProps) {
  if (items.length === 0) return <div className="conv-empty">저장된 대화가 없습니다</div>
  return (
    <ul className="conv-list">
      {items.map((item) => (
        <li key={item.key} className={`conv-item${item.key === currentKey ? ' conv-item-current' : ''}`}>
          <button type="button" className="conv-open" onClick={() => onOpen(item.key)}>
            <span className="conv-label">{conversationLabel(item.key)}</span>
            <span className="conv-meta">질문 {item.questionCount}개 · {formatLastAt(item.lastAt)}</span>
          </button>
          <button type="button" className="btn btn-sm" disabled={item.running} onClick={() => onDelete(item.key)}>삭제</button>
        </li>
      ))}
    </ul>
  )
}

export function ConversationList({ active, currentKey, onOpen }: { active: boolean; currentKey: string | null; onOpen: (key: string) => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data, isError } = useQuery({
    queryKey: ['review', 'conversations'],
    queryFn: async (): Promise<ConversationItem[]> => {
      const res = await fetch('/api/review/conversations')
      if (!res.ok) throw new Error(`대화 목록 응답 ${res.status}`)
      return res.json()
    },
    enabled: active,
  })

  const remove = async (key: string) => {
    if (!window.confirm('이 대화의 모든 질문과 답변을 삭제할까요?')) return
    setError(null)
    try {
      const res = await fetch(`/api/review/conversation?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (res.status === 409) setError('답변을 만드는 중인 대화는 삭제할 수 없습니다')
    } catch {}
    queryClient.invalidateQueries({ queryKey: ['review'] })
  }

  return (
    <div className="conv-panel">
      {error && <div className="conv-error">{error}</div>}
      {isError ? (
        <div className="conv-empty">대화 목록을 불러오지 못했습니다</div>
      ) : (
        data && <ConversationRows items={data} currentKey={currentKey} onOpen={onOpen} onDelete={remove} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/ui/components/ConversationList.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: `SidePanel.tsx` 바꾸기**

파일 전체를 아래로 바꾼다.

```tsx
import type { ReactNode } from 'react'
import type { ReviewPanelTab } from '../reviewPanelStorage'

interface SidePanelProps {
  tab: ReviewPanelTab
  onTabChange: (tab: ReviewPanelTab) => void
  review: ReactNode
  explore: ReactNode
  conversations: ReactNode
}

export function SidePanel({ tab, onTabChange, review, explore, conversations }: SidePanelProps) {
  return (
    <div className="side-panel">
      <div className="toolbar-toggle side-panel-tabs">
        <button className={`btn btn-sm ${tab === 'review' ? 'btn-active' : ''}`} onClick={() => onTabChange('review')}>AI 리뷰</button>
        <button className={`btn btn-sm ${tab === 'explore' ? 'btn-active' : ''}`} onClick={() => onTabChange('explore')}>코드 탐색</button>
        <button className={`btn btn-sm ${tab === 'conversations' ? 'btn-active' : ''}`} onClick={() => onTabChange('conversations')}>대화 목록</button>
      </div>
      <div className="side-panel-body" style={{ display: tab === 'review' ? 'flex' : 'none' }}>{review}</div>
      <div className="side-panel-body" style={{ display: tab === 'explore' ? 'flex' : 'none' }}>{explore}</div>
      <div className="side-panel-body" style={{ display: tab === 'conversations' ? 'flex' : 'none' }}>{conversations}</div>
    </div>
  )
}
```

- [ ] **Step 6: `ReviewPanel.tsx` 문구 바꾸기**

```tsx
  const confirmNewConversation = () => {
    if (window.confirm('이 비교의 모든 질문과 답변을 삭제할까요?')) onNewConversation()
  }
```

헤더 버튼 문구 `새 대화`를 `대화 삭제`로 바꾼다.

```tsx
        <button className="btn btn-sm" onClick={confirmNewConversation} disabled={running || messages.length === 0}>대화 삭제</button>
```

- [ ] **Step 7: `useSettings.ts` 바꾸기**

파일 전체를 아래로 바꾼다. `updateSettings`가 PUT 응답을 기다리는 Promise를 돌려줘야 App이 정리 후 목록을 다시 불러올 수 있다. 기존 코드는 `setSettings` updater 안에서 요청을 보내서 응답 시점을 알 수 없다.

```ts
import { useState, useEffect, useCallback, useRef } from 'react'

export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap: boolean
  terminalApp: string
  reviewRetentionDays: number | null
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
  softWrap: false,
  terminalApp: '',
  reviewRetentionDays: 30,
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  const settingsRef = useRef<Settings>(DEFAULTS)

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        const next = { ...DEFAULTS, ...data }
        settingsRef.current = next
        setSettings(next)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>): Promise<void> => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
    } catch {}
  }, [])

  return { settings, loaded, updateSettings }
}
```

- [ ] **Step 8: `Toolbar.tsx`에 보존 기간 input 추가**

import에 `useState`, `useEffect`가 없으면 추가하고, 아래 import를 추가한다.

```ts
import { parseRetentionInput } from '../reviewConversations'
```

`ToolbarProps`의 `onTerminalAppChange` 아래에 추가한다.

```ts
  reviewRetentionDays: number | null
  onReviewRetentionDaysChange: (days: number | null) => void
```

`Toolbar` 함수 구조 분해의 `onTerminalAppChange,` 아래에 `reviewRetentionDays,`, `onReviewRetentionDaysChange,`를 추가한다.

`Toolbar` 함수 위에 컴포넌트를 추가한다.

```tsx
function RetentionInput({ value, onCommit }: { value: number | null; onCommit: (days: number | null) => void }) {
  const shown = value === null ? '' : String(value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const commit = () => {
    const days = parseRetentionInput(text)
    if (days === undefined) {
      setText(shown)
      return
    }
    setText(days === null ? '' : String(days))
    if (days !== value) onCommit(days)
  }
  return (
    <label className="settings-item settings-item-spaced">
      <span>AI 대화 보존 기간</span>
      <span className="settings-days">
        <input
          className="settings-input settings-input-days"
          type="text"
          inputMode="numeric"
          value={text}
          placeholder="삭제 안 함"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        일
      </span>
    </label>
  )
}
```

설정 팝오버의 `Terminal` `label` 바로 아래(`settings-menu` div 닫기 전)에 추가한다.

```tsx
              <RetentionInput value={reviewRetentionDays} onCommit={onReviewRetentionDaysChange} />
```

- [ ] **Step 9: `App.tsx` 연결**

import에 추가한다.

```tsx
import { ConversationList } from './components/ConversationList'
```

`./comparison` import에 `comparisonFromKey`를 추가한다.

`<Toolbar>`의 `onTerminalAppChange` 줄 아래에 추가한다.

```tsx
        reviewRetentionDays={settings.reviewRetentionDays}
        onReviewRetentionDaysChange={async (days) => {
          await updateSettings({ reviewRetentionDays: days })
          queryClient.invalidateQueries({ queryKey: ['review'] })
        }}
```

`handleModeChange` `useCallback` 아래에 추가한다.

```tsx
  const handleOpenConversation = useCallback((conversationKey: string) => {
    const next = comparisonFromKey(conversationKey)
    if (!next) return
    handleComparisonChange(next)
    setReviewPanel((prev) => {
      const nextPanel = { ...prev, tab: 'review' as const }
      saveReviewPanel(nextPanel)
      return nextPanel
    })
  }, [handleComparisonChange])
```

`<SidePanel>`의 `explore={...}` 아래에 추가한다.

```tsx
                  conversations={(
                    <ConversationList
                      active={reviewPanel.open && reviewPanel.tab === 'conversations'}
                      currentKey={key}
                      onOpen={handleOpenConversation}
                    />
                  )}
```

`handleOpenConversation`이 `setReviewPanel`, `saveReviewPanel`보다 위에 선언되면 `used before its declaration` 오류가 난다. 그 경우 `reviewPanel` `useState` 선언 아래로 옮긴다.

- [ ] **Step 10: 스타일 추가**

`src/ui/styles/global.css`의 `.settings-input:focus { ... }` 규칙 아래에 추가한다.

```css
.settings-days {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.settings-input-days {
    width: 64px;
    text-align: right;
}
```

`.review-panel-error { ... }` 규칙 아래에 추가한다.

```css
.conv-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
}

.conv-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.conv-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
}

.conv-item-current {
    background: var(--bg-secondary);
}

.conv-open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
}

.conv-label {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.conv-meta {
    font-size: 12px;
    color: var(--text-secondary);
}

.conv-open:hover .conv-label {
    color: var(--primary);
}

.conv-empty,
.conv-error {
    padding: 12px;
    font-size: 12px;
    color: var(--text-secondary);
}

.conv-error {
    color: var(--danger);
}
```

- [ ] **Step 11: 타입 검사, 전체 테스트, 빌드**

Run: `pnpm exec tsc --noEmit -p . && pnpm test && pnpm run build:electron`
Expected: 타입 오류 없음, 테스트 437개 통과(기존 411개와 새 테스트 26개), 빌드 성공

- [ ] **Step 12: 커밋**

```bash
git add src/ui/components/ConversationList.tsx src/ui/components/ConversationList.test.ts src/ui/components/SidePanel.tsx src/ui/components/ReviewPanel.tsx src/ui/components/Toolbar.tsx src/ui/hooks/useSettings.ts src/ui/App.tsx src/ui/styles/global.css
git commit -m "feat: 대화 목록 탭과 AI 대화 보존 기간 설정, 대화 삭제 버튼 추가"
```

---

### Task 6: README와 앱 확인

**Files:**
- Modify: `README.md` (`### 사용`의 `- 취소하거나 실패한 질문은 ...` 줄 아래)

- [ ] **Step 1: README 추가**

`README.md`의 `- 취소하거나 실패한 질문은 패널에 표시되지 않지만 Claude 세션의 맥락에는 남아 있다.` 줄 바로 아래에 추가한다.

```markdown
- AI 리뷰 패널의 `대화 삭제` 클릭 후 확인하면 그 비교의 질문과 답변이 모두 삭제되고 다음 질문부터 새 Claude 세션을 쓴다.
- 오른쪽 패널의 `대화 목록` 탭에서 이 저장소의 AI 대화를 마지막 질문 시각 순서로 본다. 줄을 클릭하면 그 브랜치 비교나 MR로 이동하고 `AI 리뷰` 탭이 열린다. `삭제` 클릭 후 확인하면 그 대화가 삭제된다.
- 툴바 톱니바퀴 설정의 `AI 대화 보존 기간`(기본 30일)이 지난 대화는 저장소 창을 열 때와 설정을 바꿀 때 삭제된다. 기간은 대화의 마지막 질문 시각부터 센다. 비워 두면 삭제하지 않는다.
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: AI 대화 목록과 보존 기간 설명 추가"
```

- [ ] **Step 3: 앱 확인 (사용자)**

사용자가 worktree에서 `pnpm run dev:app`을 실행하거나 실행을 요청한다. AI 대화가 두 개 이상 있는 저장소를 연다.

1. 톱니바퀴 설정의 `AI 대화 보존 기간`에 `30`을 입력하는 동안 대화가 지워지지 않고, input 밖을 클릭하면 저장된다. `abc`를 입력하고 밖을 클릭하면 이전 값으로 돌아간다.
2. `대화 목록` 탭에 이 저장소의 대화가 `질문 N개 · YYYY-MM-DD HH:mm` 형식으로 나오고 지금 열린 비교 대상의 줄에 배경색이 있다.
3. 다른 MR이나 브랜치 비교의 줄을 클릭하면 그 diff와 AI 리뷰 대화가 열리고 `AI 리뷰` 탭으로 바뀐다.
4. 지금 열린 비교 대상의 대화를 `삭제`하면 목록에서 빠지고 `AI 리뷰` 탭이 빈 상태로 바뀐다.
5. `AI 리뷰` 탭의 `대화 삭제` 클릭 시 확인 창 문구가 `이 비교의 모든 질문과 답변을 삭제할까요?`이고, 확인하면 대화가 지워진다.
