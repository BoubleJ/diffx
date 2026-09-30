# diff 코드 하이퍼링크 설계

## 목적

`docs/backlog/gitlab-mr-integration.md`의 6번 기능을 구현한다.

- diff 코드 안의 import 경로, 함수, 타입 이름을 Cmd+클릭하면 정의 위치로 이동한다.
- 정의 파일이 현재 diff에 있으면 그 diff 카드로, 없으면 파일 내용 보기 창으로 이동한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 대상 언어 | `.ts .tsx .js .jsx .mjs .cjs .vue` |
| 조작 | Cmd+클릭. Cmd를 누른 채 마우스를 올리면 밑줄이 생긴다. 일반 클릭과 드래그 선택은 지금과 같다 |
| 정의 찾는 방식 | import를 따라가고 이름 검색으로 찾는다. TypeScript Language Service는 쓰지 않는다 |
| 멤버 접근 | `obj.method`의 `method`처럼 `.` 뒤의 이름은 링크하지 않는다 |
| 변경되지 않은 파일 보기 | 가운데 오버레이 창 |
| 검색 기준 코드 | 모드와 클릭한 줄의 쪽(추가/삭제)에 맞는 버전 |

## 1. 동작 규칙

### 링크가 되는 것

- import와 export 문의 경로 문자열: `from './utils'`, `import('./page')`, `require('../x')`
- 식별자. 단 다음은 링크하지 않는다.
  - `.` 뒤의 멤버 이름
  - JavaScript/TypeScript 예약어(`const`, `function`, `return`, `import`, `export`, `from`, `type`, `interface` 등)
  - 주석 안의 이름
  - 따옴표 안의 문자열 중 import/export/`require`/`import()`의 경로가 아닌 것
- 대상 확장자가 아닌 파일에서는 Cmd를 눌러도 밑줄이 생기지 않고 클릭해도 요청하지 않는다.

### 조작

- Cmd를 누른 채 코드 조각에 마우스를 올리면 그 조각에 밑줄과 손가락 커서가 생긴다. 마우스가 조각을 벗어나면 사라진다.
- Cmd+클릭 시 서버에 정의 위치를 묻고 결과에 따라 이동한다.
- 요청 중에는 커서를 대기 모양으로 바꾼다.

### 검색 기준 코드

| 모드 | 추가 줄과 변경 없는 줄 | 삭제 줄 |
|---|---|---|
| 작업 중 변경사항 | 작업 트리 파일 | `HEAD` |
| 브랜치 비교 | 소스 커밋 | merge-base 커밋 |
| MR | `head_sha` | `base_sha` |
| custom | 작업 트리 파일 | `HEAD` |

### 찾는 순서

1. 클릭한 것이 import 경로 문자열이면 경로를 파일로 풀어 그 파일의 1번 줄로 이동한다.
2. 이름이 같은 파일에서 import된 것이면 import한 파일에서 그 이름의 export 선언을 찾는다.
   - `import x from` 은 `export default`를 찾는다.
   - `import { a as b }`에서 `b`를 클릭하면 `a`의 export를 찾는다.
   - `import * as ns`의 `ns`를 클릭하면 그 파일의 1번 줄로 이동한다.
   - export 선언이 재수출(`export { a } from './y'`, `export * from './y'`)이면 따라간다. 최대 5단계까지 따라간다.
   - export 선언을 찾지 못하면 import한 파일의 1번 줄로 이동한다.
3. 같은 파일에 그 이름의 선언이 있으면 그 줄로 이동한다. 클릭한 줄 자체가 선언이면 1~4단계에서 다른 곳을 찾지 않고 "이미 정의 위치입니다"를 보여준다.
4. 위에서 찾지 못하면 저장소 전체에서 선언 패턴을 검색한다. 후보는 최대 20개다.

선언 패턴은 다음 형태를 찾는다. `export`, `export default`, `async`, `declare`, `abstract` 앞머리를 허용한다.

- `function 이름`, `function* 이름`
- `const 이름`, `let 이름`, `var 이름` (구조 분해 `const { 이름 }`은 제외)
- `class 이름`, `interface 이름`, `type 이름`, `enum 이름`, `namespace 이름`

### 결과별 이동

- 찾은 파일이 현재 diff에 있으면 그 파일 카드로 스크롤하고 해당 줄에 강조 배경을 2초 동안 보여준다. 기존 AI 리뷰 지적 클릭과 같은 방식이다.
  - 해당 줄이 접힌 영역에 있어 화면에 그려지지 않으면 오버레이 창으로 연다.
  - 삭제 줄 기준으로 찾은 결과(merge-base, `base_sha`, `HEAD`에서 찾은 결과)는 diff 카드의 삭제 쪽 줄로 이동한다.
- 찾은 파일이 diff에 없으면 오버레이 창에서 파일을 열고 해당 줄로 스크롤한다.
- 후보가 여러 개면 클릭한 위치 아래에 `경로:줄` 목록을 띄운다. 항목 클릭 시 위 규칙대로 이동하고 목록 밖 클릭이나 Esc 입력 시 닫는다.
- 찾지 못하면 클릭한 위치 아래에 "정의를 찾지 못했습니다"를 2초 동안 보여준다.
- `node_modules` 패키지를 가리키면 "외부 패키지는 이동하지 않습니다"를 2초 동안 보여준다.
- 요청이 실패하면(서버 오류) "정의를 찾는 중 오류가 났습니다"를 2초 동안 보여준다.

### 오버레이 창

- 가운데에 diff 영역보다 조금 작은 창을 띄우고 뒤의 diff는 흐리게 보인다.
- 제목 줄에 파일 경로, 버전 표시(`소스`, `기준` 중 하나), `뒤로` 버튼, 닫기 버튼을 둔다.
- 파일은 `@pierre/diffs`의 `File` 컴포넌트로 문법 강조와 줄 번호를 붙여 그린다. 대상 줄로 스크롤하고 강조 배경을 2초 동안 보여준다.
- 창 안의 코드에서도 Cmd+클릭으로 계속 이동한다. 창 안의 파일은 그 창이 열린 버전(추가 쪽 또는 삭제 쪽) 기준으로 찾는다.
- 창 안에서 이동할 때마다 이동 기록이 쌓이고 `뒤로` 클릭 시 이전 파일과 줄로 돌아간다. 기록이 하나면 `뒤로`를 비활성으로 둔다.
- 창 안에서 찾은 파일이 diff에 있어도 창 안에서 연다.
- 닫기 버튼 클릭, Esc 입력, 뒤 배경 클릭 시 닫힌다. 닫으면 보던 diff 위치가 그대로다.
- 파일을 읽지 못하면(404) 창 안에 "파일을 읽지 못했습니다"를 보여준다.

## 2. 서버

### API

`GET /api/definition`

- 쿼리
  - 현재 비교 조합 쿼리: `mode`, `source`, `target`, `iid`, `staged`, `untracked` (기존 `/api/file-content`와 같다)
  - `path`: 클릭한 파일의 저장소 루트 기준 경로
  - `side`: `additions` 또는 `deletions`
  - `line`: 1 이상의 정수
  - `col`: 0 이상의 정수. 클릭한 조각의 줄 안 시작 글자 위치
- 서버는 `side`와 모드로 읽을 버전을 정하고 그 버전의 파일에서 `line`, `col` 위치를 다시 읽어 판단한다. 클릭한 조각의 텍스트는 받지 않는다.
- 응답
  - `{ kind: 'found', version: 'new' | 'old', targets: [{ path, line }] }`
  - `{ kind: 'self' }`: 클릭한 줄이 선언이다.
  - `{ kind: 'external', module }`
  - `{ kind: 'not_found' }`
- `path`가 저장소 밖을 가리키거나(`isSafePath` 실패) `line`, `col`, `side`가 형식에 맞지 않으면 400을 돌려준다. 대상 확장자가 아니면 `not_found`를 돌려준다.
- 비교 조합 오류는 기존 `comparisonErrorResponse`로 처리한다.

파일 내용 보기는 기존 `GET /api/file-content`(`path`, `version=new|old`와 비교 조합 쿼리)를 그대로 쓴다. `version=old`는 작업 중 변경사항 모드에서 `HEAD`, 브랜치 모드에서 merge-base, MR 모드에서 `base_sha`를 읽는다.

### 모듈 (`src/definition/`)

| 파일 | 역할 |
|---|---|
| `reader.ts` | 버전별 파일 읽기와 검색. 작업 트리용과 커밋용 두 구현을 같은 인터페이스(`readFile(path)`, `exists(path)`, `grep(pattern)`)로 둔다 |
| `token.ts` | 줄 텍스트와 글자 위치로 클릭 대상을 판별한다 |
| `imports.ts` | 파일의 import 문을 읽어 `로컬 이름 → { specifier, imported }` 표를 만든다. `imported`는 `default`, `*`, 이름 중 하나다 |
| `modules.ts` | import 경로를 파일 경로로 푼다 |
| `declarations.ts` | 파일 안에서 이름의 선언 줄과 export 선언을 찾는다. 재수출을 따라간다 |
| `resolve.ts` | 위 모듈을 묶어 1장의 찾는 순서대로 찾는다 |

#### reader

- 작업 트리용: `readFile`은 `getWorktreeFileContent`, `exists`는 파일 존재 확인, `grep`은 `git grep --untracked -n -E`를 쓴다.
- 커밋용: `readFile`은 `git show <sha>:<경로>`, `exists`는 `git cat-file -e <sha>:<경로>`, `grep`은 `git grep -n -E <pattern> <sha>`를 쓴다.
- 두 구현 모두 `grep`에 pathspec `:!**/node_modules/**`, `:!**/dist/**`, `:!**/.nuxt/**`, `:!**/.next/**`를 붙이고 대상 확장자로 제한한다.
- 경로는 `isSafePath`를 통과한 것만 읽는다.

#### modules

- `.`으로 시작하면 클릭한 파일 폴더 기준 상대경로다.
- 아니면 클릭한 파일에서 저장소 루트까지 올라가며 가장 가까운 `tsconfig.json` 또는 `jsconfig.json`을 찾는다. `compilerOptions.baseUrl`과 `compilerOptions.paths`를 읽는다. `extends`가 상대경로면 따라가서 합친다(최대 5단계). 파일은 주석과 끝 쉼표를 허용해 읽는다.
- `paths`에 맞는 항목이 없고 경로가 `@/` 또는 `~/`로 시작하면, 찾은 설정 파일 폴더(없으면 저장소 루트) 아래 `src/`를 먼저 시도하고 없으면 그 폴더 자체를 시도한다.
- 위 어디에도 해당하지 않으면 외부 패키지로 본다(`external`).
- 파일 후보 순서: 경로 그대로, `경로 + .ts .tsx .js .jsx .mjs .cjs .vue .d.ts`, `경로/index + 같은 확장자`. 처음 존재하는 것을 쓴다.
- 경로 문자열 안의 `.js` 확장자가 실제로는 `.ts` 파일을 가리키는 경우(`./a.js` → `a.ts`)도 시도한다.

#### declarations

- 선언 패턴은 1장의 목록을 정규식으로 찾는다. 줄 번호는 원본 파일 기준이다. `.vue` 파일도 파일 전체에 같은 정규식을 적용한다.
- export 선언 찾기
  - 이름: `export (async )?function 이름`, `export (const|let|var|class|interface|type|enum) 이름`, `export { ... 이름 ... }`, `export { 원래 as 이름 }`
  - default: `export default` 줄
  - 재수출: `export { 이름 } from '경로'`, `export { 원래 as 이름 } from '경로'`, `export * from '경로'`

#### resolve

- 1장의 찾는 순서를 따른다. 4단계 검색 결과는 경로와 줄 번호로 정렬하고 최대 20개를 돌려준다. 클릭한 줄 자체는 후보에서 뺀다.
- 결과 `version`은 검색에 쓴 버전이다(`additions` 쪽이면 `new`, `deletions` 쪽이면 `old`).

## 3. UI

| 파일 | 역할 |
|---|---|
| `components/FileDiffCard.tsx` | `FileDiff` 옵션에 `onTokenClick`, `onTokenEnter`, `onTokenLeave`를 넘긴다. 대상 확장자 파일이고 `event.metaKey`가 참일 때만 밑줄을 그리고 클릭을 처리한다 |
| `hooks/useDefinition.ts` | `/api/definition` 호출과 결과별 처리를 맡는다 |
| `components/DefinitionPopover.tsx` | 클릭 위치 아래의 후보 목록과 안내 문구 |
| `components/FileViewerOverlay.tsx` | 오버레이 창. `/api/file-content`로 파일을 읽어 `File` 컴포넌트로 그리고 이동 기록을 관리한다 |
| `App.tsx` | 위 컴포넌트 연결 |

- 밑줄은 `onTokenEnter`에서 받은 `tokenElement`에 스타일을 넣고 `onTokenLeave`에서 지운다.
- 카드 이동 후 대상 줄이 그려졌는지는 기존 강조 처리(`findLineElement`로 최대 30프레임 동안 찾는다)를 쓰고, 찾지 못하면 `FileDiffCard`가 알려서 `App`이 오버레이로 연다.

## 4. 테스트

- `token.ts`: import 경로 문자열, `import()`, `require()`, 식별자, 멤버 이름 제외, 예약어 제외, 주석 안 제외, 일반 문자열 제외
- `imports.ts`: 기본 import, 이름 import, 별칭 import, 네임스페이스 import, `import type`, 여러 줄 import
- `declarations.ts`: 선언 패턴별 줄 찾기, 구조 분해 제외, 이름 export, default export, 별칭 export, 재수출
- `modules.ts`: 임시 저장소에 상대경로, 확장자 생략, `index.ts`, `.vue`, `.js`로 쓴 `.ts`, tsconfig `paths`와 `extends`, 주석이 있는 tsconfig, `@/` 기본 별칭, 외부 패키지를 만들어 확인한다
- `resolve.ts`: 1장의 찾는 순서 각 단계와 재수출 5단계 제한, 후보 20개 제한을 확인한다. 같은 저장소를 작업 트리 버전과 커밋 버전(소스 커밋, merge-base)에서 모두 확인한다
- 서버 API: `/api/definition`의 응답 종류별 동작, 브랜치 모드 삭제 줄이 merge-base 기준으로 찾는 것, 잘못된 쿼리 400
- UI 컴포넌트는 테스트 환경이 node라 단위테스트가 없다. 앱에서 Cmd 밑줄, 카드 이동, 오버레이, 뒤로, 후보 목록, 안내 문구를 직접 확인한다

## 구현 순서

1. `reader.ts`, `token.ts`, `imports.ts`, `declarations.ts`
2. `modules.ts`
3. `resolve.ts`와 `/api/definition`
4. UI: 카드의 Cmd+클릭과 밑줄, 후보 목록과 안내, 카드 이동
5. UI: 오버레이 창과 이동 기록
