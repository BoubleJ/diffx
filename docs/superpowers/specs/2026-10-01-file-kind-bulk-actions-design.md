# 파일 종류별 리뷰 제외와 Viewed 일괄 처리 설계

## 목적

리뷰어가 `.md` 파일이나 테스트 파일처럼 같은 종류의 파일을 한 번에 리뷰 제외하거나 Viewed로 체크한다. 지금은 diff 카드 헤더의 `리뷰 제외` 버튼과 `Viewed` 체크박스를 파일마다 하나씩 눌러야 한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 여는 위치 | 사이드바 검색줄(`Filter files...`) 오른쪽 버튼. 클릭 시 팝오버가 열린다 |
| 팝오버 형태 | 파일 종류마다 한 줄. 열은 `리뷰 제외`, `Viewed` 체크박스 두 개 |
| 파일 종류 | `테스트 파일`, 마지막 확장자(`.ts`, `.md`), `확장자 없음` |
| 적용 범위 | 지금 열린 diff에만 적용한다. 다른 브랜치나 MR에 자동으로 적용하는 규칙은 만들지 않는다 |
| 저장 | 기존 파일별 `리뷰 제외`, `Viewed`와 같은 저장 방식을 쓴다 |

## 1. 전체 구조

```
src/ui/
├─ fileKinds.ts                    (신규) 파일 종류 판별, 종류별 묶기, 체크 상태 계산
├─ components/FileKindPopover.tsx  (신규) 팝오버 버튼과 표
├─ components/FileTree.tsx         검색줄 오른쪽에 팝오버 자리 추가
├─ App.tsx                         여러 파일 리뷰 제외, 포함, Viewed 처리 함수 연결
└─ styles/global.css               팝오버 스타일
```

## 2. 파일 종류 (`fileKinds.ts`)

### 종류 판별 `fileKind(path)`

1. 파일 이름에 `.test.`나 `.spec.`이 들어 있거나 경로에 `__tests__/` 폴더가 있으면 `test`를 돌려준다. 예: `src/App.test.tsx`, `e2e/login.spec.ts`, `src/__tests__/util.ts`.
2. 그 외에는 파일 이름(경로의 마지막 부분)의 마지막 `.` 뒤를 확장자로 보고 `.md`처럼 점을 붙여 돌려준다. 대소문자는 소문자로 바꾼다. `README.MD`는 `.md`가 된다. `types.d.ts`는 `.ts`가 된다.
3. 파일 이름에 `.`이 없거나 `.gitignore`처럼 맨 앞에만 `.`이 있으면 빈 문자열을 돌려준다. 이 값은 `확장자 없음`으로 표시한다.

### 묶기 `groupFileKinds(paths)`

- 입력은 diff에 있는 모든 파일 경로다. 리뷰 제외된 파일도 포함한다.
- 결과는 `{ kind, label, paths }[]`다. `label`은 `test`이면 `테스트 파일`, 빈 문자열이면 `확장자 없음`, 그 외에는 확장자 그대로다.
- 정렬 순서
  1. `테스트 파일`은 항상 맨 위에 둔다.
  2. 나머지는 파일 수가 많은 순서로 둔다.
  3. 파일 수가 같으면 `label`의 알파벳 순서로 둔다.
  4. `확장자 없음`은 파일 수와 관계없이 맨 아래에 둔다.

### 체크 상태 `checkState(paths, selected)`

- `paths` 중 `selected`(리뷰 제외된 파일 집합이나 Viewed 파일 집합)에 들어 있는 파일 수로 상태를 정한다.
- 모두 들어 있으면 `all`, 하나도 없으면 `none`, 일부만 있으면 `some`을 돌려준다. `paths`가 비어 있으면 `none`을 돌려준다.

## 3. 팝오버 (`FileKindPopover.tsx`)

### 버튼

- 위치: `FileTree` 검색줄의 `ft-search-wrapper` 오른쪽. 사이드바를 접었을 때는 그리지 않는다.
- 아이콘: lucide-react `ListFilter`. `title`과 `aria-label`은 `파일 종류별 처리`다.
- 팝오버가 열려 있는 동안 버튼에 `btn-active` 클래스를 붙인다.
- diff에 파일이 없으면 버튼을 비활성으로 둔다.

### 표

```
┌─ 파일 종류 ─────────────────────────────┐
│                       리뷰 제외    Viewed │
│ 테스트 파일  5개           ☑          ☐    │
│ .md         3개           ☑          ☐    │
│ .json       2개           ☐          ☑    │
│ .ts        12개           ☐          ▣    │
└─────────────────────────────────────────┘
```

- 줄마다 `label`, `N개`, `리뷰 제외` 체크박스, `Viewed` 체크박스를 둔다.
- 체크박스는 `checkState`로 그린다. `all`이면 체크, `none`이면 해제, `some`이면 `indeterminate`다. `indeterminate`는 HTML 속성이 아니라 DOM 속성이라 ref로 설정한다.

### `리뷰 제외` 체크박스

- 대상은 그 종류의 모든 파일이다.
- 상태가 `none`이나 `some`일 때 클릭하면 그 종류의 파일을 모두 리뷰 제외한다.
- 상태가 `all`일 때 클릭하면 그 종류의 파일을 모두 다시 포함한다.

### `Viewed` 체크박스

- 대상은 그 종류의 파일 중 리뷰 제외되지 않은 파일이다. 리뷰 제외된 파일은 diff 목록에 보이지 않으므로 Viewed로 처리하지 않는다.
- 대상 파일이 없으면(그 종류가 모두 리뷰 제외됨) 체크박스를 비활성으로 두고 해제 상태로 그린다.
- 상태가 `none`이나 `some`일 때 클릭하면 대상 파일 중 Viewed가 아닌 파일을 모두 Viewed로 체크한다.
- 상태가 `all`일 때 클릭하면 대상 파일을 모두 Viewed 해제한다.

### 열고 닫기

- 버튼 클릭 시 열리고, 다시 클릭하면 닫힌다.
- 팝오버 밖을 클릭(`mousedown`)하거나 `Escape` 키를 누르면 닫힌다. 툴바 설정 팝오버와 같은 방식이다.
- 체크박스를 눌러도 팝오버는 닫히지 않는다. 여러 줄을 이어서 처리할 수 있다.
- 열려 있는 동안 diff가 바뀌면(다른 브랜치나 MR 선택) 목록이 새 diff 기준으로 다시 그려진다.

## 4. App 연결

- `FileTree`에 `searchAction?: ReactNode` prop을 추가하고 검색줄 오른쪽에 그린다. `App`이 여기에 `FileKindPopover`를 넘긴다. `FileTree`는 리뷰 제외되지 않은 파일만 받으므로 팝오버는 `App`에서 모든 파일 목록을 받는다.
- `App.tsx`의 `handleExclude`, `handleInclude`와 같은 방식으로 여러 경로를 한 번에 처리하는 `handleExcludeMany(paths)`, `handleIncludeMany(paths)`를 추가한다. `setExcludedEdit`을 한 번만 호출해서 localStorage 저장도 한 번만 일어난다.
- Viewed는 `useViewed`의 `setViewed(filePath, viewed)`를 대상 파일마다 호출한다. 파일마다 `PUT /api/viewed` 요청이 한 번씩 나간다. 내용 해시가 없는 바이너리 파일은 기존처럼 화면 상태에만 반영되고 서버에 저장되지 않는다.

## 5. 테스트

- `fileKinds.test.ts`
  - `fileKind`: `.test.`, `.spec.`, `__tests__/` 판별, 마지막 확장자, 대문자 확장자, `.d.ts`, 확장자 없는 파일, `.gitignore`
  - `groupFileKinds`: `테스트 파일`이 맨 위, 파일 수 순서, 같은 수일 때 알파벳 순서, `확장자 없음`이 맨 아래, 테스트 파일이 확장자 줄에 다시 세지지 않음
  - `checkState`: `all`, `none`, `some`, 빈 목록
- `FileKindPopover`의 표 구성은 `renderToStaticMarkup`으로 줄 이름과 개수, 비활성 `Viewed` 체크박스를 확인한다. 체크박스 클릭과 `indeterminate` 표시는 앱에서 직접 확인한다.
- 앱에서 확인할 항목
  1. 테스트 파일과 `.md`가 있는 diff에서 팝오버를 열고 `테스트 파일`의 `리뷰 제외`를 체크하면 테스트 파일이 diff 목록과 파일 트리에서 사라지고 `제외된 파일` 목록에 나온다.
  2. 같은 줄의 체크를 해제하면 파일이 다시 나온다.
  3. `.ts`의 `Viewed`를 체크하면 `.ts` 카드가 모두 접히고, 카드 하나의 `Viewed`를 해제하면 팝오버의 체크박스가 `▣`로 바뀐다.
  4. 다른 MR을 열면 앞에서 리뷰 제외한 종류가 적용되지 않는다.

## 구현 순서

1. `fileKinds.ts`와 테스트
2. `FileKindPopover.tsx`, `FileTree.tsx`의 `searchAction`, 스타일
3. `App.tsx` 연결
