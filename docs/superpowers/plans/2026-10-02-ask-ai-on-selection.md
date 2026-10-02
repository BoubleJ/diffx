# 선택한 코드로 AI에게 질문하기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diff에서 코드를 드래그로 선택하면 `AI에게 질문` 버튼과 입력 팝업이 뜨고, 질문을 보내면 선택한 코드와 위치가 함께 AI 리뷰 대화에 들어간다.

**Architecture:** 줄 번호와 쪽을 계산하는 순수 함수는 `src/ui/selection.ts`에 둔다. 서버는 `POST /api/review`에서 `selection`을 `src/review/selection.ts`의 `parseSelection`으로 검사하고, `ReviewJobs`가 `buildQuestionPrompt`로 선택 블록을 질문 앞에 붙이며 메시지에 `selection`을 저장한다. 화면은 `SelectionAsk` 컴포넌트가 문서 `mouseup`에서 파일 카드 shadow root의 선택을 읽어 버튼과 팝업을 그리고, `App`이 패널을 열어 `review.ask(question, selection)`을 호출한다.

**Tech Stack:** TypeScript, React 19, Hono, lucide-react, vitest

**Spec:** `docs/superpowers/specs/2026-10-02-ask-ai-on-selection-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 선택한 코드 상한 4000자(`MAX_SELECTION_CHARS`). 질문 글 상한은 기존 2000자 그대로.
- 화면 문구(그대로 쓴다)
  - 버튼 `AI에게 질문`, 비활성 `title` `진행 중인 질문이 끝난 뒤 다시 보내 주세요`
  - 팝업 위치 표시 `<경로>:<시작>-<끝>` 또는 `<경로>:<줄>`, 뒤에 `(변경 후 코드)` 또는 `(변경 전 코드)`
  - placeholder `선택한 코드에 대해 질문하기`, 보내기 버튼 `aria-label` `보내기`
  - 4000자 초과 `선택한 코드가 너무 깁니다 (4000자까지)`
  - 질문 카드 펼치기 요약 `<위치> · 선택한 코드`
- 서버 오류: 400 `{ error: 'invalid_selection', message: '선택한 코드 정보가 올바르지 않습니다' }`, 400 `{ error: 'selection_too_long', message: '선택한 코드는 4000자까지 보낼 수 있습니다' }`
- 프롬프트 형식: `사용자가 diff에서 선택한 코드: <경로> <줄 표시> (<변경 후 코드|변경 전 코드>)` 다음 줄에 코드 블록, 빈 줄, `질문: <질문>`. 줄 표시는 `12줄` 또는 `12-13줄`.
- 보내기 키: Enter. Shift+Enter는 줄바꿈. `isComposing`이거나 `keyCode === 229`이면 보내지 않는다.
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다. 사용자가 실행을 요청하면 에이전트가 실행한다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 빌드: `pnpm run build:electron`. 작업 시작 시점에 `main`에서 테스트 441개가 통과한다.
- 작업 위치: `main`에서 worktree `../reviewHelper-ask-selection`과 브랜치 `feature/ask-ai-on-selection`을 만들어 작업한다. `feature/async-definition-reader`는 아직 `main`에 머지되지 않았으며 이 계획과 바꾸는 함수가 겹치지 않는다.

spec과 다르게 정한 점:
- spec 1단계(줄 번호가 선택 문자열에 섞이는지 확인)는 `@pierre/diffs`가 줄 번호 요소 `[data-column-number]`에 이미 `user-select: none`을 주고 있어서 코드 작업 없이 Task 4 앱 확인 1번으로만 확인한다.
- spec 1장 4번의 "선택이 해제될 때(`selectionchange`) 버튼을 닫는다"는 shadow DOM 안 선택에서 `document`의 `selectionchange`와 `getSelection()` 결과를 믿기 어려워서 구현하지 않는다. 선택을 해제하는 동작은 대부분 다른 곳 `mousedown`이므로 바깥 `mousedown`으로 닫는다.

## Review Focus

1. 아래에서 위로 드래그하면 `anchorNode`가 아래 줄이다. 그래도 `startLine <= endLine`이어야 한다. Task 1 테스트 `orders lines when dragging upward`가 확인한다.
2. unified 보기에서 삭제 줄부터 추가 줄까지 선택하면 서로 다른 쪽 번호가 섞이지 않아야 한다. Task 1 테스트 `uses the additions side across a deletion and an addition in unified view`가 확인한다.
3. 선택한 코드 안에 ```` ``` ````가 들어 있어도 프롬프트의 코드 블록이 깨지면 안 된다. Task 2 테스트 `lengthens the fence when the code contains backticks`가 확인한다.
4. 진행 중인 질문이 있을 때 창을 다시 열면 진행 중 질문 카드에도 선택 위치가 보여야 한다. Task 2 테스트 `reports the selection of a running question`이 서버 응답을 확인하고, Task 3이 `useReview`에서 이어 붙인다.
5. 전체 리뷰 요청에 `selection`이 섞여 와도 무시해야 한다. Task 2 테스트 `ignores a selection on a full review`가 확인한다.

---

### Task 1: 선택 줄 계산

**Files:**
- Create: `src/ui/selection.ts`
- Modify: `src/review/types.ts` (파일 끝에 타입과 상수 추가)
- Test: `src/ui/selection.test.ts`

**Interfaces:**
- Produces:
  - `src/review/types.ts`: `interface CodeSelection { path: string; side: 'additions' | 'deletions'; startLine: number; endLine: number; code: string }`, `const MAX_SELECTION_CHARS = 4000`
  - `src/ui/selection.ts`:
    - `type LineSide = 'additions' | 'deletions'`
    - `interface LineInfo { type: string; line: number; altLine: number | null; column: 'additions' | 'deletions' | 'unified' | null }`
    - `interface ElementLike { parentElement: ElementLike | null; hasAttribute(name: string): boolean; getAttribute(name: string): string | null }`
    - `lineInfoFrom(node: unknown): LineInfo | null`
    - `selectedLines(start: LineInfo, end: LineInfo): { side: LineSide; startLine: number; endLine: number } | null`
    - `formatSelectionLocation(s: { path: string; startLine: number; endLine: number }): string`
    - `sideLabel(side: LineSide): string` (`변경 후 코드` 또는 `변경 전 코드`)
    - `trimSelectedCode(text: string): string`

- [ ] **Step 1: worktree 만들기**

```bash
cd /Users/byeonjaejeong/Desktop/reviewHelper
git status --short
git worktree add ../reviewHelper-ask-selection -b feature/ask-ai-on-selection
cd ../reviewHelper-ask-selection
pnpm install --frozen-lockfile
```

`git status --short`에 출력이 있으면 멈추고 사용자에게 묻는다. 이후 모든 단계는 `../reviewHelper-ask-selection`에서 실행한다.

- [ ] **Step 2: `selection.test.ts` 작성**

```ts
import { describe, it, expect } from 'vitest'
import { formatSelectionLocation, lineInfoFrom, selectedLines, sideLabel, trimSelectedCode, type ElementLike, type LineInfo } from './selection'

const info = (type: string, line: number, column: LineInfo['column'], altLine: number | null = null): LineInfo => ({ type, line, altLine, column })

function el(attrs: Record<string, string>, parent: ElementLike | null = null): ElementLike {
  return {
    parentElement: parent,
    hasAttribute: (name) => name in attrs,
    getAttribute: (name) => attrs[name] ?? null,
  }
}

describe('selectedLines', () => {
  it('uses the line numbers of added and deleted lines', () => {
    expect(selectedLines(info('change-addition', 12, 'unified'), info('change-addition', 13, 'unified'))).toEqual({ side: 'additions', startLine: 12, endLine: 13 })
    expect(selectedLines(info('change-deletion', 4, 'deletions'), info('change-deletion', 6, 'deletions'))).toEqual({ side: 'deletions', startLine: 4, endLine: 6 })
  })

  it('takes the side of context lines from the split column', () => {
    expect(selectedLines(info('context', 7, 'deletions', 9), info('context', 8, 'deletions', 10))).toEqual({ side: 'deletions', startLine: 7, endLine: 8 })
    expect(selectedLines(info('context-expanded', 9, 'additions', 7), info('context', 10, 'additions', 8))).toEqual({ side: 'additions', startLine: 9, endLine: 10 })
  })

  it('reads unified context lines as the additions side', () => {
    expect(selectedLines(info('context', 20, 'unified', 18), info('context', 21, null, 19))).toEqual({ side: 'additions', startLine: 20, endLine: 21 })
  })

  it('uses the additions side across a deletion and an addition in unified view', () => {
    expect(selectedLines(info('change-deletion', 5, 'unified', 6), info('change-addition', 7, 'unified'))).toEqual({ side: 'additions', startLine: 6, endLine: 7 })
    expect(selectedLines(info('change-deletion', 5, 'unified'), info('change-addition', 7, 'unified'))).toEqual({ side: 'additions', startLine: 7, endLine: 7 })
  })

  it('returns null across the two split columns', () => {
    expect(selectedLines(info('context', 3, 'deletions'), info('context', 3, 'additions'))).toBeNull()
  })

  it('orders lines when dragging upward', () => {
    expect(selectedLines(info('change-addition', 30, 'unified'), info('context', 25, 'unified'))).toEqual({ side: 'additions', startLine: 25, endLine: 30 })
  })
})

describe('lineInfoFrom', () => {
  it('reads the nearest line element and its column from a text node', () => {
    const column = el({ 'data-deletions': '' })
    const line = el({ 'data-line-type': 'context', 'data-line': '7', 'data-alt-line': '9' }, column)
    const span = el({}, line)
    const text = { parentElement: span }
    expect(lineInfoFrom(text)).toEqual({ type: 'context', line: 7, altLine: 9, column: 'deletions' })
  })

  it('returns null outside a line element', () => {
    const header = el({ 'data-diffs-header': '' })
    expect(lineInfoFrom({ parentElement: header })).toBeNull()
    expect(lineInfoFrom(null)).toBeNull()
  })
})

describe('selection labels', () => {
  it('formats the location and the side', () => {
    expect(formatSelectionLocation({ path: 'src/cart.ts', startLine: 12, endLine: 13 })).toBe('src/cart.ts:12-13')
    expect(formatSelectionLocation({ path: 'src/cart.ts', startLine: 12, endLine: 12 })).toBe('src/cart.ts:12')
    expect(sideLabel('additions')).toBe('변경 후 코드')
    expect(sideLabel('deletions')).toBe('변경 전 코드')
  })

  it('removes blank lines around the selected code', () => {
    expect(trimSelectedCode('\n  \nconst a = 1\n  b()\n\n')).toBe('const a = 1\n  b()')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run src/ui/selection.test.ts`
Expected: FAIL, `Cannot find module './selection'`

- [ ] **Step 4: 타입 추가와 `selection.ts` 구현**

`src/review/types.ts` 끝에 추가한다.

```ts
export const MAX_SELECTION_CHARS = 4000

export interface CodeSelection {
  path: string
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
  code: string
}
```

`src/ui/selection.ts`를 만든다.

```ts
export type LineSide = 'additions' | 'deletions'

export interface LineInfo {
  type: string
  line: number
  altLine: number | null
  column: 'additions' | 'deletions' | 'unified' | null
}

export interface ElementLike {
  parentElement: ElementLike | null
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
}

function startElement(node: unknown): ElementLike | null {
  if (!node || typeof node !== 'object') return null
  if (typeof (node as ElementLike).getAttribute === 'function') return node as ElementLike
  return (node as { parentElement?: ElementLike | null }).parentElement ?? null
}

export function lineInfoFrom(node: unknown): LineInfo | null {
  let lineEl: ElementLike | null = null
  let column: LineInfo['column'] = null
  for (let cur = startElement(node); cur; cur = cur.parentElement) {
    if (!lineEl) {
      if (cur.hasAttribute('data-line-type')) lineEl = cur
      continue
    }
    if (cur.hasAttribute('data-deletions')) column = 'deletions'
    else if (cur.hasAttribute('data-additions')) column = 'additions'
    else if (cur.hasAttribute('data-unified')) column = 'unified'
    if (column) break
  }
  if (!lineEl) return null
  const line = Number(lineEl.getAttribute('data-line'))
  if (!Number.isInteger(line) || line < 1) return null
  const alt = Number(lineEl.getAttribute('data-alt-line'))
  return { type: lineEl.getAttribute('data-line-type') ?? '', line, altLine: Number.isInteger(alt) && alt > 0 ? alt : null, column }
}

function sideOf(info: LineInfo): LineSide | null {
  if (info.type === 'change-addition') return 'additions'
  if (info.type === 'change-deletion') return 'deletions'
  if (info.type === 'context' || info.type === 'context-expanded') return info.column === 'deletions' ? 'deletions' : 'additions'
  return null
}

function lineOn(info: LineInfo, side: LineSide): number | null {
  return sideOf(info) === side ? info.line : info.altLine
}

const isSplit = (column: LineInfo['column']) => column === 'additions' || column === 'deletions'

export function selectedLines(start: LineInfo, end: LineInfo): { side: LineSide; startLine: number; endLine: number } | null {
  if (isSplit(start.column) && isSplit(end.column) && start.column !== end.column) return null
  const startSide = sideOf(start)
  const endSide = sideOf(end)
  if (!startSide || !endSide) return null
  const side: LineSide = startSide === endSide ? startSide : 'additions'
  const first = lineOn(start, side) ?? lineOn(end, side)
  const last = lineOn(end, side) ?? lineOn(start, side)
  if (first === null || last === null) return null
  return { side, startLine: Math.min(first, last), endLine: Math.max(first, last) }
}

export function formatSelectionLocation(s: { path: string; startLine: number; endLine: number }): string {
  return s.startLine === s.endLine ? `${s.path}:${s.startLine}` : `${s.path}:${s.startLine}-${s.endLine}`
}

export function sideLabel(side: LineSide): string {
  return side === 'additions' ? '변경 후 코드' : '변경 전 코드'
}

export function trimSelectedCode(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run src/ui/selection.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS (10 tests), 타입 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add src/ui/selection.ts src/ui/selection.test.ts src/review/types.ts
git commit -m "feat: diff 선택 범위에서 파일 줄 번호와 변경 전후를 계산하는 함수 추가"
```

---

### Task 2: 서버 검사, 프롬프트, 저장

**Files:**
- Create: `src/review/selection.ts`
- Modify: `src/review/prompt.ts`, `src/review/store.ts` (`ReviewMessage`), `src/review/jobs.ts`, `src/server.ts` (`POST /api/review`)
- Test: `src/review/prompt.test.ts`, `src/server.review.test.ts`

**Interfaces:**
- Consumes: Task 1의 `CodeSelection`, `MAX_SELECTION_CHARS`
- Produces:
  - `buildQuestionPrompt(question: string, selection?: CodeSelection): string`
  - `parseSelection(value: unknown, repo: string): { ok: true; selection: CodeSelection | undefined } | { ok: false; error: 'invalid_selection' | 'selection_too_long'; message: string }`
  - `ReviewMessage.selection?: CodeSelection`, `StartInput.selection?: CodeSelection`
  - `ReviewJobs.runningFor(...)` 결과에 `selection: CodeSelection | null`
  - `POST /api/review` 본문의 `selection`

- [ ] **Step 1: `prompt.test.ts`에 테스트 추가**

import에 `buildQuestionPrompt`를 추가하고 파일 끝에 추가한다.

```ts
describe('buildQuestionPrompt', () => {
  const selection = { path: 'src/cart.ts', side: 'additions' as const, startLine: 12, endLine: 13, code: 'const total = 1\nreturn total' }

  it('returns the question as it is without a selection', () => {
    expect(buildQuestionPrompt('왜 이렇게 했어?')).toBe('왜 이렇게 했어?')
  })

  it('puts the selected code and its location before the question', () => {
    expect(buildQuestionPrompt('성능 괜찮아?', selection)).toBe(
      '사용자가 diff에서 선택한 코드: src/cart.ts 12-13줄 (변경 후 코드)\n```\nconst total = 1\nreturn total\n```\n\n질문: 성능 괜찮아?',
    )
  })

  it('writes a single line and the deletions side', () => {
    expect(buildQuestionPrompt('왜 지웠어?', { ...selection, side: 'deletions', endLine: 12, code: 'old()' })).toBe(
      '사용자가 diff에서 선택한 코드: src/cart.ts 12줄 (변경 전 코드)\n```\nold()\n```\n\n질문: 왜 지웠어?',
    )
  })

  it('lengthens the fence when the code contains backticks', () => {
    const prompt = buildQuestionPrompt('설명해줘', { ...selection, code: 'const md = "```ts"' })
    expect(prompt).toContain('\n````\nconst md = "```ts"\n````\n')
  })
})
```

- [ ] **Step 2: `server.review.test.ts`에 테스트 추가**

`describe('review API', ...)` 블록 안 마지막에 추가한다.

```ts
  const selection = { path: 'a.txt', side: 'additions', startLine: 2, endLine: 2, code: 'feature' }

  it('sends the selected code with the question and stores it', async () => {
    let prompt = ''
    const { app } = setup(async (_p, _c, request) => {
      prompt = request.prompt
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { kind: 'question', question: '왜?', selection })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(prompt).toBe('사용자가 diff에서 선택한 코드: a.txt 2줄 (변경 후 코드)\n```\nfeature\n```\n\n질문: 왜?')
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0]).toMatchObject({ kind: 'question', question: '왜?', selection })
  })

  it('rejects an invalid selection', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    for (const bad of [
      { ...selection, path: '../outside.txt' },
      { ...selection, side: 'both' },
      { ...selection, startLine: 0 },
      { ...selection, startLine: 3, endLine: 2 },
      { ...selection, code: '   ' },
    ]) {
      const res = await postReview(app, { kind: 'question', question: '왜?', selection: bad })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_selection', message: '선택한 코드 정보가 올바르지 않습니다' })
    }
  })

  it('rejects a selection longer than 4000 characters', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const res = await postReview(app, { kind: 'question', question: '왜?', selection: { ...selection, code: 'x'.repeat(4001) } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'selection_too_long', message: '선택한 코드는 4000자까지 보낼 수 있습니다' })
  })

  it('ignores a selection on a full review', async () => {
    let prompt = ''
    const { app } = setup(async (_p, _c, request) => {
      prompt = request.prompt
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { kind: 'review', selection })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(prompt).not.toContain('사용자가 diff에서 선택한 코드')
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0]).not.toHaveProperty('selection')
  })

  it('reports the selection of a running question', async () => {
    const { app } = setup(() => new Promise(() => {}))
    await postReview(app, { kind: 'question', question: '왜?', selection })
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.running).toMatchObject({ kind: 'question', question: '왜?', selection })
  })
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run src/review/prompt.test.ts src/server.review.test.ts`
Expected: FAIL. `buildQuestionPrompt`가 없고, 서버는 `selection`을 무시해서 프롬프트에 선택 블록이 없고 잘못된 선택도 200으로 받는다.

- [ ] **Step 4: `prompt.ts`에 `buildQuestionPrompt` 추가**

import를 바꾼다.

```ts
import type { CodeSelection, ReviewContext } from './types.js'
```

파일 끝에 추가한다.

```ts
function codeFence(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

export function buildQuestionPrompt(question: string, selection?: CodeSelection): string {
  if (!selection) return question
  const lines = selection.startLine === selection.endLine ? `${selection.startLine}줄` : `${selection.startLine}-${selection.endLine}줄`
  const side = selection.side === 'additions' ? '변경 후 코드' : '변경 전 코드'
  const fence = codeFence(selection.code)
  return `사용자가 diff에서 선택한 코드: ${selection.path} ${lines} (${side})\n${fence}\n${selection.code}\n${fence}\n\n질문: ${question}`
}
```

- [ ] **Step 5: `src/review/selection.ts` 만들기**

```ts
import { isSafePath } from '../path.js'
import { MAX_SELECTION_CHARS, type CodeSelection } from './types.js'

export type SelectionParse =
  | { ok: true; selection: CodeSelection | undefined }
  | { ok: false; error: 'invalid_selection' | 'selection_too_long'; message: string }

const INVALID: SelectionParse = { ok: false, error: 'invalid_selection', message: '선택한 코드 정보가 올바르지 않습니다' }

const isLine = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

export function parseSelection(value: unknown, repo: string): SelectionParse {
  if (value === undefined || value === null) return { ok: true, selection: undefined }
  if (typeof value !== 'object') return INVALID
  const { path, side, startLine, endLine, code } = value as Record<string, unknown>
  if (typeof path !== 'string' || !path || !isSafePath(path, repo)) return INVALID
  if (side !== 'additions' && side !== 'deletions') return INVALID
  if (!isLine(startLine) || !isLine(endLine) || startLine > endLine) return INVALID
  if (typeof code !== 'string' || !code.trim()) return INVALID
  if (code.length > MAX_SELECTION_CHARS) return { ok: false, error: 'selection_too_long', message: '선택한 코드는 4000자까지 보낼 수 있습니다' }
  return { ok: true, selection: { path, side, startLine, endLine, code } }
}
```

- [ ] **Step 6: `store.ts`와 `jobs.ts` 수정**

`src/review/store.ts`의 types import에 `CodeSelection`을 추가하고 `ReviewMessage`의 `excluded?: string[]` 아래에 추가한다.

```ts
  selection?: CodeSelection
```

`src/review/jobs.ts`를 바꾼다.

1. import를 바꾼다.

```ts
import { buildQuestionPrompt, buildReviewPrompt, buildSystemPrompt } from './prompt.js'
```

```ts
import { ReviewFailure, type CodeSelection, type FailureKind, type ProviderId, type ReviewContext, type ReviewProvider, type ReviewRequest, type ReviewResult, type ReviewSession } from './types.js'
```

2. `StartInput`의 `excluded?: string[]` 아래에 `selection?: CodeSelection`을 추가한다.
3. `Job`의 `question: string | null` 아래에 `selection: CodeSelection | null`을 추가한다.
4. `start`의 구조 분해를 `{ provider, ctx, key, fingerprint, kind, question, excluded, selection }`로 바꾸고, `job` 객체의 `question` 줄 아래에 추가한다.

```ts
      selection: kind === 'question' ? selection ?? null : null,
```

5. 프롬프트 줄을 바꾼다.

```ts
    const prompt = kind === 'review' ? buildReviewPrompt(ctx) : buildQuestionPrompt(job.question ?? '', job.selection ?? undefined)
```

6. 저장 메시지의 `excluded` 줄 아래에 추가한다.

```ts
          ...(job.selection ? { selection: job.selection } : {}),
```

7. `runningFor`를 바꾼다.

```ts
  runningFor(repoPath: string, key: string): { id: string; provider: ProviderId; startedAt: number; kind: MessageKind; question: string | null; selection: CodeSelection | null } | null {
    const job = [...this.jobs.values()].find((j) => this.isActive(j) && j.repoPath === repoPath && j.key === key)
    return job ? { id: job.id, provider: job.provider, startedAt: job.startedAt, kind: job.kind, question: job.question, selection: job.selection } : null
  }
```

- [ ] **Step 7: `server.ts` 수정**

import 목록의 `import { excludeFilesFromPatch } from './review/filterPatch.js'` 아래에 추가한다.

```ts
import { parseSelection } from './review/selection.js'
```

`app.post('/api/review', ...)`의 `body` 타입 끝에 `selection?: unknown`을 추가한다. 질문 길이 검사(`question.length > 2000`) 블록 바로 아래에 추가한다.

```ts
    const parsedSelection = kind === 'question' ? parseSelection(body.selection, repo) : { ok: true as const, selection: undefined }
    if (!parsedSelection.ok) return c.json({ error: parsedSelection.error, message: parsedSelection.message }, 400)
```

`reviewJobs.start({ ... })`의 `excluded: exclude,` 아래에 추가한다.

```ts
      selection: parsedSelection.selection,
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm vitest run src/review/ src/server.review.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS, 타입 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add src/review/selection.ts src/review/prompt.ts src/review/prompt.test.ts src/review/store.ts src/review/jobs.ts src/server.ts src/server.review.test.ts
git commit -m "feat: AI 질문에 선택한 코드를 받아 프롬프트에 넣고 대화에 저장"
```

---

### Task 3: 질문 요청과 질문 카드 표시

**Files:**
- Modify: `src/ui/hooks/useReview.ts`, `src/ui/components/ReviewPanel.tsx`, `src/ui/styles/global.css`
- Test: `src/ui/components/ReviewPanel.test.ts`(신규)

**Interfaces:**
- Consumes: Task 1의 `CodeSelection`, `formatSelectionLocation`. Task 2의 API(`selection` 본문, `running.selection`, 메시지 `selection`)
- Produces:
  - `useReview(...).ask(question: string, selection?: CodeSelection): Promise<void>`
  - `export function QuestionCard(props: { kind: MessageKind; question: string | null; excluded?: string[]; selection?: CodeSelection; onRemove?: () => void })`

- [ ] **Step 1: `ReviewPanel.test.ts` 작성**

```ts
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionCard } from './ReviewPanel'

describe('QuestionCard', () => {
  it('shows the selected code location and keeps the code folded', () => {
    const html = renderToStaticMarkup(createElement(QuestionCard, {
      kind: 'question',
      question: '왜?',
      selection: { path: 'src/cart.ts', side: 'additions', startLine: 12, endLine: 13, code: 'const total = 1' },
    }))
    expect(html).toContain('src/cart.ts:12-13 · 선택한 코드')
    expect(html).toContain('<details class="review-question-selection">')
    expect(html).toContain('const total = 1')
    expect(html).toContain('왜?')
  })

  it('renders no selection block without a selection', () => {
    const html = renderToStaticMarkup(createElement(QuestionCard, { kind: 'question', question: '왜?' }))
    expect(html).not.toContain('review-question-selection')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/ui/components/ReviewPanel.test.ts`
Expected: FAIL. `QuestionCard`가 export되지 않아 `createElement`에 `undefined`가 넘어간다.

- [ ] **Step 3: `ReviewPanel.tsx` 수정**

import에 추가한다.

```tsx
import type { CodeSelection } from '../../review/types'
import { formatSelectionLocation } from '../selection'
```

`QuestionCard`를 아래로 바꾼다.

```tsx
export function QuestionCard({ kind, question, excluded, selection, onRemove }: { kind: MessageKind; question: string | null; excluded?: string[]; selection?: CodeSelection; onRemove?: () => void }) {
  return (
    <div className="review-question">
      {selection && (
        <details className="review-question-selection">
          <summary>{formatSelectionLocation(selection)} · 선택한 코드</summary>
          <pre className="answer-code"><code>{selection.code}</code></pre>
        </details>
      )}
      <div className="review-question-text">{kind === 'review' ? '전체 리뷰' : question}</div>
      {excluded && excluded.length > 0 && <div className="review-panel-meta">제외한 파일 {excluded.length}개를 빼고 리뷰</div>}
      {onRemove && (
        <button className="review-question-remove" onClick={onRemove} title="삭제" aria-label="삭제">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
```

`QuestionCard`를 쓰는 두 곳에 `selection`을 넘긴다.

```tsx
            <QuestionCard kind={m.kind} question={m.question} excluded={m.excluded} selection={m.selection} onRemove={() => onRemove(m.id)} />
```

```tsx
        {pending && <QuestionCard kind={pending.kind} question={pending.question} excluded={pending.excluded} selection={pending.selection} />}
```

- [ ] **Step 4: `useReview.ts` 수정**

import에 추가한다.

```ts
import type { CodeSelection } from '../../review/types'
```

`ReviewMessage`와 `PendingQuestion`에 `selection?: CodeSelection`을 추가한다. `SavedConversation.running` 타입에 `selection?: CodeSelection | null`을 추가한다.

`send`의 요청 본문을 바꾼다.

```ts
        body: JSON.stringify({ provider: 'claude', ...Object.fromEntries(params), kind: pending.kind, question: pending.question ?? '', exclude: pending.excluded ?? [], ...(pending.selection ? { selection: pending.selection } : {}) }),
```

`ask`를 바꾼다.

```ts
  const ask = useCallback((question: string, selection?: CodeSelection) => send({ kind: 'question', question, ...(selection ? { selection } : {}) }), [send])
```

진행 중 작업에 다시 붙는 `useEffect`를 바꾼다.

```ts
      const { id, startedAt, kind, question, selection } = saved.running
      attach(id, startedAt, { kind, question, ...(selection ? { selection } : {}) }, true)
```

- [ ] **Step 5: 스타일 추가**

`src/ui/styles/global.css`의 `.review-panel-error { ... }` 규칙 아래에 추가한다.

```css
.review-question-selection {
    margin-bottom: 6px;
    font-size: 12px;
}

.review-question-selection summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.review-question-selection .answer-code {
    max-height: 240px;
    overflow: auto;
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run src/ui/components/ReviewPanel.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS (2 tests), 타입 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add src/ui/hooks/useReview.ts src/ui/components/ReviewPanel.tsx src/ui/components/ReviewPanel.test.ts src/ui/styles/global.css
git commit -m "feat: 선택한 코드를 담아 AI에게 질문하고 질문 카드에 위치와 코드 표시"
```

---

### Task 4: 선택 버튼과 입력 팝업

**Files:**
- Create: `src/ui/components/SelectionAsk.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/styles/global.css`

**Interfaces:**
- Consumes: Task 1의 `lineInfoFrom`, `selectedLines`, `formatSelectionLocation`, `sideLabel`, `trimSelectedCode`, `CodeSelection`, `MAX_SELECTION_CHARS`. Task 3의 `ask(question, selection)`
- Produces: `SelectionAsk(props: { disabled: boolean; resetKey: string | null; onAsk: (question: string, selection: CodeSelection) => void })`

이 Task는 브라우저 선택과 DOM 이벤트를 다루므로 단위테스트를 쓰지 않는다. 계산 로직은 Task 1이 확인한다. 동작은 Step 5 앱 확인으로 본다.

- [ ] **Step 1: `SelectionAsk.tsx` 작성**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Sparkles } from 'lucide-react'
import { MAX_SELECTION_CHARS, type CodeSelection } from '../../review/types'
import { formatSelectionLocation, lineInfoFrom, selectedLines, sideLabel, trimSelectedCode } from '../selection'

interface Picked {
  selection: CodeSelection
  top: number
  right: number
}

type ShadowWithSelection = ShadowRoot & { getSelection?: () => Selection | null }

function pickSelection(event: MouseEvent): Picked | null {
  const path = event.composedPath()
  const card = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('file-diff-card'))
  const host = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.shadowRoot !== null)
  if (!card || !card.id.startsWith('file-') || !host?.shadowRoot) return null
  const root = host.shadowRoot as ShadowWithSelection
  const sel = root.getSelection?.()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  if (!sel.anchorNode || !sel.focusNode || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null
  const code = trimSelectedCode(sel.toString())
  if (!code.trim()) return null
  const start = lineInfoFrom(sel.anchorNode)
  const end = lineInfoFrom(sel.focusNode)
  if (!start || !end) return null
  const lines = selectedLines(start, end)
  if (!lines) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  return { selection: { path: card.id.slice('file-'.length), ...lines, code }, top: rect.bottom + 4, right: rect.right }
}

export function SelectionAsk({ disabled, resetKey, onAsk }: { disabled: boolean; resetKey: string | null; onAsk: (question: string, selection: CodeSelection) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setPicked(null)
    setOpen(false)
    setText('')
  }

  useEffect(close, [resetKey])

  useEffect(() => {
    const inside = (target: EventTarget | null) => !!boxRef.current && target instanceof Node && boxRef.current.contains(target)
    const handleMouseDown = (e: MouseEvent) => {
      if (!inside(e.target)) close()
    }
    const handleMouseUp = (e: MouseEvent) => {
      if (inside(e.target)) return
      const next = pickSelection(e)
      setPicked(next)
      setOpen(false)
      setText('')
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const handleScroll = (e: Event) => {
      if (!inside(e.target)) close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  if (!picked) return null
  const { selection } = picked
  const tooLong = selection.code.length > MAX_SELECTION_CHARS
  const canSend = !disabled && !tooLong && text.trim().length > 0
  const width = open ? 420 : 140
  const style = { top: picked.top, left: Math.max(8, Math.min(picked.right - width, window.innerWidth - width - 8)) }

  const send = () => {
    if (!canSend) return
    onAsk(text.trim(), selection)
    close()
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div ref={boxRef} className="sel-ask" style={style}>
      {open ? (
        <div className="sel-ask-popup">
          <div className="sel-ask-location">{formatSelectionLocation(selection)} ({sideLabel(selection.side)})</div>
          {tooLong && <div className="sel-ask-error">선택한 코드가 너무 깁니다 (4000자까지)</div>}
          <div className="sel-ask-row">
            <textarea
              className="sel-ask-input"
              autoFocus
              rows={1}
              maxLength={2000}
              value={text}
              placeholder="선택한 코드에 대해 질문하기"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="sel-ask-send" aria-label="보내기" disabled={!canSend} onClick={send}>
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-sm sel-ask-button"
          disabled={disabled}
          title={disabled ? '진행 중인 질문이 끝난 뒤 다시 보내 주세요' : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
        >
          <Sparkles size={14} />
          AI에게 질문
        </button>
      )}
    </div>
  )
}
```

`useEffect(close, [resetKey])`는 `close`가 상태 setter만 호출하므로 의존성 경고가 나도 동작에 문제가 없다. 린트가 막으면 `useEffect(() => close(), [resetKey])`로 쓴다.

- [ ] **Step 2: `App.tsx` 연결**

import에 추가한다.

```tsx
import { SelectionAsk } from './components/SelectionAsk'
import type { CodeSelection } from '../review/types'
```

`review` 선언(`const review = useReview(params, key)`)과 `reviewPanel` `useState` 선언보다 아래에 추가한다.

```tsx
  const handleAskSelection = useCallback((question: string, selection: CodeSelection) => {
    setReviewPanel((prev) => {
      const next = { ...prev, open: true, tab: 'review' as const }
      saveReviewPanel(next)
      return next
    })
    void review.ask(question, selection)
  }, [review.ask])
```

`<DiffViewer ... />` 바로 아래(같은 부모 안)에 추가한다.

```tsx
            <SelectionAsk disabled={review.state.status === 'running'} resetKey={key} onAsk={handleAskSelection} />
```

- [ ] **Step 3: 스타일 추가**

`src/ui/styles/global.css` 끝에 추가한다.

```css
.sel-ask {
    position: fixed;
    z-index: 300;
}

.sel-ask-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}

.sel-ask-popup {
    width: 420px;
    padding: 8px 10px;
    border: 1px solid var(--primary);
    border-radius: 14px;
    background: var(--bg);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.sel-ask-location {
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.sel-ask-error {
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--danger);
}

.sel-ask-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
}

.sel-ask-input {
    flex: 1;
    min-width: 0;
    field-sizing: content;
    max-height: 9em;
    padding: 4px 2px;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    line-height: 1.5;
}

.sel-ask-send {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border: none;
    border-radius: 50%;
    background: var(--primary);
    color: #ffffff;
    cursor: pointer;
}

.sel-ask-send:disabled {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: default;
}

@media (prefers-color-scheme: dark) {
    .sel-ask-popup {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }
}
```

- [ ] **Step 4: 타입 검사, 전체 테스트, 빌드**

Run: `pnpm exec tsc --noEmit -p . && pnpm test && pnpm run build:electron`
Expected: 타입 오류 없음, 테스트 462개 통과(기존 441개와 Task 1의 10개, Task 2의 9개(prompt 4, server 5), Task 3의 2개), 빌드 성공

`.sel-ask-input`의 `field-sizing`이 TypeScript CSS 검사 대상은 아니므로 빌드 경고만 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add src/ui/components/SelectionAsk.tsx src/ui/App.tsx src/ui/styles/global.css
git commit -m "feat: diff에서 코드를 선택하면 AI에게 질문하는 버튼과 입력 팝업 표시"
```

- [ ] **Step 6: 앱 확인 (사용자)**

사용자가 worktree에서 `pnpm run dev:app`을 실행하거나 실행을 요청한다.

1. 코드 여러 줄을 선택하고 Cmd+C로 복사했을 때 붙여넣은 글에 줄 번호가 섞이지 않는다.
2. unified 보기와 split 보기에서 추가 줄, 삭제 줄, context 줄을 선택했을 때 버튼이 뜨고, 팝업의 `경로:줄` 표시와 `(변경 후 코드)`, `(변경 전 코드)` 표시가 맞다. 아래에서 위로 드래그해도 줄 번호가 작은 쪽부터 나온다.
3. split 보기에서 왼쪽과 오른쪽에 걸쳐 선택하거나 파일 카드 두 개에 걸쳐 선택하면 버튼이 뜨지 않는다.
4. 팝업에서 질문을 쓰고 Enter를 누르면 오른쪽 패널이 열리고 `AI 리뷰` 탭에 질문 카드가 생긴다. 카드의 `경로:줄 · 선택한 코드`를 펼치면 선택한 코드가 보이고, 답변이 선택한 코드를 바탕으로 나온다.
5. 한글 입력 중 Enter는 글자 확정만 하고 보내지 않는다. Shift+Enter는 줄바꿈이다.
6. 팝업 밖 클릭, `Escape`, diff 스크롤, 다른 MR 선택 시 버튼과 팝업이 닫힌다.
7. 답변을 만드는 중에 코드를 선택하면 버튼이 비활성이고 마우스를 올리면 `진행 중인 질문이 끝난 뒤 다시 보내 주세요`가 보인다.
