# 브랜치 비교, AI 리뷰, macOS 데스크톱 앱 설계

## 목적

diffx 포크에 세 기능을 추가한다.

1. UI에서 소스 브랜치와 타겟 브랜치를 골라 GitLab MR처럼 두 브랜치 사이의 변경사항을 본다. 로컬 브랜치와 원격 브랜치 모두 고를 수 있다.
2. Claude Code CLI로 현재 diff를 리뷰하고 결과를 우측 사이드탭에 보여준다. 사이드탭은 열고 닫을 수 있다.
3. 터미널 없이 macOS 데스크톱 앱으로 실행한다. 이 맥북에서 쓰고 동료에게 zip으로 나눠줄 수 있어야 한다.

기존 CLI(`diffx`) 사용 방식은 그대로 동작한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 브랜치 선택 방식 | 체크아웃하지 않고 `git diff target...source` 결과만 보여준다 |
| 원격 브랜치 최신화 | fetch 버튼 클릭 시에만 `git fetch --all --prune`을 실행한다 |
| 기존 작업 트리 모드 | 유지한다. 헤더 탭으로 `작업 중 변경사항`과 `브랜치 비교`를 전환한다 |
| 리뷰 실행 시점 | 사용자가 `리뷰 요청` 버튼을 눌렀을 때만 실행한다 |
| 리뷰 결과 형식 | 요약과 파일/라인별 지적 목록. 지적 클릭 시 해당 라인으로 스크롤한다 |
| 리뷰 중 파일 접근 | 저장소 파일 읽기와 git 조회 명령만 허용한다. 수정과 기타 명령은 허용하지 않는다 |
| 리뷰 언어와 모델 | 한국어로 작성한다. 모델은 각 CLI의 기본 설정을 쓴다 |
| 지원 AI 도구 | Claude Code만 지원한다(2026-09-29 사용자 요청으로 Codex CLI, Cursor Agent, Gemini CLI 제외). 어댑터 구조(`ReviewProvider`)는 유지해서 나중에 도구를 추가할 수 있게 둔다 |
| 데스크톱 방식 | Electron |
| 창 구성 | 저장소마다 창 하나. 창마다 서버를 따로 띄운다 |
| 배포 | arm64 `.app`을 ad-hoc 서명하고 zip으로 나눠준다. Apple 공증은 하지 않는다 |

## 1. 전체 구조

```
diffx
├─ src/
│  ├─ git.ts          모든 함수가 repoPath 인자를 받는다
│  ├─ server.ts       createApp({ repoPath, ... }). 브랜치, fetch, 리뷰 API 추가
│  ├─ review/         (신규) AI 도구 어댑터와 실행기
│  ├─ cli.ts          process.cwd()를 repoPath로 넘긴다
│  └─ ui/
│     ├─ components/BranchPicker.tsx   (신규) 모드 탭과 소스/타겟 드롭다운
│     └─ components/ReviewPanel.tsx    (신규) 우측 사이드탭
└─ electron/          (신규)
   ├─ main.ts         창 관리, 폴더 선택, 창마다 서버 시작
   ├─ preload.ts      폴더 선택 등 네이티브 기능 노출
   └─ launcher/       저장소 선택 화면
```

- 앱과 CLI는 같은 서버 코드를 쓴다. 앱은 창을 열 때마다 `127.0.0.1`의 빈 포트에 서버를 띄우고 창에서 그 주소를 연다. 창을 닫으면 그 서버를 종료한다.
- 지금 `git.ts`의 함수들은 `process.cwd()` 기준으로 git을 실행한다. 한 프로세스에서 여러 저장소를 다루기 위해 모든 함수가 `repoPath`를 받아 `execFileSync`의 `cwd`로 넘긴다.

## 2. 브랜치 비교

### 서버 API

- `GET /api/branches`
  - `git for-each-ref refs/heads refs/remotes` 결과로 `{ local: string[], remote: string[], current: string, defaultTarget: string | null }`을 돌려준다.
  - `refs/remotes/*/HEAD` 심볼릭 ref는 목록에서 뺀다.
  - `defaultTarget`은 `git symbolic-ref refs/remotes/origin/HEAD` 결과(예: `origin/main`)다. 없으면 `origin/main`, `origin/master`, `main`, `master` 중 존재하는 첫 번째를 쓰고 모두 없으면 `null`이다.
- `POST /api/fetch`
  - `GIT_TERMINAL_PROMPT=0` 환경변수로 `git fetch --all --prune`을 실행한다. 인증 입력을 기다리며 멈추지 않는다.
  - 60초 초과 시 중단한다. 실패 시 `{ error: <git stderr> }`와 500을 돌려준다.
- `GET /api/diff`
  - 쿼리 `mode=worktree|branch`를 추가한다. 기본값은 `worktree`이고 지금과 같이 동작한다.
  - `mode=branch&source=<ref>&target=<ref>`이면 `git diff --no-ext-diff --no-color <target>...<source>`를 실행한다.
  - `source`와 `target`은 `git rev-parse --verify --end-of-options <ref>^{commit}`로 확인한 뒤 git에 넘긴다. 확인 실패 시 400을 돌려준다.
  - 응답에 `mergeBase`, `sourceSha`, `targetSha`를 추가한다.
- `GET /api/file-content`
  - branch 모드에서는 이전 버전을 `git show <mergeBase>:<path>`, 새 버전을 `git show <sourceSha>:<path>`로 읽는다.
- `GET /api/file-versions`
  - branch 모드에서는 branch diff를 다시 만들어 oid를 대조한다. 이외 동작은 지금과 같다.
- CLI에서 `--` 뒤에 인자를 넘긴 custom 모드는 지금처럼 그 인자로만 diff를 만든다.

### UI

- Toolbar 왼쪽의 저장소 이름과 브랜치 표시 자리에 모드 탭(`작업 중 변경사항` / `브랜치 비교`)을 둔다. custom 모드에서는 모드 탭을 그리지 않는다.
- `브랜치 비교` 탭 선택 시 `소스 ▾ → 타겟 ▾` 드롭다운 두 개와 fetch 새로고침 버튼이 나온다.
  - 드롭다운은 검색 input이 있는 목록이고 `로컬`과 `원격` 그룹으로 나눈다.
  - 처음 선택값은 소스가 현재 브랜치, 타겟이 `defaultTarget`이다.
  - fetch 버튼 클릭 시 버튼에 로딩 표시가 나오고 완료 후 브랜치 목록과 diff를 다시 불러온다. 실패 시 드롭다운 아래에 git 에러 메시지를 보여준다.
- `작업 중 변경사항` 탭 선택 시 지금처럼 staged, untracked 설정이 적용된 diff가 나온다.
- 마지막으로 고른 모드와 브랜치 조합을 저장소 경로별로 localStorage에 저장하고 다음에 열 때 적용한다.

### 비교 조합 키

코멘트, viewed 상태, 리뷰 결과는 비교 조합별로 따로 저장한다.

- 작업 중 변경사항: `worktree`
- 브랜치 비교: `branch:<target>...<source>`
- custom 모드: `custom:<인자를 공백으로 이은 문자열>`

`/api/comments`, `/api/viewed`는 쿼리 `key`를 받아 해당 조합의 데이터만 읽고 쓴다. 조합을 바꿨다가 돌아오면 그 조합의 코멘트가 다시 나온다.

`key`가 없는 요청은 마지막으로 `/api/diff`가 응답한 조합의 데이터를 읽고 쓴다. `skills/diffx-finish-review`처럼 `key` 없이 `/api/comments`를 부르는 기존 사용처가 지금처럼 화면에 보이는 코멘트를 받는다. 코멘트 수정, 삭제, 답글 API는 코멘트 id로 찾기 때문에 `key`를 받지 않는다.

### 오류 처리

- source와 target이 같은 커밋이면 diff 영역에 "두 브랜치의 내용이 같습니다" 안내를 보여준다.
- merge-base가 없으면 "두 브랜치의 공통 조상 커밋이 없습니다" 안내를 보여준다.
- localStorage에 저장된 브랜치가 목록에 없으면 처음 선택값으로 되돌리고 드롭다운 아래에 "저장된 브랜치 <이름>을 찾지 못해 기본값으로 바꿨습니다" 안내를 보여준다.

## 3. AI 리뷰

### 어댑터 구조 (`src/review/`)

- `types.ts`
  ```ts
  type ProviderId = 'claude'

  interface ReviewContext {
    repoPath: string
    comparison: { key: string; mode: 'worktree' | 'branch' | 'custom'; source?: string; target?: string; mergeBase?: string }
    sourceCheckedOut: boolean
    files: string[]
    patch: string
  }

  interface ReviewProvider {
    id: ProviderId
    label: string
    installHint: string
    loginHint: string
    detect(): Promise<{ installed: boolean; version?: string }>
    buildCommand(ctx: ReviewContext, prompt: string): { bin: string; args: string[]; stdin?: string }
    parseLine(line: string): ProgressEvent | FinalOutput | null
  }

  interface ReviewResult {
    summary: string
    findings: Finding[]
  }

  interface Finding {
    severity: 'critical' | 'major' | 'minor' | 'info'
    file: string
    line: number | null
    side: 'old' | 'new'
    title: string
    body: string
  }
  ```
- `prompt.ts`: 도구와 상관없이 같은 리뷰 지시문을 만든다.
  - 비교 대상(모드, 소스, 타겟, merge-base), 변경 파일 목록, diff 본문, 결과 JSON 형식, 한국어 작성 지시를 넣는다.
  - diff가 200,000자를 넘으면 본문을 빼고 파일 목록만 넣는다. 그리고 `git diff <target>...<source> -- <path>`로 필요한 파일을 직접 읽도록 지시한다.
  - `sourceCheckedOut`이 false이면 작업 트리 파일 대신 `git show <source>:<path>`로 파일을 읽도록 지시한다.
- `schema.ts`: `ReviewResult` JSON 스키마와 검사 함수. 응답 텍스트에서 JSON 블록을 찾는 함수도 여기에 둔다.
- `runner.ts`: 프로세스 실행, stdout 줄 단위 해석, 취소, 10분 시간 제한, 결과 검사, 결과 저장을 맡는다.
- `providers/claude.ts`, `providers/index.ts`(목록에는 Claude만 둔다)

### 도구별 실행 방식

| 도구 | 실행 명령 | 수정 차단 방법 | 결과 형식 강제 |
|---|---|---|---|
| Claude Code | `claude -p --output-format stream-json --verbose --no-session-persistence --restricted --strict-mcp-config --permission-mode dontAsk --tools Read Grep Glob Bash` | `--restricted`로 사용자/프로젝트 설정 파일과 명령 실행 도구를 제외하고 `--tools`로 쓸 수 있는 도구를 정한다. `--allowedTools Read Grep Glob "Bash(git show:*)" "Bash(git log:*)" "Bash(git diff:*)"`, `--disallowedTools Edit Write NotebookEdit WebFetch WebSearch "Bash(git * --output*)"` | `--json-schema` |

- 모든 도구는 `cwd`를 `repoPath`로 두고 실행한다.
- 구조화 결과(`structured_output`)가 없으면 최종 응답 텍스트에서 JSON 블록을 찾아 스키마 검사를 한다.

### 서버 API

- `GET /api/review/providers`: 도구별 `{ id, label, installed, version, verified, installHint, loginHint }` 목록.
- `POST /api/review`: 본문 `{ provider, key, mode, source?, target?, staged?, untracked? }`. 작업 id를 돌려준다. 같은 조합과 같은 도구로 실행 중인 작업이 있으면 그 id를 돌려준다.
- `GET /api/review/:id/events`: SSE.
  - `progress`: 한 줄 상태 문구(예: "src/git.ts 읽는 중")
  - `done`: `ReviewResult`와 메타데이터
  - `error`: `{ kind: 'not_installed' | 'auth' | 'timeout' | 'invalid_output' | 'process', message, rawOutput? }`
- `DELETE /api/review/:id`: 실행 중인 프로세스를 종료한다.
- `GET /api/review?key=<조합 키>`: 저장된 마지막 리뷰를 돌려준다.

### 결과 저장

- `~/.config/diffx/reviews/<repoPath의 sha1>/<조합 키의 sha1>.json`에 저장한다.
- 저장 내용: `provider`, `createdAt`, `sourceSha`, `targetSha`(작업 중 변경사항 모드는 `patchHash`), `result`.
- 조합 키마다 마지막 리뷰 하나만 남긴다.

### 우측 사이드탭 (`ReviewPanel`)

- Toolbar 오른쪽 `AI 리뷰` 버튼 클릭 시 열리고 다시 클릭하면 닫힌다. 왼쪽 파일 트리 사이드바와 같은 방식(`react-resizable`)으로 폭을 조절한다. 열림 상태와 폭은 localStorage에 저장한다.
- 도구 선택 드롭다운은 두지 않는다. `claude` CLI가 설치돼 있지 않으면 `리뷰 요청` 버튼을 비활성으로 두고 설치 안내 링크를 보여준다.
- 상태별 화면
  - 리뷰 없음: `리뷰 요청` 버튼
  - 실행 중: 진행 상태 한 줄, 경과 시간, `취소` 버튼
  - 완료: 도구 이름과 리뷰 시각, 요약, 심각도 순으로 정렬한 지적 목록, `다시 리뷰` 버튼
  - 오류: 오류 종류별 안내 문구와 `다시 리뷰` 버튼
- 지적 항목 클릭 시 해당 파일 카드로 스크롤되고 해당 라인에 강조 배경이 2초 동안 표시된다. `line`이 null이면 파일 카드로만 스크롤된다.
- 저장된 리뷰의 `sourceSha`/`targetSha`(또는 `patchHash`)가 현재와 다르면 "리뷰 이후 코드가 바뀌었습니다" 안내를 요약 위에 보여준다.

### 오류 안내 문구

- `not_installed`: "<도구 이름>이 설치돼 있지 않습니다" 와 설치 안내 링크
- `auth`: "<도구 이름> 로그인이 필요합니다. 터미널에서 `<로그인 명령>`을 실행해 주세요"
  - 로그인 명령: `claude`
- `timeout`: "10분 안에 리뷰가 끝나지 않아 중단했습니다"
- `invalid_output`: "리뷰 결과를 읽지 못했습니다" 와 도구가 돌려준 텍스트
- `process`: 종료 코드와 stderr 마지막 20줄

## 4. 데스크톱 앱

### 실행 흐름

1. 앱 실행 시 저장소 선택 창이 열린다. `폴더 열기` 버튼과 최근 연 저장소 목록(최대 10개)이 있다.
2. 폴더 선택 시 `git rev-parse --show-toplevel`로 저장소 루트를 찾는다. 실패하면 선택 창에 "git 저장소가 아닙니다" 안내를 보여준다.
3. 성공하면 main 프로세스가 `startServer({ repoPath, port, host: '127.0.0.1', token })`로 서버를 띄우고 새 창에서 그 주소를 연다. 창 제목은 저장소 이름이다.
   - `port`는 최근 저장소 목록에 기록해 둔 그 저장소의 마지막 포트를 먼저 쓰고 사용 중이면 빈 포트를 쓴다. localStorage는 origin(포트 포함)별로 저장되기 때문에 포트가 매번 바뀌면 브랜치 선택과 사이드바 상태가 다음 실행 때 적용되지 않는다.
4. 이미 열린 저장소를 다시 열면 새 창을 만들지 않고 기존 창을 앞으로 가져온다.
5. 창을 닫으면 그 창의 서버와 실행 중인 리뷰 프로세스를 종료한다.
6. 모든 창을 닫아도 앱은 Dock에 남는다. Dock 아이콘 클릭 시 저장소 선택 창이 열린다.

### 메뉴와 단축키

- `파일 > 저장소 열기` (`Cmd+O`)
- `파일 > 최근 저장소` 하위 메뉴
- `보기 > 새로고침` (`Cmd+R`): diff를 다시 불러온다.
- Finder에서 폴더를 Dock의 앱 아이콘으로 끌어다 놓으면 그 저장소를 연다(`open-file` 이벤트).

### macOS 환경 처리

- 앱 시작 시 `$SHELL -ilc 'printf %s "$PATH"'` 결과를 `process.env.PATH`에 넣는다. 5초 안에 응답이 없으면 기존 PATH에 `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`을 붙인다.
- 최근 저장소 목록은 `app.getPath('userData')/recent.json`(`~/Library/Application Support/diffx/recent.json`)에 저장한다. 항목마다 `path`, `name`, `port`, `openedAt`을 기록한다.

### 보안

- 서버는 `127.0.0.1`에만 바인딩한다.
- 앱에서 띄운 서버는 창마다 무작위 토큰을 만든다. `/api/*` 요청은 `X-Diffx-Token` 헤더를 검사하고 맞지 않으면 403을 돌려준다. 같은 맥의 브라우저에서 다른 웹페이지가 서버로 요청을 보내 리뷰를 실행하는 경우를 막기 위해서다.
- 헤더는 main 프로세스가 `session.webRequest.onBeforeSendHeaders`로 해당 창의 서버 주소 요청에 붙인다. `<img src>`와 `EventSource`는 요청 헤더를 직접 넣을 수 없어서 UI 코드에서 토큰을 다루지 않는다.
- CLI 실행 시에는 토큰 검사를 하지 않는다. 지금처럼 동작한다.
- 창 설정: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. 저장소 선택 창의 preload는 `selectFolder()`, `openRepo(path)`, `getRecent()`만 노출한다. diff 창에는 preload를 두지 않는다.

### 빌드와 배포

- `electron/` 코드는 `tsdown`으로 번들링한다.
- `electron-builder`로 arm64 `.app`을 만들고 ad-hoc 서명(`identity: "-"`)한 뒤 `diffx-<버전>-arm64.zip`으로 묶는다.
- 스크립트
  - `pnpm run build:app`: UI 빌드, 서버와 electron 번들링, `.app`과 zip 생성
  - `pnpm run dev:app`: UI와 electron 코드를 빌드한 뒤 Electron을 실행한다. 창마다 서버 포트가 달라 vite 개발 서버의 `/api` 프록시(3433 고정)를 쓸 수 없다. UI를 수정하며 확인할 때는 기존 `dev:client`, `dev:server` 스크립트를 쓴다. 개발 서버와 앱은 사용자가 직접 실행한다.
- 앱 아이콘은 diffx 아이콘을 새로 만들어 `.icns`로 넣는다.
- README에 설치 방법을 적는다: zip을 풀어 `/Applications`로 옮기고 처음 한 번 우클릭 후 `열기`를 누르거나 `xattr -dr com.apple.quarantine /Applications/diffx.app`을 실행한다.

## 5. 테스트

- `vitest`를 추가한다.
- git 함수: 테스트마다 임시 저장소를 만든다. 그리고 브랜치 목록, 기본 타겟 판별, `target...source` diff, 잘못된 ref 거부를 확인한다.
- 서버 API: `createApp`에 임시 저장소를 넘겨 `/api/branches`, `/api/diff?mode=branch`, 조합 키별 코멘트 분리, 토큰 검사를 확인한다.
- 리뷰 어댑터: 도구마다 실제 CLI 출력 예시를 `src/review/__fixtures__/`에 저장한다. 그리고 명령 인자 구성, 줄 단위 이벤트 해석, 결과 변환, JSON 블록 추출, 스키마 검사 실패 처리를 확인한다.
- 리뷰 실행기: 가짜 CLI 스크립트로 취소, 시간 초과, 비정상 종료를 확인한다.
- 실제 실행 확인: 설치돼 있고 로그인된 도구로 이 저장소를 대상으로 리뷰를 한 번 실행한다.
- 앱: `pnpm run build:app`으로 만든 `.app`을 실행해 저장소 열기, 브랜치 비교, fetch, 리뷰 요청, 창 닫을 때 서버 종료까지 직접 확인한다.

## 구현 순서

1. `git.ts`와 `server.ts`의 repoPath 인자화, vitest 추가
2. 브랜치 비교 (서버 API, 조합 키, UI)
3. AI 리뷰 (어댑터, 실행기, API, 우측 사이드탭)
4. 데스크톱 앱 (Electron main, 저장소 선택 화면, 토큰, 빌드)
