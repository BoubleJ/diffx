# 선택한 코드로 AI에게 질문하기 설계

## 목적

리뷰어가 diff에서 코드를 드래그로 선택하고 그 코드에 대해 바로 AI에게 질문한다. 지금은 AI 리뷰 패널에 질문을 쓰면서 파일과 줄을 직접 적어야 한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 시작 방식 | 선택이 끝나면 `AI에게 질문` 작은 버튼이 먼저 뜨고, 클릭 시 입력 팝업으로 바뀐다 |
| 답변 위치 | 오른쪽 `AI 리뷰` 패널. 기존 대화에 이어서 쌓인다 |
| 선택 범위 | 파일 카드 하나, 한쪽 컬럼(추가 쪽이나 삭제 쪽) 안의 선택만 |
| 선택한 코드 상한 | 4000자 |
| 질문 글 상한 | 기존 2000자 그대로 |
| 보내기 키 | Enter. Shift+Enter는 줄바꿈. 한글 조합 중 Enter는 보내지 않는다 |

## 1. 화면 흐름

```
 12 │ const total = items.reduce(...)     ← 드래그로 선택
 13 │ return format(total)
                              [✦ AI에게 질문]

        ↓ 버튼 클릭

 ┌────────────────────────────────────────┐
 │ src/cart.ts:12-13 (변경 후 코드)          │
 │ 선택한 코드에 대해 질문하기          [↑]  │
 └────────────────────────────────────────┘
```

1. diff 카드 안에서 코드를 드래그하고 마우스를 놓으면(`mouseup`) 선택 범위의 끝 위치 오른쪽 아래에 `AI에게 질문` 버튼이 뜬다.
2. 버튼 클릭 시 같은 위치에 입력 팝업이 열린다.
   - 팝업 첫 줄에 `<파일 경로>:<시작줄>-<끝줄>`과 `(변경 후 코드)` 또는 `(변경 전 코드)`를 표시한다. 시작줄과 끝줄이 같으면 `<파일 경로>:<줄>`로 표시한다.
   - textarea placeholder는 `선택한 코드에 대해 질문하기`이고 열리면 포커스가 들어간다.
   - 오른쪽에 `↑` 보내기 버튼이 있다. 입력이 비어 있으면 비활성이다.
3. Enter 입력 시 또는 `↑` 버튼 클릭 시 질문을 보낸다.
   - 오른쪽 패널을 열고 탭을 `AI 리뷰`로 바꾼다.
   - 팝업을 닫고 diff 선택을 해제한다.
   - 질문은 지금 비교 대상의 대화에 이어서 쌓인다.
4. 버튼과 팝업은 아래 경우에 닫힌다.
   - 버튼 상태에서 선택이 해제될 때(`selectionchange` 후 선택 문자열이 비었을 때)
   - 팝업 밖을 클릭할 때(`mousedown`)
   - `Escape` 입력 시
   - diff 영역이 스크롤될 때
   - 다른 브랜치나 MR로 바뀔 때
5. 다른 질문의 답변을 만드는 중이면 버튼은 보이되 비활성이고 `title`은 `진행 중인 질문이 끝난 뒤 다시 보내 주세요`다.
6. 아래 선택에는 버튼을 띄우지 않는다.
   - 선택이 파일 카드 두 개 이상에 걸친 경우
   - 선택 시작과 끝이 서로 다른 컬럼(split 보기의 왼쪽과 오른쪽)인 경우
   - 시작이나 끝에서 줄 요소를 찾지 못한 경우(파일 헤더, 줄 번호 영역만 선택한 경우)
   - 선택 문자열이 공백뿐인 경우
7. 선택 문자열이 4000자를 넘으면 버튼은 뜨고, 팝업에 `선택한 코드가 너무 깁니다 (4000자까지)`를 표시하며 보내기 버튼을 비활성으로 둔다.

## 2. 선택 위치 읽기 (`src/ui/selection.ts`)

diff는 파일 카드마다 `@pierre/diffs`가 만든 open shadow DOM 안에 그려진다. `document.getSelection()`은 shadow DOM 안의 범위를 호스트 요소로 바꿔 돌려주므로 줄을 알 수 없다.

- `mouseup` 이벤트의 `composedPath()`에서 `shadowRoot`를 가진 첫 요소(파일 카드의 호스트)를 찾는다.
- Chromium의 `ShadowRoot.getSelection()`으로 그 shadow root 안의 선택을 읽는다. Electron 44의 Chromium에서 동작한다. TypeScript 타입에는 없으므로 `(root as ShadowRoot & { getSelection(): Selection | null })`로 호출한다.
- 선택의 `anchorNode`와 `focusNode`에서 조상 방향으로 `data-line-type`이 있는 가장 가까운 요소를 찾는다.
- 줄 요소의 컬럼은 조상의 `data-additions`, `data-deletions`, `data-unified` 속성으로 정한다. `findLine.ts`의 `columnOf`와 같은 규칙이다.
- 줄 번호와 쪽은 아래 순수 함수로 계산한다.

```ts
interface LineInfo {
  type: string            // data-line-type
  line: number            // data-line
  altLine: number | null  // data-alt-line
  column: 'additions' | 'deletions' | 'unified' | null
}

type SelectedLines = { side: 'additions' | 'deletions'; startLine: number; endLine: number }

function selectedLines(start: LineInfo, end: LineInfo): SelectedLines | null
```

- 각 줄의 쪽은 다음과 같다.
  - `change-addition`은 추가 쪽이다.
  - `change-deletion`은 삭제 쪽이다.
  - `context`와 `context-expanded`는 컬럼이 `additions`나 `deletions`이면 그 쪽이다. `unified`이거나 컬럼이 없으면 추가 쪽이다.
- 줄 번호는 그 쪽의 번호를 쓴다. unified 보기의 context 줄은 추가 쪽 번호(`data-line`)를 쓴다.
- 두 줄의 쪽이 다르면 결과는 다음과 같다.
  - unified 보기에서 삭제 줄과 추가 줄에 걸쳐 선택한 경우에는 추가 쪽으로 정한다. 삭제 줄 끝에 있으면 그 줄의 `data-alt-line`이 있을 때 그 값을 쓰고, 없으면 다른 쪽 끝 줄 번호를 쓴다.
  - split 보기에서 두 컬럼이 서로 다르면 `null`을 돌려준다.
- 시작과 끝은 작은 번호가 `startLine`이 되도록 정렬한다(아래에서 위로 드래그한 경우).
- 선택 문자열은 `selection.toString()`을 쓰고 앞뒤 빈 줄만 지운다.
- 선택 문자열에 줄 번호가 섞여 들어오는지 구현 첫 단계에서 앱으로 확인한다. 섞이면 `@pierre/diffs`의 `unsafeCSS` 옵션으로 줄 번호 요소에 `user-select: none`을 준다.

## 3. 버튼과 팝업 (`src/ui/components/SelectionAsk.tsx`)

- `DiffViewer`의 `.diff-viewer` 요소에 `mouseup` 리스너를 단다. 위 규칙으로 선택을 읽고 `{ path, side, startLine, endLine, code, rect }`를 상태로 둔다. `rect`는 선택 범위의 `getBoundingClientRect()`다.
- 버튼과 팝업은 `position: fixed`로 `rect.bottom + 4`, `rect.right` 기준으로 그린다. 화면 오른쪽 끝을 넘으면 오른쪽에 맞춘다.
- 버튼을 클릭할 때 `mousedown`에서 `preventDefault()`를 호출해서 diff 선택이 풀리지 않게 한다.
- 팝업 textarea는 최대 6줄까지 높이가 늘어난다.
- `path`는 그 카드의 파일 경로다. `DiffViewer`가 카드 요소(`.file-diff-card`)에 `id={`file-${filePath}`}`를 붙이므로, `composedPath()`에서 `file-diff-card` 클래스를 가진 요소를 찾아 `id`의 `file-` 뒤를 경로로 쓴다. 이 요소를 찾지 못하면 버튼을 띄우지 않는다.

## 4. 요청과 저장

### 클라이언트 (`useReview.ts`)

- `PendingQuestion`과 `ReviewMessage`에 `selection?: CodeSelection`을 추가한다.

```ts
interface CodeSelection {
  path: string
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
  code: string
}
```

- `ask(question: string, selection?: CodeSelection)`으로 바꾼다. 요청 본문에 `selection`을 넣는다.

### 서버 (`POST /api/review`)

- `kind`가 `question`일 때만 `selection`을 받는다. `review`이면 무시한다.
- 검사 규칙. 하나라도 어긋나면 400 `{ error: 'invalid_selection', message: '선택한 코드 정보가 올바르지 않습니다' }`를 돌려준다.
  - `path`가 문자열이고 `isSafePath(path, repo)`를 통과한다.
  - `side`가 `additions`나 `deletions`다.
  - `startLine`, `endLine`이 양의 정수이고 `startLine <= endLine`이다.
  - `code`가 공백이 아닌 문자열이다.
- `code`가 4000자를 넘으면 400 `{ error: 'selection_too_long', message: '선택한 코드는 4000자까지 보낼 수 있습니다' }`를 돌려준다.
- `ReviewJobs.start`에 `selection`을 넘긴다. 작업이 끝나 대화에 저장할 때 메시지에 `selection`을 함께 저장한다. 진행 중 작업 정보(`runningFor`)에도 `selection`을 포함해서 화면을 다시 열어도 진행 중 질문 카드에 위치가 보이게 한다.

### 프롬프트 (`src/review/prompt.ts`)

- `buildQuestionPrompt(question: string, selection?: CodeSelection): string`을 추가한다. `selection`이 없으면 `question`을 그대로 돌려준다. 지금 동작과 같다.
- `selection`이 있으면 아래 형식으로 만든다. 코드 블록 구분자는 코드 안에 나오는 가장 긴 백틱 연속보다 하나 길게 만든다.

````
사용자가 diff에서 선택한 코드: src/cart.ts 12-13줄 (변경 후 코드)
```
const total = items.reduce(...)
return format(total)
```

질문: 이 부분 성능 괜찮아?
````

- 줄 표시는 시작과 끝이 같으면 `12줄`, 다르면 `12-13줄`이다. 쪽 표시는 `additions`이면 `(변경 후 코드)`, `deletions`이면 `(변경 전 코드)`다.
- `jobs.ts`의 질문 프롬프트를 `job.question` 대신 `buildQuestionPrompt(job.question, job.selection)`으로 만든다.

## 5. 질문 카드 (`ReviewPanel.tsx`)

- `QuestionCard`가 `selection`을 받는다. 있으면 질문 글 위에 `src/cart.ts:12-13` 표시와 `선택한 코드` 펼치기 버튼을 그린다. 펼치면 코드가 `answer-code` 스타일로 보인다. 기본은 접힌 상태다.
- 진행 중 질문 카드(`pending`)와 저장된 질문 카드 모두 같은 표시를 쓴다.

## 6. 테스트

- `selection.ts`의 `selectedLines`
  - 추가 줄 두 개, 삭제 줄 두 개, split 보기 context 줄의 쪽과 번호
  - unified 보기 context 줄은 추가 쪽 번호
  - unified 보기에서 삭제 줄과 추가 줄에 걸친 선택은 추가 쪽
  - split 보기에서 두 컬럼에 걸친 선택은 `null`
  - 아래에서 위로 드래그해도 `startLine <= endLine`
- `buildQuestionPrompt`: 선택 없음, 한 줄, 여러 줄, 코드 안에 백틱 세 개가 있을 때 구분자가 네 개
- 서버
  - `selection`이 있는 질문이 저장된 메시지에 `selection`을 갖고, 실행 함수가 받은 프롬프트에 선택 블록이 들어간다
  - 잘못된 경로, 잘못된 줄 번호, 빈 코드는 `invalid_selection`, 4001자 코드는 `selection_too_long`
  - `review` 요청의 `selection`은 무시된다
- 질문 카드의 선택 표시는 `renderToStaticMarkup`으로 위치 문자열을 확인한다.
- 앱에서 확인할 항목
  1. 선택 문자열에 줄 번호가 섞이지 않는다.
  2. split 보기와 unified 보기에서 추가 줄, 삭제 줄, context 줄을 선택했을 때 팝업의 위치 표시가 맞다.
  3. 질문을 보내면 AI 리뷰 패널이 열리고 질문 카드에 위치와 선택한 코드가 보이며, 답변이 선택한 코드를 바탕으로 나온다.
  4. 코드를 복사하려고 선택했을 때 버튼만 뜨고 Cmd+C가 동작한다.

## 구현 순서

1. 줄 번호가 선택 문자열에 섞이는지 확인하고 필요하면 `user-select: none` 적용
2. `selectedLines`, `buildQuestionPrompt`
3. 서버 `selection` 검사, 저장, 프롬프트 연결
4. `useReview`의 `ask`와 질문 카드 표시
5. `SelectionAsk` 버튼과 팝업, `DiffViewer` 연결
