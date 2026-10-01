# AI 리뷰 대화 보존 기간과 대화 목록 설계

## 목적

AI 리뷰 대화 파일은 지금 사용자가 직접 지우지 않으면 계속 쌓인다. 설정한 일 수가 지난 대화를 자동으로 삭제하고, 저장소의 대화를 목록으로 보면서 대화별로 삭제하거나 그 비교 대상으로 이동할 수 있게 한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 보존 기간 설정 위치 | 툴바 톱니바퀴 설정 팝오버의 `AI 대화 보존 기간` input |
| 보존 기간 단위와 기본값 | 일 단위, 기본값 30일. 비우거나 0을 넣으면 삭제하지 않는다 |
| 보존 기간 기준 시점 | 그 대화의 마지막 질문 시각 |
| 보존 기간 적용 범위 | 모든 저장소의 대화 파일 |
| 대화 목록 위치 | 오른쪽 패널의 세 번째 탭 `대화 목록` |
| 대화 목록 범위 | 지금 연 저장소의 대화만 |
| 목록 줄 클릭 | 그 브랜치 비교나 MR로 화면을 바꾸고 `AI 리뷰` 탭을 연다 |
| AI 리뷰 탭 상단 버튼 | `새 대화`를 `대화 삭제`로 바꾼다. 동작은 같다 |

## 1. 보존 기간 설정

### 설정 값 (`src/settings.ts`)

- `Settings`에 `reviewRetentionDays: number | null`을 추가한다. `null`은 삭제하지 않음을 뜻한다.
- `DEFAULTS.reviewRetentionDays`는 30이다. 기존 `settings.json`에 이 값이 없으면 30이 적용된다.
- `pick()`은 1 이상의 정수와 `null`만 받는다. 0은 `null`로 바꿔 저장한다. 그 외 값(음수, 소수, 문자열)은 무시한다.

### 설정 UI (`Toolbar.tsx`)

```
┌─ 톱니바퀴 설정 ───────────────────┐
│ ☐ Soft wrap                       │
│ Default tab size        [4 ▾]     │
│ Terminal          [Terminal    ]  │
│ AI 대화 보존 기간   [ 30 ] 일      │
└───────────────────────────────────┘
```

- `Terminal` 항목 아래에 `AI 대화 보존 기간` 항목을 추가한다. `type="number"`, `min="1"`, `step="1"` input 오른쪽에 `일`을 붙인다.
- 값이 `null`이면 input을 비우고 placeholder `삭제 안 함`을 보여준다.
- input에서 포커스가 빠지거나(`blur`) Enter를 누를 때 저장한다. 입력 중 매 글자마다 저장하면 `3`을 거쳐 `30`을 입력하는 동안 3일 기준으로 대화가 삭제될 수 있다.
  - 비어 있거나 0이면 `null`로 저장한다.
  - 1 이상 정수이면 그 값으로 저장한다.
  - 그 외 값이면 저장하지 않고 input을 저장된 값으로 되돌린다.

### 정리 (`ReviewStore.prune`)

- `prune(retentionDays: number | null, now = Date.now()): number`를 추가한다. 지운 파일 수를 돌려준다.
- `retentionDays`가 `null`이면 아무것도 하지 않는다.
- `reviews` 폴더 아래 모든 저장소 폴더의 대화 파일을 읽는다.
  - 마지막 질문 시각은 `messages`의 `createdAt` 중 가장 큰 값이다. 이전 형식(legacy) 파일은 `fromLegacy` 변환 후의 값을 쓴다.
  - 메시지가 없거나 파일을 읽지 못하면 파일 수정 시각을 쓴다.
  - `now - 마지막 질문 시각`이 `retentionDays * 24시간`보다 크면 파일을 지운다.
- 저장소 폴더가 비면 폴더도 지운다.
- 정리는 두 시점에 실행한다.
  1. 저장소 서버가 시작될 때(`startServer`). 저장소 창을 열 때마다 실행된다.
  2. `PUT /api/settings` 요청 본문에 `reviewRetentionDays`가 있을 때. 저장 후 새 값으로 실행한다.
- 답변을 만드는 중인 대화도 기간이 지났으면 지운다. 답변이 끝나면 `append`가 그 답변 하나만 담은 새 파일을 만든다. 지워진 질문과 답변은 이미 보존 기간이 지난 것이다.

## 2. 대화 목록

### 서버

- `ReviewStore.list(repoPath): ConversationSummary[]`를 추가한다.
  - `ConversationSummary = { key: string; questionCount: number; lastAt: number }`
  - 저장소 폴더(`sha1(repoPath)`)의 대화 파일을 모두 읽는다. 읽지 못한 파일과 메시지가 없는 파일은 뺀다.
  - `questionCount`는 `messages.length`, `lastAt`은 마지막 질문 시각이다.
  - `lastAt`이 큰 순서로 정렬한다.
- `GET /api/review/conversations`: `ReviewStore.list(repo)` 결과에 `running: boolean`을 붙여 돌려준다. `running`은 `reviewJobs.runningFor(repo, key)`가 있으면 `true`다.
- `DELETE /api/review/conversation`: 쿼리에 `key`가 있으면 그 키의 대화를 지운다. `key`가 없으면 지금처럼 비교 조건으로 현재 비교 대상의 키를 구한다.
  - `key`는 `branch:`나 `mr:`로 시작해야 한다. 아니면 400 `{ error: 'invalid_key' }`를 돌려준다.
  - 답변을 만드는 중인 대화이면 지금처럼 409 `{ error: 'running' }`을 돌려준다.

### 화면 (`ConversationList.tsx`)

```
┌ [AI 리뷰] [코드 탐색] [대화 목록] ─────────┐
│ feature/login → develop                    │
│ 질문 4개 · 2026-09-30 18:20         [삭제] │
│ ────────────────────────────────────────── │
│ MR !128                                    │
│ 질문 1개 · 2026-09-28 10:02         [삭제] │
└────────────────────────────────────────────┘
```

- `SidePanel`에 `conversations` 탭을 추가하고 버튼 문구는 `대화 목록`으로 한다.
- 탭이 보일 때마다 `GET /api/review/conversations`를 다시 요청한다.
- 줄마다 이름, `질문 N개 · YYYY-MM-DD HH:mm`, `삭제` 버튼을 그린다.
  - 브랜치 비교 키 `branch:<target>...<source>`는 `<source> → <target>`으로 표시한다.
  - MR 키 `mr:<iid>`는 `MR !<iid>`로 표시한다.
  - 시각은 로컬 시간대로 표시한다.
  - 지금 열린 비교 대상의 줄은 배경색으로 구분한다.
- 대화가 없으면 `저장된 대화가 없습니다`를 보여준다.
- 목록 요청이 실패하면 `대화 목록을 불러오지 못했습니다`를 보여준다.

### 줄 클릭

- `src/ui/comparison.ts`에 `comparisonFromKey(key: string): Comparison | null`을 추가한다.
  - `branch:`로 시작하면 나머지를 첫 `...`에서 나눠 `{ mode: 'branch', target, source }`를 만든다. git 브랜치 이름에는 `..`이 들어갈 수 없어서 첫 `...`에서 나눠도 이름이 잘못 나뉘지 않는다. `...`이 없거나 두 이름 중 하나가 비면 `null`이다.
  - `mr:`로 시작하고 나머지가 양의 정수이면 `{ mode: 'mr', iid }`를 만든다. 아니면 `null`이다.
- 줄 클릭 시 `comparisonFromKey`로 만든 값을 `handleComparisonChange`에 넘기고 오른쪽 패널 탭을 `review`로 바꾼다. `null`이면 아무것도 하지 않는다.
- 브랜치가 지워졌거나 GitLab에 연결되지 않았을 때는 비교 대상을 직접 골랐을 때와 같은 기존 오류 안내가 나온다.
- 리뷰 제외한 파일은 비교 대상별로 localStorage에 저장되어 있어서 그대로 적용된다. Viewed 체크는 서버 메모리에 있어서 같은 창에서 전에 체크한 것만 남는다.

### 삭제 버튼

- 클릭 시 줄 클릭으로 처리되지 않게 이벤트 전파를 막는다.
- `window.confirm('이 대화의 모든 질문과 답변을 삭제할까요?')`에서 확인하면 `DELETE /api/review/conversation?key=<key>`를 요청한다.
- 성공하면 목록을 다시 요청한다. 지운 대화가 지금 열린 비교 대상의 대화이면 `AI 리뷰` 탭의 대화도 다시 불러와서 빈 상태로 바뀐다.
- `running`이 `true`인 줄은 `삭제` 버튼을 비활성으로 둔다. 409 응답을 받으면 `답변을 만드는 중인 대화는 삭제할 수 없습니다`를 목록 위에 보여준다.

## 3. AI 리뷰 탭 상단 버튼 (`ReviewPanel.tsx`)

- 버튼 문구를 `새 대화`에서 `대화 삭제`로 바꾼다.
- 확인 창 문구를 `이 비교의 모든 질문과 답변을 삭제할까요?`로 바꾼다.
- 동작은 지금과 같다. 대화 파일을 지우고 다음 질문부터 새 Claude 세션을 쓴다.

## 4. 테스트

- `settings`: `reviewRetentionDays`의 기본값 30, 0과 `null`이 `null`로 저장됨, 음수와 소수와 문자열은 무시됨
- `ReviewStore.prune`: 임시 폴더로 확인한다.
  - 기간이 지난 대화 파일은 지워지고 지나지 않은 파일은 남는다.
  - 마지막 질문 시각을 기준으로 한다. 첫 질문은 오래됐어도 마지막 질문이 최근이면 남는다.
  - `null`이면 아무것도 지우지 않는다.
  - 다른 저장소 폴더의 파일도 정리되고, 빈 저장소 폴더는 지워진다.
  - 이전 형식 파일은 `createdAt`으로 판단한다.
- `ReviewStore.list`: 이 저장소의 대화만 나오고, `lastAt`이 큰 순서이며, 메시지가 없는 파일은 빠진다.
- 서버 API
  - `GET /api/review/conversations` 응답 형태와 `running` 값
  - `DELETE /api/review/conversation?key=`로 다른 비교 대상의 대화 삭제, 잘못된 키 400, 답변 중 409
  - `PUT /api/settings`에 `reviewRetentionDays`를 보내면 기간이 지난 대화가 지워진다.
- `comparisonFromKey`: 브랜치 키, `/`가 들어간 브랜치 이름, MR 키, 잘못된 키
- 대화 목록의 표시 이름과 시각 형식은 순수 함수로 분리해서 단위테스트로 확인한다.
- 앱에서 확인할 항목
  1. 설정에서 보존 기간을 1일로 바꾸면 하루 넘게 질문하지 않은 대화가 `대화 목록`에서 사라진다.
  2. `대화 목록`에서 다른 MR의 줄을 클릭하면 그 MR diff와 AI 리뷰 대화가 열린다.
  3. `대화 목록`에서 지금 열린 비교 대상의 대화를 삭제하면 `AI 리뷰` 탭이 빈 상태로 바뀐다.
  4. `AI 리뷰` 탭의 `대화 삭제` 버튼이 기존 `새 대화`와 같은 동작을 한다.

## 5. 문서

README의 AI 리뷰 설명에 보존 기간 설정, `대화 목록` 탭, `대화 삭제` 버튼 설명을 한국어로 추가한다.

## 구현 순서

1. `settings.ts`의 `reviewRetentionDays`, `ReviewStore.prune`과 `list`
2. 서버 API와 서버 시작 시 정리
3. `comparisonFromKey`와 표시용 함수
4. `ConversationList`, `SidePanel` 탭, `ReviewPanel` 문구, 설정 input
5. README
