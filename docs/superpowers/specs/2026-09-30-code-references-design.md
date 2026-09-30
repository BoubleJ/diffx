# 코드 사용처 보기와 코드 탐색 패널 설계

## 목적

리뷰 중에 바뀐 함수나 파일이 어디서 쓰이는지 확인할 수 있도록, VS Code처럼 정의 자리를 Cmd+클릭하면 사용처 목록을 보여준다. 정의 후보 목록과 사용처 목록은 모두 오른쪽 패널의 `코드 탐색` 탭에 보여줘서, 목록을 띄우는 UI를 하나로 통일한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 사용처를 여는 입력 | 정의 자리 Cmd+클릭 (지금 "이미 정의 위치입니다"가 나오는 경우) |
| 파일 사용처를 여는 입력 | diff 카드 헤더와 파일 오버레이 헤더의 파일 경로 Cmd+클릭 |
| 목록을 보여주는 곳 | 오른쪽 패널의 `코드 탐색` 탭. 정의 후보 목록도 같은 탭으로 옮긴다 |
| 정의가 하나일 때 | 지금처럼 바로 이동한다 |
| 안내 문구 | 지금처럼 클릭한 위치에 작게 띄운다 |
| 검색 방식 | 이름 `git grep` + import 확인 (언어 서버 없음). 써 보고 불편하면 TypeScript 컴파일러의 `findReferences`로 바꾼다 |
| 최대 개수 | 200곳 |

## 1. 화면

### 오른쪽 패널

- 패널 상단에 `AI 리뷰 | 코드 탐색` 탭을 둔다. 패널 너비 조절과 열림 상태, 너비 저장은 지금 AI 리뷰 패널의 것을 그대로 쓴다.
- 툴바의 `AI 리뷰` 버튼 클릭 시
  - 패널이 닫혀 있으면 `AI 리뷰` 탭으로 연다.
  - `코드 탐색` 탭이 열려 있으면 `AI 리뷰` 탭으로 바꾼다.
  - `AI 리뷰` 탭이 열려 있으면 패널을 닫는다.
- 두 탭의 내용은 탭을 오가도 유지된다.
- 패널 상태 저장값에 `tab: 'review' | 'explore'`를 추가한다. 기존 저장값에 `tab`이 없으면 `review`로 읽는다.

### `코드 탐색` 탭

- 정의 자리 Cmd+클릭 시 패널이 `코드 탐색` 탭으로 열리고, 제목 "`<이름>` 사용처"를 보여준 뒤 사용처를 검색한다.
- 정의가 아닌 곳을 Cmd+클릭했는데 정의 후보가 여러 개이면 같은 탭에 "`<이름>` 정의 후보"를 보여준다. 지금 이 경우에 뜨는 팝오버는 없앤다.
- 파일 경로 Cmd+클릭 시 제목 "`<파일 이름>`을 import하는 곳"을 보여준다.
- 목록은 파일별로 묶고, 파일 이름 아래에 줄 번호와 그 줄의 코드를 한 줄씩 보여준다. 제목 옆에 개수를 표시한다 (예: "사용처 12곳").
- 항목 클릭 시 지금의 정의 이동과 같게 동작한다. diff에 있는 파일이면 카드의 그 줄로 스크롤하고 2초 동안 강조한다. diff에 없는 파일이거나 그 줄이 diff에 보이지 않으면 파일 오버레이 창에서 연다. 목록은 그대로 남고 누른 항목은 선택 상태로 표시된다.
- 검색 중에는 "사용처를 찾는 중입니다"를, 결과가 없으면 "사용처를 찾지 못했습니다"를 보여준다.
- 결과가 200곳을 넘으면 앞의 200곳만 보여주고 "200곳까지만 표시합니다"를 덧붙인다.
- 새로 Cmd+클릭하면 목록이 새 결과로 바뀐다. 이전 목록 기록은 남기지 않는다.
- 검색 중에 다른 곳을 Cmd+클릭하면 이전 요청의 결과는 버리고 마지막 요청의 결과만 보여준다.
- 검색 요청이 실패하면 "사용처를 찾는 중 오류가 났습니다"를 보여준다.

## 2. 서버

### API

- `GET /api/references`
  - 받는 값: 비교 조합(`mode`, `source`, `target` 또는 `iid`), `path`, `side`, 그리고 `line`, `col` 또는 `scope=file`
  - 파일을 읽을 커밋은 `/api/definition`과 같게 정한다. `side=additions`이면 새 버전, `side=deletions`이면 이전 버전을 읽는다.
  - 응답
    - `{ kind: 'found', name, version, references: [{ path, line, text }], truncated }`
    - `{ kind: 'not_declaration' }`: 클릭한 곳이 선언 자리가 아니다
  - `mode`가 `branch`, `mr`가 아니면 400 `missing_mode`, 그 외 잘못된 값은 `/api/definition`과 같은 400 응답을 쓴다.
- 화면은 Cmd+클릭 시 `/api/definition`을 먼저 부르고, 응답이 `self`이면 `/api/references`를 부른다.

### 함수와 변수의 사용처 (`src/definition/references.ts`)

1. `classifyToken`으로 클릭한 토큰의 이름을 구하고, `findDeclarationLines`로 그 줄이 선언 줄인지 확인한다. 선언 줄이 아니면 `not_declaration`을 돌려준다.
2. 정의 파일 안에서 그 이름이 단어로 나오는 줄을 모두 사용처로 넣는다. 클릭한 선언 줄은 뺀다. 단어 경계는 JS 식별자 문자(`A-Za-z0-9_$`) 기준이다.
3. `findExport`로 그 이름을 export하는지 확인한다. export하지 않으면 2번 결과만 돌려준다.
4. export하면 저장소에서 그 이름을 `git grep`으로 찾아 후보 파일을 추린다. 후보 파일마다 `parseImports`로 import를 읽고, `resolveModule`로 풀었을 때 대상 파일(정의 파일이나 아래 5번의 다시 내보내는 파일)을 가리키는 import만 인정한다.
   - `import { a }`: 그 파일에서 `a`가 나오는 줄을 넣는다.
   - `import { a as b }`: `b`가 나오는 줄을 넣는다.
   - `import * as m`: `m.a`가 나오는 줄을 넣는다.
   - `export default`로 내보낸 선언이면 default import의 로컬 이름으로 찾는다.
   - import 줄도 목록에 넣는다.
5. 후보 파일이 대상 파일에서 그 이름을 다시 내보내면(`export { a } from`, `export { a as c } from`, `export * from`), 그 파일도 대상 파일에 넣고 내보낸 이름으로 다시 찾는다. 정의 찾기의 `MAX_REEXPORT_DEPTH`(5단계)까지만 따라간다.

### 파일 사용처

1. 파일 이름(확장자 제외)으로 `git grep`을 해서 후보 파일을 추린다. 파일 이름이 `index`이면 폴더 이름으로 찾는다.
2. 후보 파일의 `import … from '…'`, `import '…'`, `export … from '…'`, `import('…')` 경로를 `resolveModule`로 풀어, 대상 파일을 가리키는 줄만 넣는다.

### 제한

- 결과는 경로, 줄 번호 순으로 정렬하고 최대 200곳까지만 돌려준다. 넘으면 `truncated: true`를 붙인다.
- `git grep`은 정의 찾기의 10초 시간 제한을 그대로 쓴다. 시간이 초과되면 그때까지 찾은 결과만 돌려준다.

### 확인하지 못하는 경우

- 같은 파일 안에 이름이 같은 지역 변수가 있으면 사용처로 나온다.
- 주석이나 문자열 안의 같은 단어도 사용처로 나온다.
- `require()`, 동적 `import()`로 가져온 뒤 쓰는 이름은 따라가지 않는다. 파일 사용처에서는 `import('…')` 줄을 찾는다.

## 3. 화면 코드 구성

- `SidePanel`(신규): 탭 전환을 맡는다. `AI 리뷰` 탭은 기존 `ReviewPanel`을, `코드 탐색` 탭은 `ExplorePanel`을 그린다.
- `ExplorePanel`(신규): `{ title, status: 'loading' | 'ready' | 'error', items, truncated, version }`을 받아 목록을 그린다.
- `App.tsx`의 `handleDefinition`
  - `choose` 결과는 `코드 탐색` 탭에 후보 목록으로 넣는다.
  - `self` 결과는 `/api/references`를 불러 사용처 목록으로 넣는다.
- `DefinitionPopover`에서 `choose` 종류를 지우고 안내 문구만 남긴다.
- `FileDiffCard` 헤더 경로와 `FileViewerOverlay` 헤더 경로에 Cmd+클릭 처리를 붙인다. 경로 위에서 Cmd를 누르면 코드 토큰과 같게 밑줄과 포인터를 보여준다.

## 4. 테스트

- `src/definition/references.test.ts` (임시 git 저장소)
  - 정의 파일 안의 사용처가 나오고 클릭한 선언 줄은 빠진다
  - 다른 파일의 사용처가 나온다: 이름 그대로 import, 이름을 바꾼 import, `import * as`, default import, 경로 별칭
  - 다시 내보내는 파일(index.ts)을 거친 import가 나온다
  - 이름만 같고 대상 파일을 import하지 않은 파일은 빠진다
  - export하지 않는 선언은 정의 파일 안에서만 찾는다
  - 선언이 아닌 곳이면 `not_declaration`
  - 200곳이 넘으면 200곳만 돌려주고 `truncated: true`
  - 파일 사용처가 나온다 (일반 파일, index 파일, `import '…'`, `export * from`, `import('…')`)
- 서버 테스트: `/api/references`가 `side`에 맞는 버전을 읽는다. `mode`가 없으면 400이다.
- UI 테스트: 패널 저장값의 `tab` 기본값, 서버 응답을 목록 데이터로 바꾸는 함수, `AI 리뷰` 버튼의 탭 전환 규칙

## 구현 순서

1. 서버: `references.ts`, `/api/references`
2. 오른쪽 패널 탭(`SidePanel`), 패널 저장값의 `tab`
3. `ExplorePanel`과 `handleDefinition` 연결, 팝오버의 `choose` 제거
4. 파일 경로 Cmd+클릭
5. README 코드 하이퍼링크 섹션에 사용처 보기 사용법 추가
