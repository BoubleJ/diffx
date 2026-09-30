# AI 리뷰 패널 대화형 전환 설계

## 목적

AI 리뷰 패널을 한 번 리뷰하고 끝나는 화면에서 Claude Code 세션을 이어가며 질문하는 대화 화면으로 바꾼다. 지금은 다음 문제가 있다.

- 사용자가 입력한 문장이 "리뷰 방향"으로만 반영되어 단순 설명 요청에도 리뷰 형식으로 답한다. 프롬프트에 "시니어 코드 리뷰어" 역할과 MR 요약 지시가 항상 들어가기 때문이다.
- 저장 파일이 비교 조합(key)마다 레코드 하나라서 새 요청을 보내면 이전 답변이 사라진다.
- 지적 사항 카드 전체가 `<button>`이라 텍스트를 드래그해 복사할 수 없다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 대화 맥락 | Claude 세션을 이어간다. 첫 질문은 `--session-id`, 두 번째 질문부터 `--resume` |
| 버튼 | [전체 리뷰]와 [보내기]를 따로 둔다 |
| [전체 리뷰] | 기존 고정 리뷰 프롬프트(리뷰 지시, 변경 파일 목록, diff)를 보낸다 |
| [보내기] | textarea에 입력한 문장만 보낸다 |
| system prompt | 모든 요청에 기본 규칙 다섯 가지와 비교 정보 네 줄을 `--append-system-prompt`로 넣는다 |
| 응답 형식 | JSON 스키마를 유지한다. `answer`(markdown)와 `locations`. severity는 없앤다 |
| 삭제 | 질문마다 X 버튼. 화면과 저장 파일에서만 지우고 Claude 세션은 그대로 이어간다 |
| 새 대화 | 확인창 후 저장 파일을 지우고 다음 질문부터 새 세션으로 시작한다 |
| 답변 렌더링 | react-markdown. 코드 블록은 `@pierre/diffs`의 shiki highlighter로 하이라이팅 |
| 이전 형식 저장 파일 | 불러올 때 질문과 답변 하나로 바꾼다 |
| 실패나 취소 | 저장하지 않는다. [보내기]로 보낸 문장은 textarea에 다시 채운다 |

## 1. 요청 내용

### system prompt

모든 요청에 `--append-system-prompt`로 아래 내용을 넣는다. 첫 질문과 두 번째 이후 질문, [전체 리뷰]와 [보내기] 모두 같다.

비교 정보:

- 비교 대상: `<target>...<source>` (GitLab MR과 같은 방식)
- 소스 브랜치, 타겟 브랜치, merge-base 커밋
- 소스 브랜치 체크아웃 여부에 따른 파일 읽기 안내. 체크아웃되어 있지 않으면 `git show <source>:<경로>`로 읽으라고 안내한다(지금 `fileReadingGuide`와 같다)

기본 규칙 다섯 가지:

1. 파일을 수정하지 않는다.
2. 읽기와 git 조회 명령(`git show`, `git log`, `git diff`)만 쓴다.
3. 한국어로 답한다.
4. 답변에서 코드 위치를 언급하면 `locations`에 넣는다.
5. 질문에 맞는 형식으로 답하고 리뷰를 요청하지 않았으면 리뷰하지 않는다.

`answer`는 markdown으로 써도 된다고 안내한다. diff와 변경 파일 목록은 system prompt에 넣지 않는다.

### [보내기]

stdin으로 textarea에 입력한 문장(앞뒤 공백 제거)만 보낸다. 다른 내용을 붙이지 않는다.

### [전체 리뷰]

stdin으로 기존 `buildPrompt`의 리뷰 부분을 보낸다.

- 리뷰 지시: 버그, 보안 문제, 잘못된 동작, 누락된 예외 처리를 우선 찾는다. 취향 차이인 스타일 지적은 하지 않는다. `answer`에는 무엇을 바꿨고 머지 전에 확인할 점이 무엇인지 쓴다.
- 파일별 diff 확인 명령 `git diff <mergeBase> <source> -- <경로>`
- 변경 파일 목록
- diff. 20만 자를 넘으면 지금처럼 본문 대신 diff 확인 명령을 안내한다
- 제외한 파일은 지금처럼 patch와 파일 목록에서 뺀다

비교 정보와 기본 규칙은 system prompt에 있으므로 본문에서 뺀다. "시니어 코드 리뷰어" 역할 문장과 JSON 예시 블록도 뺀다. 형식은 `--json-schema`가 강제한다.

## 2. 응답 스키마

```ts
interface ReviewLocation {
  file: string          // 저장소 루트 기준 경로
  line: number | null   // null이면 파일 전체
  side: 'old' | 'new'
  title: string         // 요약
  body: string          // 내용
}

interface ReviewResult {
  answer: string        // markdown
  locations: ReviewLocation[]
}
```

- `summary`를 `answer`로, `findings`를 `locations`로 이름을 바꾸고 `severity`를 뺀다.
- `REVIEW_JSON_SCHEMA`, `validateResult`, `Finding`/`Severity` 타입을 이에 맞게 바꾼다.

## 3. Claude 실행

`src/review/providers/claude.ts`의 `buildCommand`:

- `--no-session-persistence`를 뺀다.
- 새 세션이면 `--session-id <uuid>`, 이어가면 `--resume <uuid>`를 넣는다.
- `--append-system-prompt <system prompt>`를 넣는다.
- 나머지 인자(`--restricted`, `--strict-mcp-config`, `--permission-mode dontAsk`, `--tools`, `--allowedTools`, `--disallowedTools`, `--json-schema`)는 그대로 둔다.

`buildCommand`가 세션 정보를 받도록 `ReviewContext` 또는 인자에 `session: { id: string; resume: boolean }`과 `systemPrompt`를 추가한다. 프롬프트 조립은 `runner.ts`가 아니라 호출하는 쪽(`jobs.ts`)이 정해서 넘긴다.

세션 이어가기 실패 처리:

- `--resume` 실행이 `No conversation found with session ID` 출력과 함께 실패하면 새 uuid로 `--session-id`를 넣어 한 번 다시 실행한다. 다시 실행할 때 stdin 본문은 같다.
- 이 실패는 `ReviewFailure`의 새 kind `session_missing`으로 구분한다.

세션이 저장되기 때문에 저장소 경로에서 `claude --resume`을 실행하면 목록에 이 세션들이 나타난다.

## 4. 저장

`src/review/store.ts`. 파일 경로 `~/.config/diffx/reviews/<sha1(repo)>/<sha1(key)>.json`은 그대로 둔다.

```ts
interface ReviewMessage {
  id: string
  createdAt: number
  kind: 'question' | 'review'
  question: string | null     // kind가 review면 null
  fingerprint: string
  excluded?: string[]         // kind가 review이고 제외한 파일이 있을 때만
  result: ReviewResult
}

interface ReviewConversation {
  version: 2
  key: string
  provider: ProviderId
  providerLabel: string
  sessionId: string | null
  messages: ReviewMessage[]
}
```

- `load(repo, key)`: 파일이 없으면 null. `version`이 없고 `result`가 있으면 이전 형식으로 보고 바꾼다.
  - `id`는 `legacy-<createdAt>`. 불러올 때마다 같은 id가 나와야 X 버튼으로 지울 수 있다
  - `kind`는 `instruction`이 있으면 `question`, 없으면 `review`. `question`은 `instruction` 값
  - `result.summary`를 `answer`로, `findings`에서 `severity`를 뺀 값을 `locations`로 옮긴다
  - `sessionId`는 null. 다음 질문은 새 세션으로 시작한다
  - 바꾼 내용은 다음 저장 때 새 형식으로 쓴다
- `append(repo, key, { provider, providerLabel, sessionId, message })`: 파일을 다시 읽어 `messages` 끝에 추가하고 `sessionId`를 갱신해 저장한다.
- `removeMessage(repo, key, messageId)`: 해당 질문과 답변을 지우고 저장한다. 없는 id면 false.
- `clear(repo, key)`: 파일을 지운다.

`jobs.ts`는 답변을 받았을 때만 `append`를 호출한다. 실패하거나 취소한 질문은 저장하지 않는다.

## 5. API

`src/server.ts`.

### `GET /api/review`

```json
{
  "key": "...",
  "sessionId": "..." ,
  "messages": [{ "...ReviewMessage": "", "stale": false }],
  "running": { "id": "...", "startedAt": 0, "kind": "question", "question": "..." }
}
```

- `stale`은 질문과 답변마다 `message.fingerprint !== 현재 fingerprint`로 계산한다.
- 진행 중인 작업이 없으면 `running`은 null. 새로고침 후에도 진행 중인 질문 카드를 다시 그리기 위해 `kind`와 `question`을 넣는다.

### `POST /api/review`

- body: `{ provider, mode, source, target, iid, kind, question, exclude }`
- `kind`가 `question`, `review`가 아니면 400 `{ error: 'invalid_kind' }`
- `kind`가 `question`이면 `question`이 비어 있을 때 400 `{ error: 'empty_question', message: '질문을 입력해 주세요' }`, 2000자를 넘으면 400 `{ error: 'question_too_long', message: '질문은 2000자까지 입력할 수 있습니다' }`
- `kind`가 `review`면 `question`을 무시하고 `exclude`를 적용한다. `kind`가 `question`이면 `exclude`를 무시한다
- 저장된 `sessionId`가 있으면 `--resume`, 없으면 새 uuid로 `--session-id`
- 같은 key에 진행 중인 작업이 있으면 지금처럼 그 작업 id를 돌려준다

### `DELETE /api/review/messages/:messageId`

- 비교 조합은 다른 API처럼 쿼리스트링으로 받는다.
- 해당 질문과 답변을 저장 파일에서 지운다. 없으면 404.

### `DELETE /api/review/conversation`

- 비교 조합은 쿼리스트링으로 받는다.
- 진행 중인 작업이 있으면 409 `{ error: 'running' }`. 없으면 저장 파일을 지운다.

### SSE `/api/review/:id/events`, `DELETE /api/review/:id`

그대로 둔다. `done` 이벤트의 data는 추가된 `ReviewMessage`다.

## 6. 화면

### 패널 구성 (`ReviewPanel.tsx`)

- 헤더: 제목 "AI 리뷰"와 [새 대화] 버튼. [새 대화] 클릭 시 확인창이 뜨고 확인 시 `DELETE /api/review/conversation`을 호출한다. 진행 중이거나 질문과 답변이 하나도 없으면 누를 수 없다.
- 대화 목록: 질문 카드와 답변 카드를 저장 순서대로 그린다. 목록 영역만 스크롤된다. 질문과 답변이 추가되거나 진행 중 질문 카드가 그려지면 맨 아래로 스크롤한다.
- 입력 영역: 패널 아래에 고정한다. textarea(최대 2000자) 아래에 [전체 리뷰]와 [보내기] 버튼을 둔다. 진행 중에는 두 버튼 대신 [취소] 버튼을 그린다. textarea는 진행 중에도 입력할 수 있다.
- textarea에서 Cmd+Enter 입력 시 [보내기]와 같게 동작한다.
- textarea가 비어 있으면 [보내기]를 누를 수 없다.
- Claude Code가 설치되지 않았으면 두 버튼을 누를 수 없고 설치 방법 링크를 그린다.
- 패널이 입력 영역을 아래에 고정하도록 `App.tsx`의 `.review-aside-scroll` 래퍼는 스크롤 대신 높이만 채우고, 스크롤은 대화 목록이 맡는다.

### 보내기와 실패, 취소

1. [보내기] 클릭 시 textarea가 비워지고 대화 목록 맨 아래에 질문 카드가 그려진다. 그 아래에 진행 문구와 경과 시간이 표시된다.
2. 답변을 받으면 질문 카드 아래에 답변 카드가 그려진다.
3. 요청 실패 또는 [취소] 클릭 시 진행 중이던 질문 카드 아래에 오류 문구(취소면 "취소했습니다")와 raw 출력이 그려진다. [보내기]로 보낸 질문이면 textarea가 비어 있을 때 보냈던 문장을 다시 채운다. 진행 중에 새로 입력한 문장이 있으면 덮어쓰지 않는다.
4. 실패하거나 취소한 질문 카드는 다른 질문을 보내거나 비교 조합이 바뀌면 사라진다.

### 질문 카드

- [보내기]로 보낸 질문은 입력한 문장을 그린다. [전체 리뷰]로 보낸 질문은 "전체 리뷰"를 그리고, 제외한 파일이 있으면 "제외한 파일 N개를 빼고 리뷰"를 함께 그린다.
- 오른쪽 위 X 버튼 클릭 시 확인창 없이 `DELETE /api/review/messages/:id`를 호출하고 응답 후 목록을 다시 불러온다.
- 진행 중인 질문 카드와 실패한 질문 카드에는 X 버튼을 그리지 않는다.

### 답변 카드

- 본문은 `AnswerMarkdown` 컴포넌트로 그린다.
- 카드 하단에 작성 시각을 작은 회색 글씨로 그린다. `stale`이면 "이 답변 이후 코드가 바뀌었습니다"를 그린다.
- `locations`가 1건 이상이면 "관련 위치 N건"과 위치 카드를 응답 순서대로 그린다. 0건이면 그리지 않는다.

### 위치 카드 (`FindingItem.tsx`를 `LocationItem.tsx`로 바꾼다)

- `<div>`로 그려서 텍스트를 드래그해 복사할 수 있다.
- 파일 위치, 요약, 내용 세 섹션으로 나눈다. 섹션 제목은 작은 회색 글씨로 그리고 섹션 사이에 구분선을 넣는다.
- 파일 위치 섹션: `path:line`과 [코드 보기] 버튼. line이 null이면 `path (파일 전체)`. [코드 보기] 클릭 시 지금 카드 클릭과 같게 `handleFindingClick`으로 해당 줄로 이동한다.
- severity 배지와 severity 정렬은 없앤다.

### 답변 markdown (`AnswerMarkdown.tsx`)

- `react-markdown`을 devDependencies에 추가한다(React 등 UI 의존성과 같은 위치). 기본 설정으로 쓰고 raw HTML은 그리지 않는다.
- 코드 블록의 `code` 컴포넌트를 바꿔서 언어가 지정된 블록을 `getSharedHighlighter`로 HTML을 만들어 `dangerouslySetInnerHTML`로 넣는다. shiki가 코드 텍스트를 이스케이프하므로 답변 안의 HTML은 실행되지 않는다.
- 테마는 diff 뷰어와 같은 테마를 쓴다.
- 언어 문법은 처음 쓸 때 비동기로 불러온다. 불러오는 동안과 언어가 없거나 shiki가 모르는 언어인 경우 색 없이 그린다.
- 인라인 코드는 하이라이팅하지 않는다.

### 상태 관리 (`useReview.ts`, `App.tsx`)

- `useReview`는 `messages`, `running`, `state`를 반환하고 `ask(question)`, `review(exclude)`, `cancel()`, `removeMessage(id)`, `newConversation()`을 제공한다. 삭제와 새 대화는 응답 후 `['review']` 쿼리를 다시 불러온다.
- 실패하거나 취소한 질문은 `state`에 `{ status: 'error', kind, message, rawOutput?, pending: { kind, question } }`처럼 담아서 질문 카드와 textarea 다시 채우기에 쓴다.
- `reviewInstructionStorage.ts`와 테스트를 지운다. textarea 입력은 보낼 때 비워지므로 localStorage에 남기지 않는다.
- severity 관련 타입과 CSS(`.finding-severity*`)를 지운다.

## 7. 테스트

vitest가 node 환경이라 컴포넌트 렌더링 테스트는 쓰지 않는다.

- `store.test.ts`: 이전 형식 파일 변환, `append`가 파일을 다시 읽어 추가하는지, `removeMessage`, `clear`
- `prompt.test.ts`: system prompt에 기본 규칙과 비교 정보가 들어가고 diff가 들어가지 않는지, [전체 리뷰] 본문에 diff와 파일 목록이 들어가는지, 큰 diff 처리
- `schema.test.ts`: 새 스키마 검증
- `providers/claude.test.ts`: 새 세션은 `--session-id`, 이어가면 `--resume`, `--append-system-prompt`가 들어가고 `--no-session-persistence`가 없는지
- `runner.test.ts`: `No conversation found` 출력 시 `session_missing`으로 실패하는지
- `jobs.test.ts`: 답변을 받았을 때만 저장하는지, `session_missing` 시 새 세션으로 한 번 다시 실행하는지
- `server.review.test.ts`: `GET`의 `messages`와 `stale`, `running`의 `kind`와 `question`, `POST`의 400 두 가지, 두 `DELETE` API와 404, 409
- `useReview.test.ts`: 순수 함수로 뺀 로직이 있으면 테스트한다

화면 동작은 사용자가 띄운 앱에서 확인한다.
