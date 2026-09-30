# AI 리뷰 패널 대화형 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 리뷰 패널을 Claude Code 세션을 이어가며 질문하는 대화 화면으로 바꾼다. [전체 리뷰]는 고정 리뷰 프롬프트를, [보내기]는 입력한 문장만 보내고 질문과 답변을 모두 저장한다.

**Architecture:** 서버는 비교 조합(key)마다 `ReviewConversation`(세션 ID와 질문과 답변 목록)을 저장한다. `ReviewJobs`가 저장된 세션 ID로 `claude --resume`을, 없으면 `--session-id`로 새 세션을 실행하고, 기본 규칙과 비교 정보는 `--append-system-prompt`로 넣는다. UI는 `useReview`가 대화 목록과 진행 상태를 관리하고 `ReviewPanel`이 질문 카드, 답변 카드(react-markdown과 shiki 하이라이팅), 위치 카드, 하단 입력 영역을 그린다.

**Tech Stack:** TypeScript, Hono, React 19, @tanstack/react-query, react-markdown 10, @pierre/diffs(shiki), vitest

**Spec:** `docs/superpowers/specs/2026-09-30-ai-review-chat-design.md`

## Global Constraints

- 새 npm 의존성은 `react-markdown`(devDependencies) 하나만 추가한다.
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다.
- 질문 길이 제한: 2000자. 오류 문구: "질문을 입력해 주세요", "질문은 2000자까지 입력할 수 있습니다", "이어갈 Claude 세션을 찾지 못했습니다", "취소했습니다"
- 화면 문구: "AI 리뷰", "새 대화", "전체 리뷰", "보내기", "취소", "관련 위치 N건", "파일 위치", "요약", "내용", "코드 보기", "(파일 전체)", "이 답변 이후 코드가 바뀌었습니다", "제외한 파일 N개를 빼고 리뷰", 새 대화 확인창 "모든 질문과 답변을 지우고 새 대화를 시작할까요?"
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 작업 시작 시점에 테스트 265개가 통과한다.
- 작업 브랜치: `feature/ai-review-chat`(워크트리 `~/Desktop/diffx-feature-ai-review-chat`)

## Review Focus

1. 이전 형식 파일에서 바꾼 질문과 답변의 X 버튼을 누르면 지워져야 한다. 불러올 때마다 id가 새로 만들어지면 삭제 API가 404를 응답한다. Task 4 store 테스트 `gives a legacy message a stable id`가 확인한다.
2. `DELETE /api/review/conversation`이 `DELETE /api/review/:id`(작업 취소)로 잡히면 저장 파일이 지워지지 않는다. Task 4 서버 테스트 `clears the conversation and starts a new session next time`이 확인한다.
3. 질문이 진행 중일 때 다른 질문과 답변을 X로 지우면, 진행 중이던 질문이 끝나 저장될 때 지운 항목이 되살아나면 안 된다. Task 4 store 테스트 `append reads the file again`이 확인한다.
4. `--resume` 실패 후 다시 실행하는 중에 사용자가 취소하면 한 번 더 실행하지 않아야 한다. Task 4 jobs 테스트 `does not retry after cancel`이 확인한다.
5. 답변에 `<img src=x onerror=...>` 같은 HTML이 들어 있어도 실행되지 않아야 한다. Task 6 `AnswerMarkdown` 테스트 `does not render raw HTML`이 확인한다.

---

### Task 1: 응답 스키마를 answer와 locations로 바꾸기

**Files:**
- Modify: `src/review/types.ts`, `src/review/schema.ts`, `src/review/prompt.ts`(JSON 예시 블록만), `src/review/__fixtures__/fake-cli.mjs`, `src/review/__fixtures__/claude-stream.jsonl`
- Test: `src/review/schema.test.ts`, `src/review/prompt.test.ts`, `src/review/runner.test.ts`, `src/review/jobs.test.ts`, `src/review/store.test.ts`, `src/review/providers/claude.test.ts`, `src/server.review.test.ts`

**Interfaces:**
- Produces:
  - `interface ReviewLocation { file: string; line: number | null; side: 'old' | 'new'; title: string; body: string }`
  - `interface ReviewResult { answer: string; locations: ReviewLocation[] }`
  - `Finding`, `Severity` 타입 삭제
  - `REVIEW_JSON_SCHEMA.required = ['answer', 'locations']`, location의 required는 `['file', 'line', 'side', 'title', 'body']`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/review/schema.test.ts`의 `valid`와 `validateResult`, `REVIEW_JSON_SCHEMA` 테스트를 바꾼다. `extractJson` 테스트는 그대로 둔다.

```ts
const valid = {
  answer: '요약',
  locations: [{ file: 'a.ts', line: 3, side: 'new', title: '제목', body: '내용' }],
}

describe('validateResult', () => {
  it('accepts a valid result', () => {
    expect(validateResult(valid)).toEqual(valid)
  })

  it('accepts null line', () => {
    const v = { ...valid, locations: [{ ...valid.locations[0], line: null }] }
    expect(validateResult(v)).toEqual(v)
  })

  it('rejects wrong shapes', () => {
    expect(validateResult(null)).toBeNull()
    expect(validateResult({ answer: 1, locations: [] })).toBeNull()
    expect(validateResult({ summary: 's', findings: [] })).toBeNull()
    expect(validateResult({ answer: 's', locations: [{ ...valid.locations[0], line: 1.5 }] })).toBeNull()
    expect(validateResult({ answer: 's', locations: [{ ...valid.locations[0], side: 'left' }] })).toBeNull()
  })

  it('drops unknown extra fields including severity', () => {
    const v = { ...valid, extra: 1, locations: [{ ...valid.locations[0], severity: 'major' }] }
    expect(validateResult(v)).toEqual(valid)
  })
})
```

```ts
describe('REVIEW_JSON_SCHEMA', () => {
  it('is strict', () => {
    const s = REVIEW_JSON_SCHEMA as unknown as { additionalProperties: boolean; required: string[]; properties: { locations: { items: { additionalProperties: boolean; required: string[] } } } }
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['answer', 'locations'])
    expect(s.properties.locations.items.additionalProperties).toBe(false)
    expect(s.properties.locations.items.required).toEqual(['file', 'line', 'side', 'title', 'body'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/review/schema.test.ts`
Expected: FAIL (`validateResult`가 `answer`를 모른다)

- [ ] **Step 3: 타입과 스키마 구현**

`src/review/types.ts`에서 `Severity`, `Finding`을 지우고 아래로 바꾼다.

```ts
export interface ReviewLocation {
  file: string
  line: number | null
  side: 'old' | 'new'
  title: string
  body: string
}

export interface ReviewResult {
  answer: string
  locations: ReviewLocation[]
}
```

`src/review/schema.ts`의 앞부분(`SEVERITIES`부터 `validateResult`까지)을 아래로 바꾼다. `tryParse`, `extractJson`은 그대로 둔다.

```ts
import type { ReviewLocation, ReviewResult } from './types.js'

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'locations'],
  properties: {
    answer: { type: 'string' },
    locations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'line', 'side', 'title', 'body'],
        properties: {
          file: { type: 'string' },
          line: { type: ['integer', 'null'] },
          side: { type: 'string', enum: ['old', 'new'] },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
} as const

function toLocation(value: unknown): ReviewLocation | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.file !== 'string' || typeof v.title !== 'string' || typeof v.body !== 'string') return null
  if (v.side !== 'old' && v.side !== 'new') return null
  if (v.line !== null && !Number.isInteger(v.line)) return null
  return { file: v.file, line: v.line as number | null, side: v.side, title: v.title, body: v.body }
}

export function validateResult(value: unknown): ReviewResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.answer !== 'string' || !Array.isArray(v.locations)) return null
  const locations: ReviewLocation[] = []
  for (const item of v.locations) {
    const l = toLocation(item)
    if (!l) return null
    locations.push(l)
  }
  return { answer: v.answer, locations }
}
```

`src/review/prompt.ts`의 `## 응답 형식` JSON 예시 블록을 새 필드 이름으로 바꾼다(프롬프트 전체는 Task 2에서 다시 쓴다).

```ts
    '```json',
    '{',
    '  "answer": "MR 전체 요약. 무엇을 바꿨고 머지 전에 확인할 점이 무엇인지 3~6문장",',
    '  "locations": [',
    '    {',
    '      "file": "저장소 루트 기준 파일 경로",',
    '      "line": "지적하는 줄 번호(정수). 파일 전체에 대한 지적이면 null",',
    '      "side": "새 코드의 줄이면 new, 삭제된 코드의 줄이면 old",',
    '      "title": "한 줄 요약",',
    '      "body": "문제 설명과 수정 제안"',
    '    }',
    '  ]',
    '}',
    '```',
    '지적할 것이 없으면 locations를 빈 배열로 두세요.',
```

`'- 버그, 보안 문제, ... 취향 차이인 스타일 지적은 info로만 남기세요.'` 줄은 `'- 버그, 보안 문제, 잘못된 동작, 누락된 예외 처리를 우선 찾으세요. 취향 차이인 스타일 지적은 하지 마세요.'`로 바꾼다.

- [ ] **Step 4: fixture 바꾸기**

`src/review/__fixtures__/fake-cli.mjs`:

```js
const result = { answer: '요약', locations: [{ file: 'a.ts', line: 1, side: 'new', title: 't', body: 'b' }] }
```

같은 파일 `echo` 분기:

```js
    console.log(JSON.stringify({ type: 'final', json: { answer: stdin.slice(0, 20), locations: [] } }))
```

`claude-stream.jsonl`의 `StructuredOutput` 입력과 `result.structured_output`을 새 필드로 바꾼다.

```bash
node -e "
const fs = require('fs')
const p = 'src/review/__fixtures__/claude-stream.jsonl'
const conv = (o) => ({ answer: o.summary, locations: o.findings.map(({ severity, ...rest }) => rest) })
const out = fs.readFileSync(p, 'utf8').split('\n').map((l) => {
  if (!l.trim()) return l
  const ev = JSON.parse(l)
  if (ev.type === 'assistant') for (const c of ev.message.content ?? []) if (c.type === 'tool_use' && c.name === 'StructuredOutput') c.input = conv(c.input)
  if (ev.type === 'result' && ev.structured_output) ev.structured_output = conv(ev.structured_output)
  return JSON.stringify(ev)
}).join('\n')
fs.writeFileSync(p, out)
"
grep -c '"answer"' src/review/__fixtures__/claude-stream.jsonl
```

Expected: `2`

- [ ] **Step 5: 나머지 테스트의 필드 이름 바꾸기**

```bash
sed -i '' \
  -e "s/{ summary: 's', findings: \[\] }/{ answer: 's', locations: [] }/g" \
  -e "s/{ summary: '요약', findings: \[\] }/{ answer: '요약', locations: [] }/g" \
  -e "s/result: { summary: 's' }/result: { answer: 's' }/g" \
  -e "s/record: { result: { summary: '요약' } }/record: { result: { answer: '요약' } }/g" \
  -e "s/result\.summary/result.answer/g" \
  -e "s/(await run('text'))\.findings/(await run('text')).locations/g" \
  src/review/jobs.test.ts src/review/runner.test.ts src/review/store.test.ts src/server.review.test.ts
sed -i '' -e "s/'\"findings\"'/'\"locations\"'/" src/review/prompt.test.ts
sed -i '' -e "s/required).toEqual(\['summary', 'findings'\])/required).toEqual(['answer', 'locations'])/" src/review/providers/claude.test.ts
grep -rn "summary\|findings" src/review/*.test.ts src/review/providers/*.test.ts src/server.review.test.ts
```

Expected: `claude.test.ts`의 `describeTool('StructuredOutput', { summary: 'x' })` 한 줄만 남는다(도구 입력값이라 그대로 둔다).

- [ ] **Step 6: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 테스트 모두 PASS. 타입 오류는 `src/ui` 밖에서 없어야 한다. UI는 자체 타입을 쓰므로 이 단계에서 오류가 나지 않는다.

- [ ] **Step 7: Commit**

```bash
git add src/review
git add src/server.review.test.ts
git commit -m "refactor: AI 리뷰 응답 스키마를 answer와 locations로 바꾸고 severity 제거"
```

---

### Task 2: system prompt와 전체 리뷰 프롬프트 분리

**Files:**
- Modify: `src/review/prompt.ts`, `src/review/runner.ts:4,53`
- Test: `src/review/prompt.test.ts`, `src/review/runner.test.ts`

**Interfaces:**
- Consumes: `ReviewContext`(`src/review/types.ts`)
- Produces:
  - `buildSystemPrompt(ctx: ReviewContext): string` — 비교 정보와 기본 규칙
  - `buildReviewPrompt(ctx: ReviewContext): string` — [전체 리뷰] 본문
  - `buildPrompt` 삭제. `MAX_PATCH_CHARS`는 유지

- [ ] **Step 1: 실패하는 테스트 작성**

`src/review/prompt.test.ts` 전체를 아래로 바꾼다.

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildReviewPrompt, MAX_PATCH_CHARS } from './prompt'
import type { ReviewContext } from './types'

const base: ReviewContext = {
  repoPath: '/repo',
  mode: 'branch',
  source: 'feature/x',
  target: 'origin/main',
  mergeBase: 'abc123',
  sourceCheckedOut: true,
  files: ['src/a.ts', 'src/b.ts'],
  patch: 'diff --git a/src/a.ts b/src/a.ts\n+hello',
}

describe('buildSystemPrompt', () => {
  it('includes the comparison and the five rules without the diff', () => {
    const p = buildSystemPrompt(base)
    expect(p).toContain('origin/main...feature/x')
    expect(p).toContain('소스 브랜치: feature/x')
    expect(p).toContain('타겟 브랜치: origin/main')
    expect(p).toContain('merge-base 커밋: abc123')
    expect(p).toContain('파일을 수정하지 마세요')
    expect(p).toContain('git show, git log, git diff')
    expect(p).toContain('한국어')
    expect(p).toContain('locations')
    expect(p).toContain('리뷰를 요청하지 않았으면 리뷰하지 마세요')
    expect(p).not.toContain('+hello')
    expect(p).not.toContain('src/b.ts')
    expect(p).not.toContain('시니어 코드 리뷰어')
  })

  it('tells Claude to use git show when the source is not checked out', () => {
    expect(buildSystemPrompt({ ...base, sourceCheckedOut: false })).toContain('git show feature/x:<경로>')
    expect(buildSystemPrompt(base)).toContain('작업 트리의 파일이 리뷰 대상 코드와 같습니다')
  })
})

describe('buildReviewPrompt', () => {
  it('includes the review instruction, files and patch', () => {
    const p = buildReviewPrompt(base)
    expect(p).toContain('버그, 보안 문제')
    expect(p).toContain('머지 전에 확인할 점')
    expect(p).toContain('- src/a.ts')
    expect(p).toContain('+hello')
    expect(p).toContain('git diff abc123 feature/x -- <경로>')
    expect(p).not.toContain('시니어 코드 리뷰어')
    expect(p).not.toContain('```json')
  })

  it('omits the patch body when it is too large', () => {
    const p = buildReviewPrompt({ ...base, patch: 'x'.repeat(MAX_PATCH_CHARS + 1) })
    expect(p).not.toContain('x'.repeat(1000))
    expect(p).toContain('diff가 커서 본문을 싣지 않았습니다')
  })
})
```

`src/review/runner.test.ts`의 import와 `passes the prompt on stdin` 테스트를 바꾼다.

```ts
import { buildReviewPrompt } from './prompt'
```

```ts
  it('passes the prompt on stdin', async () => {
    const result = await run('echo')
    expect(result.answer).toBe(buildReviewPrompt(ctx).slice(0, 20))
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/review/prompt.test.ts src/review/runner.test.ts`
Expected: FAIL (`buildSystemPrompt is not a function`)

- [ ] **Step 3: 구현**

`src/review/prompt.ts` 전체를 아래로 바꾼다.

```ts
import type { ReviewContext } from './types.js'

export const MAX_PATCH_CHARS = 200_000

function fileReadingGuide(ctx: ReviewContext): string {
  if (!ctx.sourceCheckedOut) {
    return `소스 브랜치가 체크아웃되어 있지 않아서 작업 트리의 파일은 비교 대상과 다를 수 있습니다. 파일 전체 내용은 \`git show ${ctx.source}:<경로>\`로 읽으세요.`
  }
  return '작업 트리의 파일이 리뷰 대상 코드와 같습니다. 파일을 직접 읽어도 됩니다.'
}

function diffCommand(ctx: ReviewContext): string {
  return `git diff ${ctx.mergeBase} ${ctx.source} -- <경로>`
}

export function buildSystemPrompt(ctx: ReviewContext): string {
  return [
    '## 비교 대상',
    `- ${ctx.target}...${ctx.source} (GitLab MR과 같은 방식)`,
    `- 소스 브랜치: ${ctx.source}`,
    `- 타겟 브랜치: ${ctx.target}`,
    `- merge-base 커밋: ${ctx.mergeBase}`,
    `- ${fileReadingGuide(ctx)}`,
    '',
    '## 지켜야 할 것',
    '- 파일을 수정하지 마세요.',
    '- 읽기와 git 조회 명령(git show, git log, git diff)만 사용하세요.',
    '- 모든 문장은 한국어로 쓰세요.',
    '- 답변에서 코드 위치를 언급하면 그 위치를 locations에 넣으세요. file은 저장소 루트 기준 경로, line은 줄 번호(파일 전체면 null), side는 새 코드면 new, 삭제된 코드면 old입니다.',
    '- 질문에 맞는 형식으로 답하세요. 사용자가 리뷰를 요청하지 않았으면 리뷰하지 마세요.',
    '- answer는 markdown으로 써도 됩니다.',
  ].join('\n')
}

export function buildReviewPrompt(ctx: ReviewContext): string {
  const patchSection = ctx.patch.length > MAX_PATCH_CHARS
    ? `diff가 커서 본문을 싣지 않았습니다. 파일별 diff는 \`${diffCommand(ctx)}\`로 직접 확인하세요.`
    : ['```diff', ctx.patch, '```'].join('\n')

  return [
    '아래 변경사항을 리뷰하세요.',
    '',
    '- 버그, 보안 문제, 잘못된 동작, 누락된 예외 처리를 우선 찾으세요. 취향 차이인 스타일 지적은 하지 마세요.',
    '- answer에는 무엇을 바꿨고 머지 전에 확인할 점이 무엇인지 쓰세요.',
    '- 지적할 코드 위치는 locations에 넣으세요. 지적할 것이 없으면 locations를 빈 배열로 두세요.',
    `- 파일별 변경 내용은 \`${diffCommand(ctx)}\`로 확인할 수 있습니다.`,
    '- 변경된 코드를 호출하는 곳이나 관련 타입 정의가 필요하면 저장소 파일을 찾아 읽으세요.',
    '',
    '## 변경된 파일',
    ...ctx.files.map((f) => `- ${f}`),
    '',
    '## diff',
    patchSection,
  ].join('\n')
}
```

`src/review/runner.ts`의 import와 `buildCommand` 호출을 바꾼다(Task 3에서 다시 바꾼다).

```ts
import { buildReviewPrompt } from './prompt.js'
```

```ts
    command = provider.buildCommand(ctx, buildReviewPrompt(ctx))
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모두 PASS. `server.review.test.ts`의 instruction 테스트 세 개는 `ctx.instruction`만 확인하므로 아직 통과한다.

- [ ] **Step 5: Commit**

```bash
git add src/review/prompt.ts src/review/prompt.test.ts src/review/runner.ts src/review/runner.test.ts
git commit -m "refactor: AI 리뷰 프롬프트를 system prompt와 전체 리뷰 본문으로 분리"
```

---

### Task 3: Claude 세션 인자와 session_missing 실패 구분

**Files:**
- Modify: `src/review/types.ts`, `src/review/providers/claude.ts`, `src/review/runner.ts`, `src/review/jobs.ts`(run 호출 한 곳), `src/review/__fixtures__/fake-cli.mjs`
- Test: `src/review/providers/claude.test.ts`, `src/review/runner.test.ts`, `src/review/jobs.test.ts`, `src/server.review.test.ts`

**Interfaces:**
- Consumes: `buildSystemPrompt`, `buildReviewPrompt`(Task 2)
- Produces:
  - `interface ReviewSession { id: string; resume: boolean }`
  - `interface ReviewRequest { prompt: string; systemPrompt: string; session: ReviewSession }`
  - `ReviewProvider.buildCommand(ctx: ReviewContext, request: ReviewRequest): Command`
  - `ReviewProvider.sessionMissingPattern?: RegExp`
  - `FailureKind`에 `'session_missing'` 추가
  - `runReview(provider, ctx, request: ReviewRequest, options?: RunOptions): Promise<ReviewResult>`
  - `RunFn = (provider: ReviewProvider, ctx: ReviewContext, request: ReviewRequest, options: RunOptions) => Promise<ReviewResult>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/review/providers/claude.test.ts`의 `claudeProvider.buildCommand` describe를 아래로 바꾼다.

```ts
const request = { prompt: 'PROMPT', systemPrompt: 'SYSTEM', session: { id: 's-1', resume: false } }

describe('claudeProvider.buildCommand', () => {
  it('runs claude headless with a new session, the system prompt, read-only tools and the schema', () => {
    const cmd = claudeProvider.buildCommand(ctx, request)
    expect(cmd.bin).toBe('claude')
    expect(cmd.stdin).toBe('PROMPT')
    expect(cmd.args.slice(0, 13)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--session-id', 's-1', '--append-system-prompt', 'SYSTEM', '--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--tools'])
    expect(cmd.args).not.toContain('--no-session-persistence')
    expect(cmd.args).not.toContain('--resume')
    expect(cmd.args.slice(cmd.args.indexOf('--tools') + 1, cmd.args.indexOf('--json-schema'))).toEqual(['Read', 'Grep', 'Glob', 'Bash'])
    const allowed = cmd.args.slice(cmd.args.indexOf('--allowedTools') + 1, cmd.args.indexOf('--disallowedTools'))
    expect(allowed).toEqual(['Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git diff:*)'])
    const denied = cmd.args.slice(cmd.args.indexOf('--disallowedTools') + 1)
    expect(denied).toEqual(['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(git * --output*)', 'Bash(git * --no-index*)'])
    expect(JSON.parse(cmd.args[cmd.args.indexOf('--json-schema') + 1]).required).toEqual(['answer', 'locations'])
  })

  it('resumes an existing session', () => {
    const cmd = claudeProvider.buildCommand(ctx, { ...request, session: { id: 's-1', resume: true } })
    expect(cmd.args.slice(4, 6)).toEqual(['--resume', 's-1'])
    expect(cmd.args).not.toContain('--session-id')
  })

  it('recognizes the missing session message', () => {
    expect(claudeProvider.sessionMissingPattern!.test('No conversation found with session ID: 3f0c6d1e')).toBe(true)
  })
})
```

`src/review/runner.test.ts`:

```ts
import { ReviewFailure, type ReviewProvider, type ReviewContext, type ReviewRequest } from './types'
```

`ctx` 선언 아래에 추가:

```ts
const request: ReviewRequest = { prompt: 'PROMPT 본문입니다 가나다라마바사아자차', systemPrompt: 'SYSTEM', session: { id: 's-1', resume: false } }
```

`run` 헬퍼와 `passes the prompt on stdin`을 바꾼다. `buildReviewPrompt` import는 지운다.

```ts
const run = (mode: string, provider = fakeProvider(), opts = {}) =>
  runReview(provider, ctx, request, { env: { ...process.env, FAKE_MODE: mode }, ...opts })
```

```ts
  it('passes the prompt on stdin', async () => {
    const result = await run('echo')
    expect(result.answer).toBe(request.prompt.slice(0, 20))
  })

  it('classifies a missing session as session_missing', async () => {
    const provider = fakeProvider({ sessionMissingPattern: /No conversation found/ })
    const err = await failure(run('no-session', provider))
    expect(err.kind).toBe('session_missing')
    expect(err.message).toBe('이어갈 Claude 세션을 찾지 못했습니다')
  })
```

나머지 호출부를 새 시그니처로 바꾼다.

```bash
sed -i '' \
  -e 's/(_c, prompt)/(_c, request)/g' \
  -e 's/(_ctx, prompt)/(_ctx, request)/g' \
  -e 's/stdin: prompt/stdin: request.prompt/g' \
  -e 's/runReview(provider, ctx, { env/runReview(provider, ctx, request, { env/g' \
  -e 's/runReview(fakeProvider(), ctx, {/runReview(fakeProvider(), ctx, request, {/g' \
  src/review/runner.test.ts
sed -i '' -e 's/const run: RunFn = (_p, _c, options)/const run: RunFn = (_p, _c, _r, options)/' src/review/jobs.test.ts
sed -i '' -e 's/(_p, ctx, opts)/(_p, ctx, _r, opts)/g' -e 's/(_p, _c, opts)/(_p, _c, _r, opts)/g' src/server.review.test.ts
```

`src/review/__fixtures__/fake-cli.mjs`의 `crash` 분기 앞에 추가:

```js
  } else if (mode === 'no-session') {
    console.error('No conversation found with session ID: 3f0c6d1e')
    process.exit(1)
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/review`
Expected: FAIL (`--session-id`가 없고 `session_missing` kind가 없다)

- [ ] **Step 3: 구현**

`src/review/types.ts`:

```ts
export interface ReviewSession {
  id: string
  resume: boolean
}

export interface ReviewRequest {
  prompt: string
  systemPrompt: string
  session: ReviewSession
}
```

`ReviewProvider`를 바꾼다.

```ts
  sessionMissingPattern?: RegExp
  versionArgs: string[]
  buildCommand(ctx: ReviewContext, request: ReviewRequest): Command
```

```ts
export type FailureKind = 'not_installed' | 'auth' | 'timeout' | 'invalid_output' | 'process' | 'cancelled' | 'session_missing'
```

`src/review/providers/claude.ts`의 `buildCommand`와 `authPattern` 아래를 바꾼다.

```ts
  authPattern: /\/login|log ?in|invalid api key|authenticat|unauthori[sz]ed/i,
  sessionMissingPattern: /No conversation found with session ID/,
  versionArgs: ['--version'],
  buildCommand(_ctx, request) {
    return {
      bin: 'claude',
      args: [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        ...(request.session.resume ? ['--resume', request.session.id] : ['--session-id', request.session.id]),
        '--append-system-prompt', request.systemPrompt,
        '--restricted',
        '--strict-mcp-config',
        '--permission-mode', 'dontAsk',
        '--tools', 'Read', 'Grep', 'Glob', 'Bash',
        '--json-schema', JSON.stringify(REVIEW_JSON_SCHEMA),
        '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git diff:*)',
        '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(git * --output*)', 'Bash(git * --no-index*)',
      ],
      stdin: request.prompt,
    }
  },
```

`src/review/runner.ts`:
- `import { buildReviewPrompt } from './prompt.js'`를 지운다.
- types import에 `type ReviewRequest`를 추가한다.
- `PROBE_CONTEXT` 아래에 `const PROBE_REQUEST: ReviewRequest = { prompt: '', systemPrompt: '', session: { id: 'probe', resume: false } }`를 추가하고 `detectProvider`에서 `provider.buildCommand(PROBE_CONTEXT, PROBE_REQUEST)`로 부른다.
- `runReview` 시그니처와 `buildCommand` 호출:

```ts
export function runReview(provider: ReviewProvider, ctx: ReviewContext, request: ReviewRequest, options: RunOptions = {}): Promise<ReviewResult> {
  let command: Command
  try {
    command = provider.buildCommand(ctx, request)
```

- `close` 핸들러의 `if (code !== 0 || final?.isError) {` 블록 맨 앞에 추가:

```ts
          if (provider.sessionMissingPattern?.test(combined)) {
            return reject(new ReviewFailure('session_missing', '이어갈 Claude 세션을 찾지 못했습니다'))
          }
```

`src/review/jobs.ts`(Task 4에서 다시 쓴다):

```ts
import { buildReviewPrompt, buildSystemPrompt } from './prompt.js'
import { ReviewFailure, type FailureKind, type ProviderId, type ReviewContext, type ReviewProvider, type ReviewRequest, type ReviewResult } from './types.js'
```

```ts
export type RunFn = (provider: ReviewProvider, ctx: ReviewContext, request: ReviewRequest, options: RunOptions) => Promise<ReviewResult>
```

```ts
    const request: ReviewRequest = { prompt: buildReviewPrompt(ctx), systemPrompt: buildSystemPrompt(ctx), session: { id: randomUUID(), resume: false } }
    this.run(provider, ctx, request, { signal: job.controller.signal, onProgress: (text) => emit({ type: 'progress', text }) })
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모두 PASS

- [ ] **Step 5: Commit**

```bash
git add src/review src/server.review.test.ts
git commit -m "feat: AI 리뷰 실행에 Claude 세션 ID와 system prompt 전달, 세션 없음 오류 구분"
```

---

### Task 4: 대화 저장, 세션 이어가기, 리뷰 API

**Files:**
- Modify: `src/review/store.ts`, `src/review/jobs.ts`, `src/review/types.ts`(`ReviewContext.instruction` 삭제), `src/server.ts:416-505`
- Test: `src/review/store.test.ts`, `src/review/jobs.test.ts`, `src/server.review.test.ts`

**Interfaces:**
- Consumes: `ReviewRequest`, `RunFn`, `buildSystemPrompt`, `buildReviewPrompt`, `ReviewFailure('session_missing')`(Task 2, 3)
- Produces:
  - `type MessageKind = 'question' | 'review'`
  - `interface ReviewMessage { id: string; createdAt: number; kind: MessageKind; question: string | null; fingerprint: string; excluded?: string[]; result: ReviewResult }`
  - `interface ReviewConversation { version: 2; key: string; provider: ProviderId; providerLabel: string; sessionId: string | null; messages: ReviewMessage[] }`
  - `ReviewStore.load(repo, key): ReviewConversation | null`
  - `ReviewStore.append(repo, key, input: { provider: ProviderId; providerLabel: string; sessionId: string; message: ReviewMessage }): ReviewConversation`
  - `ReviewStore.removeMessage(repo, key, messageId): boolean`
  - `ReviewStore.clear(repo, key): void`
  - `ReviewStore.save`, `ReviewRecord` 삭제
  - `StartInput = { provider; ctx; key; fingerprint; kind: MessageKind; question: string | null; excluded?: string[] }`
  - `JobEvent`의 done: `{ type: 'done'; message: ReviewMessage }`
  - `runningFor(repo, key): { id; provider; startedAt; kind: MessageKind; question: string | null } | null`
  - API 응답: `GET /api/review` → `{ key, sessionId, messages: (ReviewMessage & { stale: boolean })[], running }`
  - `POST /api/review` body: `{ provider, mode, source, target, iid, kind, question, exclude }`
  - `DELETE /api/review/messages/:messageId?<비교 조합>` → `{ ok: true }` 또는 404 `{ error: 'not_found' }`
  - `DELETE /api/review/conversation?<비교 조합>` → `{ ok: true }` 또는 409 `{ error: 'running' }`

- [ ] **Step 1: store 테스트 작성**

`src/review/store.test.ts` 전체를 아래로 바꾼다.

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewStore, type ReviewMessage } from './store'

const key = 'branch:origin/main...feature/x'
const sha1 = (v: string) => createHash('sha1').update(v).digest('hex')

const message = (id: string, overrides: Partial<ReviewMessage> = {}): ReviewMessage => ({
  id,
  createdAt: 1,
  kind: 'question',
  question: '질문',
  fingerprint: 'a:b',
  result: { answer: '답변', locations: [] },
  ...overrides,
})

const appendInput = (m: ReviewMessage, sessionId = 's-1') => ({ provider: 'claude' as const, providerLabel: 'Claude Code', sessionId, message: m })

function writeLegacy(dir: string, repo: string, record: unknown) {
  mkdirSync(join(dir, sha1(repo)), { recursive: true })
  writeFileSync(join(dir, sha1(repo), `${sha1(key)}.json`), JSON.stringify(record))
}

const legacy = {
  provider: 'claude',
  providerLabel: 'Claude Code',
  createdAt: 5,
  key,
  fingerprint: 'a:b',
  result: { summary: '이전 요약', findings: [{ severity: 'major', file: 'a.ts', line: 3, side: 'new', title: 't', body: 'b' }] },
  excluded: ['x.ts'],
}

describe('ReviewStore', () => {
  it('appends messages per repo and key and keeps the latest session id', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    expect(store.load('/repo', key)).toBeNull()
    store.append('/repo', key, appendInput(message('m1'), 's-1'))
    store.append('/repo', key, appendInput(message('m2'), 's-2'))
    const loaded = store.load('/repo', key)!
    expect(loaded).toMatchObject({ version: 2, key, provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-2' })
    expect(loaded.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(store.load('/other', key)).toBeNull()
  })

  it('append reads the file again so a removed message stays removed', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', key, appendInput(message('m1')))
    store.append('/repo', key, appendInput(message('m2')))
    expect(store.removeMessage('/repo', key, 'm1')).toBe(true)
    store.append('/repo', key, appendInput(message('m3')))
    expect(store.load('/repo', key)!.messages.map((m) => m.id)).toEqual(['m2', 'm3'])
  })

  it('removes a message but keeps the session', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', key, appendInput(message('m1')))
    expect(store.removeMessage('/repo', key, 'nope')).toBe(false)
    expect(store.removeMessage('/repo', key, 'm1')).toBe(true)
    expect(store.load('/repo', key)).toMatchObject({ sessionId: 's-1', messages: [] })
    expect(store.removeMessage('/other', key, 'm1')).toBe(false)
  })

  it('clears the conversation', () => {
    const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
    store.append('/repo', key, appendInput(message('m1')))
    store.clear('/repo', key)
    expect(store.load('/repo', key)).toBeNull()
    expect(() => store.clear('/repo', key)).not.toThrow()
  })

  it('converts a legacy review record into one review message without a session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', legacy)
    const loaded = new ReviewStore(dir).load('/repo', key)!
    expect(loaded).toMatchObject({ version: 2, key, provider: 'claude', sessionId: null })
    expect(loaded.messages).toHaveLength(1)
    expect(loaded.messages[0]).toMatchObject({
      createdAt: 5,
      kind: 'review',
      question: null,
      fingerprint: 'a:b',
      excluded: ['x.ts'],
      result: { answer: '이전 요약', locations: [{ file: 'a.ts', line: 3, side: 'new', title: 't', body: 'b' }] },
    })
    expect(loaded.messages[0].result.locations[0]).not.toHaveProperty('severity')
  })

  it('converts a legacy record with an instruction into a question message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', { ...legacy, instruction: '성능 위주로' })
    expect(new ReviewStore(dir).load('/repo', key)!.messages[0]).toMatchObject({ kind: 'question', question: '성능 위주로' })
  })

  it('gives a legacy message a stable id so it can be removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', legacy)
    const store = new ReviewStore(dir)
    const id = store.load('/repo', key)!.messages[0].id
    expect(store.load('/repo', key)!.messages[0].id).toBe(id)
    expect(store.removeMessage('/repo', key, id)).toBe(true)
    expect(store.load('/repo', key)).toMatchObject({ version: 2, messages: [] })
  })

  it('returns null for an unreadable file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-reviews-'))
    writeLegacy(dir, '/repo', { something: 'else' })
    expect(new ReviewStore(dir).load('/repo', key)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/review/store.test.ts`
Expected: FAIL (`store.append is not a function`)

- [ ] **Step 3: store 구현**

`src/review/store.ts` 전체를 아래로 바꾼다.

```ts
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderId, ReviewLocation, ReviewResult } from './types.js'

export type MessageKind = 'question' | 'review'

export interface ReviewMessage {
  id: string
  createdAt: number
  kind: MessageKind
  question: string | null
  fingerprint: string
  excluded?: string[]
  result: ReviewResult
}

export interface ReviewConversation {
  version: 2
  key: string
  provider: ProviderId
  providerLabel: string
  sessionId: string | null
  messages: ReviewMessage[]
}

export interface AppendInput {
  provider: ProviderId
  providerLabel: string
  sessionId: string
  message: ReviewMessage
}

interface LegacyRecord {
  provider: ProviderId
  providerLabel: string
  createdAt: number
  key: string
  fingerprint: string
  result: { summary: string; findings: (ReviewLocation & { severity?: string })[] }
  excluded?: string[]
  instruction?: string
}

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex')

function isLegacy(value: unknown): value is LegacyRecord {
  const result = (value as { result?: { summary?: unknown; findings?: unknown } } | null)?.result
  return typeof result?.summary === 'string' && Array.isArray(result.findings)
}

function fromLegacy(r: LegacyRecord): ReviewConversation {
  return {
    version: 2,
    key: r.key,
    provider: r.provider,
    providerLabel: r.providerLabel,
    sessionId: null,
    messages: [{
      id: `legacy-${r.createdAt}`,
      createdAt: r.createdAt,
      kind: r.instruction ? 'question' : 'review',
      question: r.instruction ?? null,
      fingerprint: r.fingerprint,
      ...(r.excluded && r.excluded.length > 0 ? { excluded: r.excluded } : {}),
      result: {
        answer: r.result.summary,
        locations: r.result.findings.map(({ file, line, side, title, body }) => ({ file, line, side, title, body })),
      },
    }],
  }
}

export class ReviewStore {
  constructor(private baseDir = join(homedir(), '.config', 'diffx', 'reviews')) {}

  private file(repoPath: string, key: string): string {
    return join(this.baseDir, sha1(repoPath), `${sha1(key)}.json`)
  }

  private write(repoPath: string, conversation: ReviewConversation): void {
    const path = this.file(repoPath, conversation.key)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(conversation, null, 2))
  }

  load(repoPath: string, key: string): ReviewConversation | null {
    let data: unknown
    try {
      data = JSON.parse(readFileSync(this.file(repoPath, key), 'utf-8'))
    } catch {
      return null
    }
    if ((data as { version?: unknown } | null)?.version === 2) return data as ReviewConversation
    if (isLegacy(data)) return fromLegacy(data)
    return null
  }

  append(repoPath: string, key: string, { provider, providerLabel, sessionId, message }: AppendInput): ReviewConversation {
    const current = this.load(repoPath, key)
    const next: ReviewConversation = { version: 2, key, provider, providerLabel, sessionId, messages: [...(current?.messages ?? []), message] }
    this.write(repoPath, next)
    return next
  }

  removeMessage(repoPath: string, key: string, messageId: string): boolean {
    const current = this.load(repoPath, key)
    if (!current) return false
    const messages = current.messages.filter((m) => m.id !== messageId)
    if (messages.length === current.messages.length) return false
    this.write(repoPath, { ...current, messages })
    return true
  }

  clear(repoPath: string, key: string): void {
    rmSync(this.file(repoPath, key), { force: true })
  }
}
```

- [ ] **Step 4: store 테스트 통과 확인**

Run: `pnpm test src/review/store.test.ts`
Expected: PASS

- [ ] **Step 5: jobs 테스트 작성**

`src/review/jobs.test.ts` 전체를 아래로 바꾼다.

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReviewJobs, type JobEvent, type RunFn, type StartInput } from './jobs'
import { ReviewStore } from './store'
import { ReviewFailure, type ReviewContext, type ReviewRequest } from './types'
import { claudeProvider } from './providers/claude'
import { STOP_IMMEDIATELY } from './runner'

const ctx: ReviewContext = { repoPath: '/repo', mode: 'branch', source: 'feature/x', target: 'main', mergeBase: 'abc123', sourceCheckedOut: true, files: ['a.ts'], patch: '+x' }
const newStore = () => new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
const tick = () => new Promise((r) => setTimeout(r, 0))

function deferredRun() {
  const calls: { request: ReviewRequest; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal; onProgress?: (t: string) => void }[] = []
  const run: RunFn = (_p, _c, request, options) => new Promise((resolve, reject) => {
    calls.push({ request, resolve: resolve as (v: unknown) => void, reject, signal: options.signal, onProgress: options.onProgress })
    options.signal?.addEventListener('abort', () => reject(new ReviewFailure('cancelled', '리뷰를 취소했습니다')))
  })
  return { run, calls }
}

const review: StartInput = { provider: claudeProvider, ctx, key: 'k', fingerprint: 'fp', kind: 'review', question: null, excluded: ['b.ts'] }
const ask: StartInput = { provider: claudeProvider, ctx, key: 'k', fingerprint: 'fp', kind: 'question', question: '이 변경 설명해줘' }
const result = { answer: 's', locations: [] }

describe('ReviewJobs', () => {
  it('starts a new session with the review prompt and saves the message with the session id', async () => {
    const store = newStore()
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(review)
    expect(calls[0].request.session.resume).toBe(false)
    expect(calls[0].request.prompt).toContain('아래 변경사항을 리뷰하세요')
    expect(calls[0].request.systemPrompt).toContain('파일을 수정하지 마세요')
    calls[0].onProgress!('a.ts 읽는 중')
    calls[0].resolve(result)
    await tick()

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events[0]).toEqual({ type: 'progress', text: 'a.ts 읽는 중' })
    expect(events[1]).toMatchObject({ type: 'done', message: { kind: 'review', question: null, fingerprint: 'fp', excluded: ['b.ts'], result } })
    const saved = store.load('/repo', 'k')!
    expect(saved.sessionId).toBe(calls[0].request.session.id)
    expect(saved.messages).toHaveLength(1)
    expect(jobs.runningFor('/repo', 'k')).toBeNull()
  })

  it('sends only the question and resumes the saved session', async () => {
    const store = newStore()
    store.append('/repo', 'k', { provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-1', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'fp', result } })
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    jobs.start({ ...ask, excluded: ['b.ts'] })
    expect(calls[0].request).toMatchObject({ prompt: '이 변경 설명해줘', session: { id: 's-1', resume: true } })
    calls[0].resolve(result)
    await tick()
    const saved = store.load('/repo', 'k')!
    expect(saved.sessionId).toBe('s-1')
    expect(saved.messages[1]).toMatchObject({ kind: 'question', question: '이 변경 설명해줘' })
    expect(saved.messages[1]).not.toHaveProperty('excluded')
  })

  it('retries once with a new session when the saved session is missing', async () => {
    const store = newStore()
    store.append('/repo', 'k', { provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-old', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'fp', result } })
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    jobs.start(ask)
    calls[0].reject(new ReviewFailure('session_missing', '이어갈 Claude 세션을 찾지 못했습니다'))
    await tick()
    expect(calls).toHaveLength(2)
    expect(calls[1].request.session.resume).toBe(false)
    expect(calls[1].request.session.id).not.toBe('s-old')
    expect(calls[1].request.prompt).toBe('이 변경 설명해줘')
    calls[1].resolve(result)
    await tick()
    expect(store.load('/repo', 'k')!.sessionId).toBe(calls[1].request.session.id)
  })

  it('does not retry after cancel', async () => {
    const store = newStore()
    store.append('/repo', 'k', { provider: 'claude', providerLabel: 'Claude Code', sessionId: 's-old', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'fp', result } })
    const calls: { reject: (e: unknown) => void }[] = []
    const run: RunFn = () => new Promise((_resolve, reject) => {
      calls.push({ reject })
    })
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(ask)
    jobs.cancel(id)
    calls[0].reject(new ReviewFailure('session_missing', 'x'))
    await tick()
    expect(calls).toHaveLength(1)
  })

  it('does not save a failed or cancelled question', async () => {
    const store = newStore()
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(ask)
    calls[0].reject(new ReviewFailure('process', 'boom'))
    await tick()
    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events).toEqual([{ type: 'error', kind: 'process', message: 'boom', rawOutput: undefined }])
    const b = jobs.start(ask)
    jobs.cancel(b)
    await tick()
    expect(store.load('/repo', 'k')).toBeNull()
  })

  it('returns the same job for a duplicate start while running and reports its question', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(ask)
    const b = jobs.start(review)
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
    expect(jobs.runningFor('/repo', 'k')).toMatchObject({ id: a, provider: 'claude', kind: 'question', question: '이 변경 설명해줘' })
  })

  it('cancels one job or all jobs', async () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    jobs.start({ ...review, key: 'other' })
    const events: JobEvent[] = []
    jobs.subscribe(a, (e) => events.push(e))
    expect(jobs.cancel(a)).toBe(true)
    await tick()
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'cancelled' })
    jobs.cancelAll()
    expect(calls.every((c) => c.signal?.aborted)).toBe(true)
    expect(jobs.cancel('unknown')).toBe(false)
  })

  it('stops immediately only when cancelAll is called with immediate', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    jobs.start({ ...review, key: 'other' })
    jobs.cancel(a)
    expect(calls[0].signal?.reason).not.toBe(STOP_IMMEDIATELY)
    jobs.cancelAll({ immediate: true })
    expect(calls[1].signal?.reason).toBe(STOP_IMMEDIATELY)
  })

  it('starts separate jobs for the same key in different repos', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    const b = jobs.start({ ...review, ctx: { ...ctx, repoPath: '/other' } })
    expect(a).not.toBe(b)
    expect(calls).toHaveLength(2)
    expect(jobs.runningFor('/other', 'k')?.id).toBe(b)
  })

  it('emits exactly one terminal event even when a listener throws', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const id = jobs.start(review)
    jobs.subscribe(id, () => {
      throw new Error('listener')
    })
    calls[0].resolve(result)
    await new Promise((r) => setTimeout(r, 10))
    process.off('unhandledRejection', onUnhandled)

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['done'])
    expect(unhandled).toEqual([])
  })

  it('reports a save failure as a single process error', async () => {
    const store = newStore()
    store.append = () => {
      throw new Error('disk full')
    }
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(store, run)
    const id = jobs.start(review)
    calls[0].resolve(result)
    await tick()

    const events: JobEvent[] = []
    jobs.subscribe(id, (e) => events.push(e))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', kind: 'process', message: 'disk full' })
    expect(jobs.runningFor('/repo', 'k')).toBeNull()
  })

  it('starts a new job when the same key is started right after cancel', () => {
    const { run, calls } = deferredRun()
    const jobs = new ReviewJobs(newStore(), run)
    const a = jobs.start(review)
    jobs.cancel(a)
    expect(jobs.runningFor('/repo', 'k')).toBeNull()
    const b = jobs.start(review)
    expect(b).not.toBe(a)
    expect(calls).toHaveLength(2)
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm test src/review/jobs.test.ts`
Expected: FAIL (`kind`, `message`, `resume` 관련 기대값 불일치)

- [ ] **Step 7: jobs 구현**

`src/review/types.ts`의 `ReviewContext`에서 `instruction?: string`을 지운다.

`src/review/jobs.ts`의 import부터 `start` 메서드 끝까지를 아래로 바꾼다. `isActive` 아래 메서드 중 `runningFor`만 바꾸고 `subscribe`, `listenerCount`, `cancel`, `cancelAll`은 그대로 둔다.

```ts
import { randomUUID } from 'node:crypto'
import { buildReviewPrompt, buildSystemPrompt } from './prompt.js'
import { runReview, STOP_IMMEDIATELY, type RunOptions } from './runner.js'
import type { MessageKind, ReviewMessage, ReviewStore } from './store.js'
import { ReviewFailure, type FailureKind, type ProviderId, type ReviewContext, type ReviewProvider, type ReviewRequest, type ReviewResult, type ReviewSession } from './types.js'

export type JobEvent =
  | { type: 'progress'; text: string }
  | { type: 'done'; message: ReviewMessage }
  | { type: 'error'; kind: FailureKind; message: string; rawOutput?: string }

export interface StartInput {
  provider: ReviewProvider
  ctx: ReviewContext
  key: string
  fingerprint: string
  kind: MessageKind
  question: string | null
  excluded?: string[]
}

export type RunFn = (provider: ReviewProvider, ctx: ReviewContext, request: ReviewRequest, options: RunOptions) => Promise<ReviewResult>

interface Job {
  id: string
  repoPath: string
  key: string
  provider: ProviderId
  kind: MessageKind
  question: string | null
  startedAt: number
  events: JobEvent[]
  listeners: Set<(e: JobEvent) => void>
  controller: AbortController
  finished: boolean
  aborted: boolean
}

export class ReviewJobs {
  private jobs = new Map<string, Job>()

  constructor(private store: ReviewStore, private run: RunFn = runReview) {}

  start({ provider, ctx, key, fingerprint, kind, question, excluded }: StartInput): string {
    const existing = [...this.jobs.values()].find((j) => this.isActive(j) && j.repoPath === ctx.repoPath && j.key === key && j.provider === provider.id)
    if (existing) return existing.id

    const job: Job = {
      id: randomUUID(),
      repoPath: ctx.repoPath,
      key,
      provider: provider.id,
      kind,
      question: kind === 'question' ? question : null,
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
      finished: false,
      aborted: false,
    }
    this.jobs.set(job.id, job)

    const emit = (e: JobEvent) => {
      job.events.push(e)
      for (const l of job.listeners) {
        try {
          l(e)
        } catch {
        }
      }
    }
    const finish = (e: JobEvent) => {
      if (job.finished) return
      job.finished = true
      emit(e)
    }
    const fail = (err: unknown) => {
      if (err instanceof ReviewFailure) finish({ type: 'error', kind: err.kind, message: err.message, rawOutput: err.rawOutput })
      else finish({ type: 'error', kind: 'process', message: String((err as Error)?.message ?? err) })
    }

    const prompt = kind === 'review' ? buildReviewPrompt(ctx) : job.question ?? ''
    const systemPrompt = buildSystemPrompt(ctx)
    const runWith = (session: ReviewSession) =>
      this.run(provider, ctx, { prompt, systemPrompt, session }, { signal: job.controller.signal, onProgress: (text) => emit({ type: 'progress', text }) })
        .then((result) => ({ result, sessionId: session.id }))
    const newSession = (): ReviewSession => ({ id: randomUUID(), resume: false })

    let savedSessionId: string | null = null
    try {
      savedSessionId = this.store.load(ctx.repoPath, key)?.sessionId ?? null
    } catch {
    }

    runWith(savedSessionId ? { id: savedSessionId, resume: true } : newSession())
      .catch((err) => {
        if (err instanceof ReviewFailure && err.kind === 'session_missing' && !job.aborted) return runWith(newSession())
        throw err
      })
      .then(({ result, sessionId }) => {
        const message: ReviewMessage = {
          id: randomUUID(),
          createdAt: Date.now(),
          kind,
          question: job.question,
          fingerprint,
          ...(kind === 'review' && excluded && excluded.length > 0 ? { excluded } : {}),
          result,
        }
        try {
          this.store.append(ctx.repoPath, key, { provider: provider.id, providerLabel: provider.label, sessionId, message })
        } catch (err) {
          return fail(err)
        }
        finish({ type: 'done', message })
      }, fail)

    return job.id
  }

  private isActive(job: Job): boolean {
    return !job.finished && !job.aborted
  }

  runningFor(repoPath: string, key: string): { id: string; provider: ProviderId; startedAt: number; kind: MessageKind; question: string | null } | null {
    const job = [...this.jobs.values()].find((j) => this.isActive(j) && j.repoPath === repoPath && j.key === key)
    return job ? { id: job.id, provider: job.provider, startedAt: job.startedAt, kind: job.kind, question: job.question } : null
  }
```

`STOP_IMMEDIATELY` import는 `cancelAll`이 쓰므로 그대로 둔다.

- [ ] **Step 8: jobs 테스트 통과 확인**

Run: `pnpm test src/review`
Expected: PASS

- [ ] **Step 9: 서버 테스트 작성**

`src/server.review.test.ts`를 바꾼다.

`postReview` 헬퍼의 기본 body에 `kind: 'review'`를 넣는다.

```ts
    body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main', kind: 'review', ...overrides }),
```

파일 안에서 `app.request('/api/review', { method: 'POST', ... body: JSON.stringify({ provider: 'claude', mode: 'branch', source: 'feature/x', target: 'main' }) })`로 직접 POST하는 곳(`runs a review...`, `reports a running review...`)은 `postReview(app)`로 바꾼다. `aborts running jobs when the server closes`의 `fetch` body에는 `kind: 'review'`를 추가한다.

`runs a review, streams events, stores it and reports staleness` 테스트의 저장 확인 부분을 바꾼다.

```ts
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved).toMatchObject({ key: 'branch:main...feature/x', running: null, messages: [{ kind: 'review', question: null, stale: false, result: { answer: '요약' } }] })
    expect(typeof saved.sessionId).toBe('string')

    commit(repo, { 'a.txt': 'base\nfeature\nmore\n' }, 'more')
    const stale = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(stale.messages[0].stale).toBe(true)
```

`reports a running review for the key and cancels it`의 기대값:

```ts
    expect(saved.running).toMatchObject({ id, provider: 'claude', kind: 'review', question: null })
```

`removes excluded files ...` 테스트의 마지막 네 줄을 바꾼다.

```ts
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0].stale).toBe(false)
    expect(saved.messages[0].excluded).toEqual(['a.txt'])
    expect(store.load(repo, saved.key)?.messages[0].excluded).toEqual(['a.txt'])
```

instruction 테스트 세 개(`passes the trimmed instruction...`, `omits a blank instruction`, `rejects an instruction longer than 2000 characters`)를 지우고 아래 테스트를 추가한다.

```ts
  it('sends only the trimmed question, ignores exclude and stores the question', async () => {
    let received: { files: string[]; request: { prompt: string } } | undefined
    const { app, repo, store } = setup(async (_p, ctx, request) => {
      received = { files: ctx.files, request }
      return { answer: 's', locations: [] }
    })
    const { id } = await (await postReview(app, { kind: 'question', question: '  이 변경 설명해줘 ', exclude: ['a.txt'] })).json()
    await readSse(await app.request(`/api/review/${id}/events`))
    expect(received!.request.prompt).toBe('이 변경 설명해줘')
    expect(received!.files).toEqual(['a.txt'])
    const saved = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(saved.messages[0]).toMatchObject({ kind: 'question', question: '이 변경 설명해줘' })
    expect(saved.messages[0]).not.toHaveProperty('excluded')
    expect(store.load(repo, saved.key)?.messages).toHaveLength(1)
  })

  it('resumes the session for the next question', async () => {
    const sessions: { id: string; resume: boolean }[] = []
    const { app } = setup(async (_p, _c, request) => {
      sessions.push(request.session)
      return { answer: 's', locations: [] }
    })
    for (const body of [{}, { kind: 'question', question: '다음 질문' }]) {
      const { id } = await (await postReview(app, body)).json()
      await readSse(await app.request(`/api/review/${id}/events`))
    }
    expect(sessions[0].resume).toBe(false)
    expect(sessions[1]).toEqual({ id: sessions[0].id, resume: true })
  })

  it('rejects an empty or too long question and an unknown kind', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    const empty = await postReview(app, { kind: 'question', question: '   ' })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: 'empty_question', message: '질문을 입력해 주세요' })
    const long = await postReview(app, { kind: 'question', question: 'a'.repeat(2001) })
    expect(long.status).toBe(400)
    expect(await long.json()).toEqual({ error: 'question_too_long', message: '질문은 2000자까지 입력할 수 있습니다' })
    const unknown = await postReview(app, { kind: 'chat' })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'invalid_kind' })
  })

  it('removes one message', async () => {
    const { app } = setup(async () => ({ answer: 's', locations: [] }))
    for (let i = 0; i < 2; i++) {
      const { id } = await (await postReview(app)).json()
      await readSse(await app.request(`/api/review/${id}/events`))
    }
    const before = await (await app.request(`/api/review?${branchQuery}`)).json()
    const target = before.messages[0].id
    const res = await app.request(`/api/review/messages/${target}?${branchQuery}`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    const after = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(after.messages.map((m: { id: string }) => m.id)).toEqual([before.messages[1].id])
    expect(after.sessionId).toBe(before.sessionId)
    const missing = await app.request(`/api/review/messages/${target}?${branchQuery}`, { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })

  it('clears the conversation and starts a new session next time', async () => {
    const sessions: { id: string; resume: boolean }[] = []
    const { app } = setup(async (_p, _c, request) => {
      sessions.push(request.session)
      return { answer: 's', locations: [] }
    })
    const first = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${first.id}/events`))
    const res = await app.request(`/api/review/conversation?${branchQuery}`, { method: 'DELETE' })
    expect(await res.json()).toEqual({ ok: true })
    const cleared = await (await app.request(`/api/review?${branchQuery}`)).json()
    expect(cleared).toMatchObject({ sessionId: null, messages: [] })
    const second = await (await postReview(app)).json()
    await readSse(await app.request(`/api/review/${second.id}/events`))
    expect(sessions[1].resume).toBe(false)
    expect(sessions[1].id).not.toBe(sessions[0].id)
  })

  it('refuses to clear the conversation while a question is running', async () => {
    const { app, repo, store } = setup(() => new Promise(() => {}))
    store.append(repo, 'branch:main...feature/x', { provider: 'claude', providerLabel: 'Fake', sessionId: 's-1', message: { id: 'm1', createdAt: 1, kind: 'review', question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
    await postReview(app, { kind: 'question', question: '진행 중' })
    const res = await app.request(`/api/review/conversation?${branchQuery}`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'running' })
    expect(store.load(repo, 'branch:main...feature/x')?.messages).toHaveLength(1)
  })
```

- [ ] **Step 10: 실패 확인**

Run: `pnpm test src/server.review.test.ts`
Expected: FAIL (`messages`가 응답에 없다)

- [ ] **Step 11: 서버 구현**

`src/server.ts`의 `app.get('/api/review', ...)`부터 `app.delete('/api/review/:id', ...)`까지를 아래로 바꾼다. `/api/review/conversation`은 `/api/review/:id`보다 먼저 등록해야 한다.

```ts
  app.get('/api/review', async (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = await resolveFromRequest(c)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const conversation = reviewStore.load(repo, resolved.key)
    const current = fingerprint(resolved)
    return c.json({
      key: resolved.key,
      sessionId: conversation?.sessionId ?? null,
      messages: (conversation?.messages ?? []).map((m) => ({ ...m, stale: m.fingerprint !== current })),
      running: reviewJobs.runningFor(repo, resolved.key),
    })
  })

  app.post('/api/review', async (c) => {
    let body: { provider: string; mode?: string; source?: string; target?: string; iid?: unknown; exclude?: unknown; kind?: unknown; question?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    const provider = providers.find((p) => p.id === body.provider)
    if (!provider) return c.json({ error: 'unknown_provider' }, 400)
    if (body.kind !== 'question' && body.kind !== 'review') return c.json({ error: 'invalid_kind' }, 400)
    const kind = body.kind
    const question = kind === 'question' && typeof body.question === 'string' ? body.question.trim() : ''
    if (kind === 'question' && !question) {
      return c.json({ error: 'empty_question', message: '질문을 입력해 주세요' }, 400)
    }
    if (question.length > 2000) {
      return c.json({ error: 'question_too_long', message: '질문은 2000자까지 입력할 수 있습니다' }, 400)
    }
    let resolved: ResolvedComparison
    try {
      resolved = body.mode === 'mr'
        ? await mrComparisons.resolve(parseIid(body.iid), { refresh: false })
        : resolveComparison(repo, { mode: body.mode, source: body.source, target: body.target }, resolveOptions)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const exclude = kind === 'review' && Array.isArray(body.exclude) && body.exclude.every((p) => typeof p === 'string') ? (body.exclude as string[]) : []
    const patch = excludeFilesFromPatch(resolved.patch, exclude)
    const id = reviewJobs.start({
      provider,
      key: resolved.key,
      kind,
      question: kind === 'question' ? question : null,
      excluded: exclude,
      fingerprint: fingerprint(resolved),
      ctx: {
        repoPath: repo,
        mode: 'branch',
        source: resolved.source!,
        target: resolved.target!,
        mergeBase: resolved.mergeBase!,
        sourceCheckedOut: getHeadSha(repo) === resolved.sourceSha,
        files: parseFilePaths(patch),
        patch,
      },
    })
    return c.json({ id })
  })

  app.delete('/api/review/messages/:messageId', async (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = await resolveFromRequest(c)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    return reviewStore.removeMessage(repo, resolved.key, c.req.param('messageId'))
      ? c.json({ ok: true })
      : c.json({ error: 'not_found' }, 404)
  })

  app.delete('/api/review/conversation', async (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = await resolveFromRequest(c)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    if (reviewJobs.runningFor(repo, resolved.key)) return c.json({ error: 'running' }, 409)
    reviewStore.clear(repo, resolved.key)
    return c.json({ ok: true })
  })
```

`app.get('/api/review/:id/events', ...)`의 `done` 분기를 바꾼다.

```ts
            } else if (e.type === 'done') {
              finish('done', JSON.stringify(e.message))
```

`app.delete('/api/review/:id', ...)`는 그대로 두고 위 두 DELETE 라우트 뒤에 오게 한다.

- [ ] **Step 12: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm exec tsc --noEmit -p .`
Expected: 모두 PASS. `grep -rn "instruction" src/review src/server.ts`가 아무것도 출력하지 않는다.

- [ ] **Step 13: Commit**

```bash
git add src/review src/server.ts src/server.review.test.ts
git commit -m "feat: AI 리뷰 질문과 답변을 대화로 저장하고 Claude 세션을 이어가는 API 추가"
```

---

### Task 5: useReview 훅을 대화 상태로 바꾸기

**Files:**
- Modify: `src/ui/hooks/useReview.ts`
- Test: `src/ui/hooks/useReview.test.ts`

**Interfaces:**
- Consumes: Task 4 API 응답 형태
- Produces (`src/ui/hooks/useReview.ts`):
  - `type MessageKind = 'question' | 'review'`
  - `interface ReviewLocation { file: string; line: number | null; side: 'old' | 'new'; title: string; body: string }`
  - `interface ReviewMessage { id; createdAt; kind; question: string | null; fingerprint; excluded?: string[]; result: { answer: string; locations: ReviewLocation[] }; stale: boolean }`
  - `interface PendingQuestion { kind: MessageKind; question: string | null; excluded?: string[] }`
  - `ReviewState = { status: 'idle' } | { status: 'running'; pending; progress: string | null; startedAt: number } | { status: 'error'; pending: PendingQuestion; kind: string; message: string; rawOutput?: string }`
  - `questionToRefill(state: ReviewState, input: string): string | null`
  - `interface SavedConversation { key; sessionId: string | null; messages: ReviewMessage[]; running: { id; provider; startedAt; kind; question } | null }`
  - `appendMessage(saved: SavedConversation | undefined, message: Omit<ReviewMessage, 'stale'>): SavedConversation | undefined`
  - `useReview(params, key)` 반환: `{ providers, messages, state, ask(question: string), review(exclude: string[]), cancel(), removeMessage(id: string), newConversation() }`
  - `Finding`, `Severity`, `ReviewRecord` 삭제

- [ ] **Step 1: 실패하는 테스트 작성**

`src/ui/hooks/useReview.test.ts`의 import를 바꾸고 아래 테스트를 추가한다.

```ts
import { fetchProviders, savedReviewKey, questionToRefill, appendMessage, type ReviewState } from './useReview'
```

```ts
describe('questionToRefill', () => {
  const failed: ReviewState = { status: 'error', pending: { kind: 'question', question: '이 변경 설명해줘' }, kind: 'cancelled', message: '취소했습니다' }

  it('returns the failed question when the input is empty', () => {
    expect(questionToRefill(failed, '')).toBe('이 변경 설명해줘')
    expect(questionToRefill(failed, '  \n')).toBe('이 변경 설명해줘')
  })

  it('keeps a question typed while running', () => {
    expect(questionToRefill(failed, '새로 입력한 질문')).toBeNull()
  })

  it('does not refill a full review or other states', () => {
    expect(questionToRefill({ ...failed, pending: { kind: 'review', question: null } }, '')).toBeNull()
    expect(questionToRefill({ status: 'idle' }, '')).toBeNull()
    expect(questionToRefill({ status: 'running', pending: failed.pending, progress: null, startedAt: 0 }, '')).toBeNull()
  })
})

describe('appendMessage', () => {
  const message = { id: 'm2', createdAt: 2, kind: 'question' as const, question: 'q', fingerprint: 'f', result: { answer: 'a', locations: [] } }
  const saved = { key: 'k', sessionId: 's', messages: [{ ...message, id: 'm1', stale: true }], running: { id: 'job', provider: 'claude' as const, startedAt: 0, kind: 'question' as const, question: 'q' } }

  it('appends the finished message as not stale and clears running', () => {
    const next = appendMessage(saved, message)!
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(next.messages[1].stale).toBe(false)
    expect(next.running).toBeNull()
  })

  it('does not duplicate a message already fetched', () => {
    const once = appendMessage(saved, message)!
    expect(appendMessage(once, message)).toBe(once)
    expect(appendMessage(undefined, message)).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/ui/hooks/useReview.test.ts`
Expected: FAIL (`questionToRefill is not a function`)

- [ ] **Step 3: 구현**

`src/ui/hooks/useReview.ts` 전체를 아래로 바꾼다.

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export type ProviderId = 'claude'
export type MessageKind = 'question' | 'review'

export interface ReviewLocation {
  file: string
  line: number | null
  side: 'old' | 'new'
  title: string
  body: string
}

export interface ProviderInfo {
  id: ProviderId
  label: string
  installed: boolean
  version?: string
  verified: boolean
  installHint: string
  loginHint: string
}

export interface ReviewMessage {
  id: string
  createdAt: number
  kind: MessageKind
  question: string | null
  fingerprint: string
  excluded?: string[]
  result: { answer: string; locations: ReviewLocation[] }
  stale: boolean
}

export interface PendingQuestion {
  kind: MessageKind
  question: string | null
  excluded?: string[]
}

export type ReviewState =
  | { status: 'idle' }
  | { status: 'running'; pending: PendingQuestion; progress: string | null; startedAt: number }
  | { status: 'error'; pending: PendingQuestion; kind: string; message: string; rawOutput?: string }

export interface SavedConversation {
  key: string
  sessionId: string | null
  messages: ReviewMessage[]
  running: { id: string; provider: ProviderId; startedAt: number; kind: MessageKind; question: string | null } | null
}

export async function fetchProviders(fetchFn: typeof fetch = fetch): Promise<ProviderInfo[]> {
  const res = await fetchFn('/api/review/providers')
  if (!res.ok) return []
  return res.json()
}

export function savedReviewKey(key: string | null): [string, string | null] {
  return ['review', key]
}

export function questionToRefill(state: ReviewState, input: string): string | null {
  if (state.status !== 'error' || state.pending.kind !== 'question' || input.trim() !== '') return null
  return state.pending.question
}

export function appendMessage(saved: SavedConversation | undefined, message: Omit<ReviewMessage, 'stale'>): SavedConversation | undefined {
  if (!saved || saved.messages.some((m) => m.id === message.id)) return saved
  return { ...saved, messages: [...saved.messages, { ...message, stale: false }], running: null }
}

export function useReview(params: URLSearchParams | null, key: string | null) {
  const queryClient = useQueryClient()
  const query = params?.toString() ?? ''
  const [state, setState] = useState<ReviewState>({ status: 'idle' })
  const jobRef = useRef<{ id: string; source: EventSource } | null>(null)
  const startingRef = useRef(false)
  const keyRef = useRef(key)
  keyRef.current = key

  const { data: providers = [] } = useQuery({
    queryKey: ['review-providers'],
    queryFn: () => fetchProviders(),
    staleTime: 60_000,
  })

  const { data: saved, isFetching } = useQuery({
    queryKey: savedReviewKey(key),
    queryFn: async (): Promise<SavedConversation> => (await fetch(`/api/review?${query}`)).json(),
    enabled: key !== null && params !== null,
  })

  const detach = () => {
    jobRef.current?.source.close()
    jobRef.current = null
  }

  const attach = useCallback((id: string, startedAt: number, pending: PendingQuestion, fromSaved = false) => {
    detach()
    setState({ status: 'running', pending, progress: null, startedAt })
    const attachedKey = keyRef.current
    const source = new EventSource(`/api/review/${id}/events`)
    jobRef.current = { id, source }
    source.addEventListener('progress', (e) => {
      setState((prev) => (prev.status === 'running' ? { ...prev, progress: (e as MessageEvent).data } : prev))
    })
    source.addEventListener('done', (e) => {
      detach()
      queryClient.setQueryData<SavedConversation>(savedReviewKey(attachedKey), (prev) => appendMessage(prev, JSON.parse((e as MessageEvent).data)))
      setState({ status: 'idle' })
      queryClient.invalidateQueries({ queryKey: ['review'] })
    })
    source.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data
      detach()
      if (!data) {
        setState({ status: 'error', pending, kind: 'process', message: '서버와 연결이 끊겼습니다' })
        return
      }
      const err = JSON.parse(data)
      if (fromSaved && err.message === '리뷰 작업을 찾지 못했습니다') {
        setState({ status: 'idle' })
        queryClient.invalidateQueries({ queryKey: ['review'] })
        return
      }
      setState({ status: 'error', pending, kind: err.kind, message: err.kind === 'cancelled' ? '취소했습니다' : err.message, rawOutput: err.rawOutput })
    })
  }, [queryClient])

  useEffect(() => {
    detach()
    setState({ status: 'idle' })
  }, [key])

  useEffect(() => {
    if (!isFetching && saved?.running && saved.key === key && jobRef.current?.id !== saved.running.id) {
      const { id, startedAt, kind, question } = saved.running
      attach(id, startedAt, { kind, question }, true)
    }
  }, [saved, key, isFetching, attach])

  useEffect(() => detach, [])

  const send = useCallback(async (pending: PendingQuestion) => {
    if (!params || startingRef.current) return
    startingRef.current = true
    const startKey = keyRef.current
    const startedAt = Date.now()
    setState({ status: 'running', pending, progress: null, startedAt })
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude', ...Object.fromEntries(params), kind: pending.kind, question: pending.question ?? '', exclude: pending.excluded ?? [] }),
      })
      const body = await res.json()
      if (keyRef.current !== startKey) return
      if (!res.ok) {
        setState({ status: 'error', pending, kind: 'process', message: body.message ?? body.error ?? `HTTP ${res.status}` })
        return
      }
      attach(body.id, startedAt, pending)
    } catch {
      if (keyRef.current === startKey) {
        setState({ status: 'error', pending, kind: 'process', message: '요청을 보내지 못했습니다' })
      }
    } finally {
      startingRef.current = false
    }
  }, [params, attach])

  const ask = useCallback((question: string) => send({ kind: 'question', question }), [send])
  const review = useCallback((exclude: string[]) => send({ kind: 'review', question: null, excluded: exclude }), [send])

  const cancel = useCallback(async () => {
    const id = jobRef.current?.id
    if (!id) return
    try {
      await fetch(`/api/review/${id}`, { method: 'DELETE' })
    } catch {}
  }, [])

  const removeMessage = useCallback(async (id: string) => {
    try {
      await fetch(`/api/review/messages/${encodeURIComponent(id)}?${query}`, { method: 'DELETE' })
    } catch {}
    queryClient.invalidateQueries({ queryKey: ['review'] })
  }, [query, queryClient])

  const newConversation = useCallback(async () => {
    try {
      await fetch(`/api/review/conversation?${query}`, { method: 'DELETE' })
    } catch {}
    setState({ status: 'idle' })
    queryClient.invalidateQueries({ queryKey: ['review'] })
  }, [query, queryClient])

  return {
    providers,
    messages: saved?.key === key ? saved.messages : [],
    state,
    ask,
    review,
    cancel,
    removeMessage,
    newConversation,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test src/ui/hooks/useReview.test.ts`
Expected: PASS. 이 시점에 `pnpm exec tsc --noEmit -p .`는 `App.tsx`, `ReviewPanel.tsx`, `FindingItem.tsx`에서 오류가 난다. Task 7에서 고친다.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useReview.ts src/ui/hooks/useReview.test.ts
git commit -m "feat: useReview를 질문과 답변 목록과 진행 중 질문 상태로 바꾸기"
```

---

### Task 6: 답변 markdown 렌더링과 코드 블록 하이라이팅

**Files:**
- Create: `src/ui/markdownCode.ts`, `src/ui/components/AnswerMarkdown.tsx`
- Modify: `package.json`, `pnpm-lock.yaml`, `src/ui/styles/global.css`
- Test: `src/ui/markdownCode.test.ts`, `src/ui/components/AnswerMarkdown.test.ts`

**Interfaces:**
- Produces:
  - `codeLanguage(className: string | undefined): string | null`
  - `hastText(node: HastNode | undefined): string`
  - `type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }`
  - `AnswerMarkdown({ text }: { text: string }): JSX.Element`

- [ ] **Step 1: 의존성 추가**

```bash
pnpm add -D react-markdown@^10.1.0
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/ui/markdownCode.test.ts`(신규):

```ts
import { describe, it, expect } from 'vitest'
import { codeLanguage, hastText } from './markdownCode'

describe('codeLanguage', () => {
  it('reads the language from the code class name', () => {
    expect(codeLanguage('language-ts')).toBe('ts')
    expect(codeLanguage('foo language-TypeScript bar')).toBe('typescript')
    expect(codeLanguage('language-c++')).toBe('c++')
  })

  it('returns null without a language', () => {
    expect(codeLanguage(undefined)).toBeNull()
    expect(codeLanguage('')).toBeNull()
    expect(codeLanguage('hljs')).toBeNull()
  })
})

describe('hastText', () => {
  it('joins nested text values', () => {
    expect(hastText({ type: 'element', tagName: 'code', children: [{ type: 'text', value: 'a' }, { type: 'element', children: [{ type: 'text', value: 'b\n' }] }] })).toBe('ab\n')
    expect(hastText(undefined)).toBe('')
  })
})
```

`src/ui/components/AnswerMarkdown.test.ts`(신규). 서버 렌더링에서는 `useEffect`가 실행되지 않으므로 하이라이팅 전 상태를 확인한다.

```ts
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnswerMarkdown } from './AnswerMarkdown'

const render = (text: string) => renderToStaticMarkup(createElement(AnswerMarkdown, { text }))

describe('AnswerMarkdown', () => {
  it('renders markdown lists, emphasis and inline code', () => {
    const html = render('- **굵게** 항목\n- `code` 항목')
    expect(html).toContain('<li><strong>굵게</strong> 항목</li>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders a fenced block as plain code before it is highlighted', () => {
    const html = render('```ts\nconst a = 1 < 2\n```')
    expect(html).toContain('<pre class="answer-code"><code>const a = 1 &lt; 2</code></pre>')
  })

  it('renders a fenced block without a language as plain code', () => {
    expect(render('```\nplain\n```')).toContain('<pre class="answer-code"><code>plain</code></pre>')
  })

  it('does not render raw HTML', () => {
    const html = render('<img src=x onerror="alert(1)"> 본문')
    expect(html).not.toContain('<img')
    expect(html).toContain('본문')
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test src/ui/markdownCode.test.ts src/ui/components/AnswerMarkdown.test.ts`
Expected: FAIL (모듈이 없다)

- [ ] **Step 4: 구현**

`src/ui/markdownCode.ts`(신규):

```ts
export type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export function codeLanguage(className: string | undefined): string | null {
  const match = /(?:^|\s)language-(\S+)/.exec(className ?? '')
  return match ? match[1].toLowerCase() : null
}

export function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}
```

`src/ui/components/AnswerMarkdown.tsx`(신규):

```tsx
import { useEffect, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import { getSharedHighlighter } from '@pierre/diffs'
import { codeLanguage, hastText, type HastNode } from '../markdownCode'

const THEMES = { light: 'github-light', dark: 'github-dark' } as const

function PlainCode({ code }: { code: string }) {
  return <pre className="answer-code"><code>{code}</code></pre>
}

function HighlightedCode({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setHtml(null)
    getSharedHighlighter({ themes: [THEMES.light, THEMES.dark], langs: [lang] })
      .then((highlighter) => {
        if (!cancelled) setHtml(highlighter.codeToHtml(code, { lang, themes: THEMES, defaultColor: 'light' }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [code, lang])
  if (html === null) return <PlainCode code={code} />
  return <div className="answer-code-highlighted" dangerouslySetInnerHTML={{ __html: html }} />
}

const components: Components = {
  pre: ({ node }) => {
    const code = (node as unknown as HastNode | undefined)?.children?.[0]
    const text = hastText(code).replace(/\n$/, '')
    const className = code?.properties?.className
    const lang = codeLanguage(Array.isArray(className) ? className.join(' ') : undefined)
    return lang ? <HighlightedCode code={text} lang={lang} /> : <PlainCode code={text} />
  },
}

export function AnswerMarkdown({ text }: { text: string }) {
  return (
    <div className="answer-markdown">
      <Markdown components={components}>{text}</Markdown>
    </div>
  )
}
```

`src/ui/styles/global.css`의 `.review-panel-summary` 블록을 지우고 그 자리에 추가한다.

```css
.answer-markdown {
    line-height: 1.6;
    word-break: break-word;
}

.answer-markdown > :first-child {
    margin-top: 0;
}

.answer-markdown > :last-child {
    margin-bottom: 0;
}

.answer-markdown p,
.answer-markdown ul,
.answer-markdown ol {
    margin: 6px 0;
}

.answer-markdown ul,
.answer-markdown ol {
    padding-left: 20px;
}

.answer-markdown :not(pre) > code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
}

.answer-code,
.answer-code-highlighted pre {
    margin: 6px 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
}

.answer-code {
    background: var(--bg-secondary);
}

@media (prefers-color-scheme: dark) {
    .answer-code-highlighted .shiki,
    .answer-code-highlighted .shiki span {
        color: var(--shiki-dark) !important;
        background-color: var(--shiki-dark-bg) !important;
    }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test src/ui/markdownCode.test.ts src/ui/components/AnswerMarkdown.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/ui/markdownCode.ts src/ui/markdownCode.test.ts src/ui/components/AnswerMarkdown.tsx src/ui/components/AnswerMarkdown.test.ts src/ui/styles/global.css
git commit -m "feat: AI 리뷰 답변을 markdown으로 그리고 코드 블록을 shiki로 하이라이팅"
```

---

### Task 7: 대화형 리뷰 패널, 위치 카드, App 연결

**Files:**
- Create: `src/ui/components/LocationItem.tsx`
- Modify: `src/ui/components/ReviewPanel.tsx`, `src/ui/App.tsx:21,31-33,138-152,280-288,503-517`, `src/ui/styles/global.css`
- Delete: `src/ui/components/FindingItem.tsx`, `src/ui/reviewInstructionStorage.ts`, `src/ui/reviewInstructionStorage.test.ts`

**Interfaces:**
- Consumes: `useReview` 반환값, `ReviewMessage`, `ReviewLocation`, `ReviewState`, `PendingQuestion`, `questionToRefill`(Task 5), `AnswerMarkdown`(Task 6)
- Produces:
  - `LocationItem({ location, onOpen }: { location: ReviewLocation; onOpen: (l: ReviewLocation) => void })`
  - `ReviewPanel` props: `{ provider; messages: ReviewMessage[]; state: ReviewState; onAsk(question: string); onReview(); onCancel(); onRemove(id: string); onNewConversation(); onOpenLocation(l: ReviewLocation) }`

이 Task는 컴포넌트 렌더링 테스트가 없다. 순수 로직은 Task 5, 6에서 테스트했다. 타입 검사와 빌드로 확인하고 화면 동작은 Task 8에서 사용자가 앱에서 확인한다.

- [ ] **Step 1: LocationItem 작성**

`src/ui/components/LocationItem.tsx`(신규):

```tsx
import type { ReviewLocation } from '../hooks/useReview'

export function LocationItem({ location, onOpen }: { location: ReviewLocation; onOpen: (l: ReviewLocation) => void }) {
  return (
    <div className="location-item">
      <div className="location-section">
        <div className="location-label">파일 위치</div>
        <div className="location-file-row">
          <span className="location-path">
            {location.file}
            {location.line === null ? ' (파일 전체)' : `:${location.line}`}
          </span>
          <button className="btn btn-sm" onClick={() => onOpen(location)}>코드 보기</button>
        </div>
      </div>
      <div className="location-section">
        <div className="location-label">요약</div>
        <div className="location-title">{location.title}</div>
      </div>
      <div className="location-section">
        <div className="location-label">내용</div>
        <div className="location-body">{location.body}</div>
      </div>
    </div>
  )
}
```

`src/ui/components/FindingItem.tsx`를 지운다.

```bash
git rm -q src/ui/components/FindingItem.tsx
```

- [ ] **Step 2: ReviewPanel 작성**

`src/ui/components/ReviewPanel.tsx` 전체를 아래로 바꾼다.

```tsx
import { Fragment, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { questionToRefill, type MessageKind, type ProviderInfo, type ReviewLocation, type ReviewMessage, type ReviewState } from '../hooks/useReview'
import { AnswerMarkdown } from './AnswerMarkdown'
import { LocationItem } from './LocationItem'

interface ReviewPanelProps {
  provider: ProviderInfo | undefined
  messages: ReviewMessage[]
  state: ReviewState
  onAsk: (question: string) => void
  onReview: () => void
  onCancel: () => void
  onRemove: (id: string) => void
  onNewConversation: () => void
  onOpenLocation: (l: ReviewLocation) => void
}

function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (startedAt === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  if (startedAt === null) return ''
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(s / 60)}분 ${s % 60}초`
}

function errorText(state: Extract<ReviewState, { status: 'error' }>, provider: ProviderInfo | undefined) {
  if (state.kind === 'not_installed') return `${provider?.label ?? 'Claude Code'}가 설치돼 있지 않습니다`
  return state.message
}

function QuestionCard({ kind, question, excluded, onRemove }: { kind: MessageKind; question: string | null; excluded?: string[]; onRemove?: () => void }) {
  return (
    <div className="review-question">
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

function AnswerCard({ message, onOpenLocation }: { message: ReviewMessage; onOpenLocation: (l: ReviewLocation) => void }) {
  const { answer, locations } = message.result
  return (
    <div className="review-answer">
      <AnswerMarkdown text={answer} />
      {locations.length > 0 && (
        <>
          <div className="review-panel-count">관련 위치 {locations.length}건</div>
          {locations.map((l, i) => (
            <LocationItem key={`${l.file}:${l.line}:${i}`} location={l} onOpen={onOpenLocation} />
          ))}
        </>
      )}
      <div className="review-panel-meta">{new Date(message.createdAt).toLocaleString()}</div>
      {message.stale && <div className="review-panel-stale">이 답변 이후 코드가 바뀌었습니다</div>}
    </div>
  )
}

export function ReviewPanel(props: ReviewPanelProps) {
  const { provider, messages, state, onAsk, onReview, onCancel, onRemove, onNewConversation, onOpenLocation } = props
  const [input, setInput] = useState('')
  const inputRef = useRef(input)
  inputRef.current = input
  const listRef = useRef<HTMLDivElement>(null)
  const running = state.status === 'running'
  const elapsed = useElapsed(running ? state.startedAt : null)
  const installed = provider?.installed === true
  const canSend = installed && !running

  useEffect(() => {
    const text = questionToRefill(state, inputRef.current)
    if (text !== null) setInput(text)
  }, [state])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, state.status])

  const send = () => {
    const question = input.trim()
    if (!question || !canSend) return
    setInput('')
    onAsk(question)
  }

  const confirmNewConversation = () => {
    if (window.confirm('모든 질문과 답변을 지우고 새 대화를 시작할까요?')) onNewConversation()
  }

  const pending = state.status === 'idle' ? null : state.pending

  return (
    <div className="review-panel">
      <div className="review-panel-header">
        <span className="review-panel-title">AI 리뷰</span>
        <button className="btn btn-sm" onClick={confirmNewConversation} disabled={running || messages.length === 0}>새 대화</button>
      </div>

      <div className="review-panel-list" ref={listRef}>
        {messages.map((m) => (
          <Fragment key={m.id}>
            <QuestionCard kind={m.kind} question={m.question} excluded={m.excluded} onRemove={() => onRemove(m.id)} />
            <AnswerCard message={m} onOpenLocation={onOpenLocation} />
          </Fragment>
        ))}
        {pending && <QuestionCard kind={pending.kind} question={pending.question} excluded={pending.excluded} />}
        {state.status === 'running' && (
          <div className="review-panel-status">
            <div>{state.progress ?? '답변을 준비하는 중'}</div>
            <div className="review-panel-elapsed">경과 시간 {elapsed}</div>
          </div>
        )}
        {state.status === 'error' && (
          <div className="review-panel-error">
            <div>{errorText(state, provider)}</div>
            {state.rawOutput && <pre className="review-panel-raw">{state.rawOutput}</pre>}
          </div>
        )}
      </div>

      <div className="review-panel-composer">
        <textarea
          className="review-panel-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="질문을 입력하세요 (Cmd+Enter로 보내기)"
          rows={3}
          maxLength={2000}
          disabled={!installed}
        />
        {provider && !provider.installed && (
          <a className="review-panel-hint" href={provider.installHint} target="_blank" rel="noreferrer">
            {provider.label} 설치 방법 보기
          </a>
        )}
        <div className="review-panel-controls">
          <span className="review-panel-meta">
            {provider ? `${provider.label}${provider.installed ? '' : ' (설치 안 됨)'}` : 'Claude Code 확인 중'}
          </span>
          {running ? (
            <button className="btn btn-sm" onClick={onCancel}>취소</button>
          ) : (
            <div className="review-panel-actions">
              <button className="btn btn-sm" onClick={onReview} disabled={!canSend}>전체 리뷰</button>
              <button className="btn btn-primary btn-sm" onClick={send} disabled={!canSend || !input.trim()}>보내기</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: App 연결**

`src/ui/App.tsx`:

import를 바꾼다.

```ts
import { useReview, type ReviewLocation } from './hooks/useReview'
```

아래 import 줄을 지운다.

```ts
import { loadReviewInstruction, saveReviewInstruction } from './reviewInstructionStorage'
```

`const [reviewInstruction, setReviewInstruction] = useState('')`부터 `handleInstructionChange`의 `useCallback` 끝까지 지운다.

`handleFindingClick`을 바꾼다.

```ts
  const handleLocationClick = useCallback((l: ReviewLocation) => {
    handleFileClick(l.file)
    if (l.line !== null) {
      setHighlight({ file: l.file, side: l.side === 'old' ? 'deletions' : 'additions', line: l.line })
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlight(null), 2000)
    }
  }, [handleFileClick])
```

`<ReviewPanel ... />`를 바꾼다.

```tsx
              <ReviewPanel
                provider={claude}
                messages={review.messages}
                state={review.state}
                onAsk={review.ask}
                onReview={() => review.review(excludedInDiff)}
                onCancel={review.cancel}
                onRemove={review.removeMessage}
                onNewConversation={review.newConversation}
                onOpenLocation={handleLocationClick}
              />
```

사용하지 않게 된 파일을 지운다.

```bash
git rm -q src/ui/reviewInstructionStorage.ts src/ui/reviewInstructionStorage.test.ts
```

- [ ] **Step 4: CSS 바꾸기**

`src/ui/styles/global.css`:

`.review-aside-scroll`에서 `overflow-y: auto;`를 지운다.

```css
.review-aside-scroll {
    height: 100%;
}
```

`.review-panel`을 바꾼다.

```css
.review-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    box-sizing: border-box;
    padding: 12px;
    font-size: 13px;
}
```

`.review-panel-instruction`과 `.review-panel-instruction-used` 블록을 지우고 추가한다.

```css
.review-panel-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.review-panel-composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
}

.review-panel-input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    resize: vertical;
}

.review-panel-actions {
    display: flex;
    gap: 6px;
}

.review-question {
    position: relative;
    padding: 8px 28px 8px 10px;
    border-radius: 6px;
    background: var(--comment-bg);
    border: 1px solid var(--comment-border);
}

.review-question-text {
    white-space: pre-wrap;
    word-break: break-word;
}

.review-question-remove {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    padding: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
}

.review-question-remove:hover {
    color: var(--text);
    background: var(--bg-secondary);
}

.review-answer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
}
```

`.finding-item`부터 `.finding-body` 블록까지(`.finding-severity*` 포함) 지우고 추가한다.

```css
.location-item {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
}

.location-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
}

.location-section + .location-section {
    border-top: 1px solid var(--border);
}

.location-label {
    color: var(--text-secondary);
    font-size: 11px;
}

.location-file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.location-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    word-break: break-all;
}

.location-title {
    font-weight: 600;
}

.location-body {
    white-space: pre-wrap;
    line-height: 1.5;
    word-break: break-word;
}
```

- [ ] **Step 5: 남은 참조 확인, 타입 검사, 테스트, 빌드**

```bash
grep -rn "FindingItem\|handleFindingClick\|finding-\|severity\|reviewInstruction\|ReviewInstruction\|review-panel-summary\|review-panel-instruction" src/ui
pnpm exec tsc --noEmit -p .
pnpm test
pnpm run build:electron
```

Expected: `grep`은 아무것도 출력하지 않는다. 타입 오류 없음, 테스트 모두 PASS, 빌드 성공.

- [ ] **Step 6: Commit**

```bash
git add -A src/ui
git commit -m "feat: AI 리뷰 패널을 질문과 답변 대화 화면으로 바꾸고 위치 카드에 코드 보기 버튼 추가"
```

---

### Task 8: 앱에서 동작 확인

**Files:** 없음(확인만 한다)

사용자가 앱(`pnpm run dev:app`)을 직접 실행한다. 에이전트는 아래 목록을 사용자에게 전달하고 결과를 받는다. 문제가 나오면 systematic-debugging으로 원인을 찾은 뒤 해당 Task의 파일을 고친다.

- [ ] **Step 1: 사용자에게 확인 목록 전달**

1. 이전에 리뷰한 비교 조합을 열면 이전 리뷰가 "전체 리뷰" 질문 카드와 답변 카드 하나로 보인다. X 버튼 클릭 시 사라지고 앱을 다시 열어도 사라진 상태다.
2. textarea에 "이 변경 설명해줘"를 입력하고 Cmd+Enter를 누르면 textarea가 비워지고 질문 카드와 진행 문구, 경과 시간이 보인다. 답변은 리뷰 형식이 아니라 설명으로 온다.
3. 이어서 "방금 말한 파일에서 제일 중요한 줄은?"을 보내면 이전 답변 맥락을 이어서 답한다.
4. [전체 리뷰] 클릭 시 질문 카드에 "전체 리뷰"가 보이고 리뷰 형식 답변과 "관련 위치 N건" 위치 카드가 보인다. 파일을 제외한 상태면 "제외한 파일 N개를 빼고 리뷰"가 보인다.
5. 위치 카드의 텍스트를 드래그해 복사할 수 있고, [코드 보기] 클릭 시 해당 줄로 이동해 강조된다. line이 없는 위치는 "(파일 전체)"로 보인다.
6. 답변의 목록, 굵게, 인라인 코드가 서식대로 보이고 ` ```ts ` 코드 블록은 색이 입혀진다. 다크 모드에서도 코드 블록 색이 읽힌다.
7. 질문을 보낸 뒤 [취소] 클릭 시 "취소했습니다"가 보이고 textarea에 보냈던 문장이 다시 채워진다. 진행 중에 textarea에 새 문장을 입력했으면 그 문장이 유지된다.
8. 진행 중에 앱을 새로고침하면 진행 중인 질문 카드와 진행 문구가 다시 보인다.
9. [새 대화] 클릭 시 확인창이 뜨고, 확인하면 목록이 비워진다. 다음 질문은 이전 맥락을 모른다.
10. 소스 브랜치에 커밋을 추가하고 다시 열면 이전 답변 카드에 "이 답변 이후 코드가 바뀌었습니다"가 보인다.
11. 대화가 길어지면 목록만 스크롤되고 입력 영역은 패널 아래에 남아 있다. 새 질문과 답변이 추가되면 맨 아래로 스크롤된다.

- [ ] **Step 2: 결과 반영**

사용자가 알려준 문제를 고치고 `pnpm test && pnpm exec tsc --noEmit -p .`를 다시 실행한 뒤 커밋한다.
