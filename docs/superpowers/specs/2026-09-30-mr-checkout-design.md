# MR 체크아웃과 터미널 열기 설계

## 목적

MR 모드에서 리뷰어가 MR 코드를 로컬에서 실행해 볼 수 있게 한다. 앱은 MR 소스 브랜치의 head 커밋을 리뷰용 worktree에 체크아웃하고, 그 경로에서 터미널 앱을 연다. `pnpm install`, `pnpm dev` 같은 명령은 리뷰어가 터미널에서 직접 실행한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 체크아웃 대상 | MR 소스 브랜치의 head 커밋(`diff_refs.head_sha`) |
| 체크아웃 위치 | 원본 저장소가 아닌 별도 worktree. 리뷰어가 작업 중인 코드와 MR 코드가 서로 영향을 주지 않게 한다 |
| worktree 경로 | `~/.config/diffx/worktrees/<저장소명>-<저장소 경로 해시 8자리>` |
| worktree 개수 | 저장소당 하나. 다른 MR을 체크아웃하면 같은 폴더에서 커밋만 바뀐다 |
| 체크아웃 형태 | detached HEAD. 로컬 브랜치를 만들거나 바꾸지 않는다 |
| worktree 변경사항 | 변경된 파일 목록을 보여주고 리뷰어가 버리기를 확인하면 체크아웃한다 |
| env 파일 | 원본 저장소의 gitignore된 `.env*` 파일 중 worktree에 없는 파일만 복사한다 |
| 개발서버 실행 | 앱이 실행하지 않는다. 리뷰어가 터미널 앱에서 실행한다 |
| 터미널 앱 | 설정 `terminalApp`. 기본값은 `Terminal` |
| worktree 삭제 | 체크아웃 영역의 `worktree 삭제` 버튼으로 리뷰어가 직접 삭제한다 |

앱 안에 터미널 화면을 넣는 방식은 쓰지 않는다. `node-pty` 네이티브 모듈을 앱에 포함하도록 빌드 설정을 바꿔야 하고, 셸과 주고받을 WebSocket 통로와 셸 하위 프로세스 종료 처리가 필요해서 구현량이 크다.

## 1. 전체 구조

```
src/
├─ gitlab/
│  └─ reviewWorktree.ts   (신규) worktree 경로 계산, 생성, 체크아웃, env 복사, 삭제
├─ settings.ts            terminalApp 추가, pick()에 terminalApp 검사 추가
├─ server.ts              체크아웃, 터미널 열기, 삭제 API 추가
└─ ui/
   ├─ components/MrCheckout.tsx   (신규) 체크아웃 영역
   ├─ components/Toolbar.tsx      MR 모드에서 MrCheckout 배치, 설정 팝오버에 Terminal input 추가
   └─ hooks/useReviewWorktree.ts  (신규) worktree 상태 조회와 변경
```

## 2. 리뷰용 worktree (`src/gitlab/reviewWorktree.ts`)

### 경로

- `~/.config/diffx/worktrees/<저장소명>-<해시>`
- 저장소명은 `getRepoName(repoPath)`, 해시는 원본 저장소 절대 경로의 sha256 앞 8자리다. 이름이 같은 저장소가 여러 개 있어도 폴더가 겹치지 않는다.
- 경로는 항상 서버가 계산한다. API 요청으로 경로를 받지 않는다.

### 상태 조회

- 폴더가 없으면 `{ exists: false }`를 돌려준다.
- 폴더가 있으면 `git -C <worktree> rev-parse HEAD`로 현재 커밋을 읽어 `{ exists: true, path, headSha }`를 돌려준다.

### 체크아웃

입력: MR 상세(`MrDetail`), `force` 여부.

1. 기존 `ensureMrCommits`로 MR head 커밋이 원본 저장소에 있는지 확인하고 없으면 fetch한다. 원격은 `MrComparisons.resolve`와 같은 방식으로 판별한다. worktree는 원본 저장소와 커밋 저장소를 공유하므로 worktree에서 따로 fetch하지 않는다.
2. 폴더가 없으면 원본 저장소에서 `git worktree prune`을 실행한 뒤 `git worktree add --detach <경로> <head_sha>`를 실행한다. prune은 리뷰어가 폴더를 직접 지워 남은 worktree 등록 정보를 정리한다.
3. 폴더가 있으면 worktree에서 `git status --porcelain --untracked-files=no`를 실행한다.
   - 출력이 있고 `force`가 아니면 변경된 파일 경로 목록과 함께 `dirty` 결과를 돌려주고 체크아웃하지 않는다.
   - 출력이 있고 `force`이면 `git checkout --force --detach <head_sha>`를 실행한다. git에 등록된 파일의 변경사항은 버려지고, 새로 만든 파일과 gitignore된 파일은 남는다.
   - 출력이 없으면 `git checkout --detach <head_sha>`를 실행한다.
4. env 파일을 복사한다.
   - 원본 저장소에서 `git ls-files --others --ignored --exclude-standard --directory`를 실행한다. `--directory`는 `node_modules` 같은 gitignore된 폴더를 폴더 이름 한 줄로 출력해서 그 안의 파일을 모두 나열하지 않게 한다.
   - 출력 중 `/`로 끝나지 않고 파일명이 `.env`로 시작하는 항목만 고른다.
   - worktree의 같은 경로에 파일이 없을 때만 복사한다. 필요한 상위 폴더는 만든다. 이미 있는 파일은 덮어쓰지 않아서 리뷰어가 worktree에서 수정한 env가 유지된다.
5. `{ path, headSha, copiedEnvFiles }`를 돌려준다. `copiedEnvFiles`는 이번에 복사한 파일의 저장소 기준 상대 경로 목록이다.

git 명령은 `GIT_TERMINAL_PROMPT=0`으로 실행하고 제한 시간은 60초다.

### 삭제

1. 폴더가 없으면 원본 저장소에서 `git worktree prune`만 실행하고 끝낸다.
2. 원본 저장소에서 `git worktree remove --force <경로>`를 실행한다. `node_modules`처럼 gitignore된 파일이 있으면 `--force` 없이는 git이 삭제를 거부한다.

## 3. 터미널 열기

- `Settings`에 `terminalApp?: string`을 추가한다. 값이 없으면 `Terminal`을 쓴다.
- `pick()`에 `terminalApp`이 문자열일 때만 받는 검사를 추가하고 앞뒤 공백을 제거해 저장한다. 리뷰어가 input을 비우면 빈 문자열이 저장되고, 터미널 열기 시 빈 문자열이면 `Terminal`을 쓴다.
- `open -a <terminalApp> <worktree 경로>`를 `execFile`로 실행한다. macOS `open` 명령이 해당 터미널 앱을 새 창으로 열고 현재 폴더를 worktree 경로로 잡는다.
- 앱을 찾지 못하면 `open`이 `Unable to find application named '<앱>'`을 stderr로 출력하고 실패한다. 이 메시지를 그대로 돌려준다.
- worktree 폴더가 없으면 `open`을 실행하지 않고 오류를 돌려준다.

## 4. 서버 API

| API | 동작 | 응답 |
|---|---|---|
| `GET /api/review-worktree` | worktree 상태 조회 | `{ exists: false }` 또는 `{ exists: true, path, headSha }` |
| `POST /api/gitlab/mrs/:iid/checkout` | 본문 `{ force?: boolean }`. MR 상세를 조회해 head 커밋을 체크아웃 | 200 `{ path, headSha, copiedEnvFiles }` |
| | worktree에 변경사항이 있고 `force`가 아님 | 409 `{ error: 'dirty', files }` |
| | MR 커밋 fetch 실패 | 502 `{ error: 'mr_fetch_failed', message }` |
| | git 명령 실패 | 502 `{ error: 'git', message }` |
| `GET /api/review-worktree/changes` | 삭제 확인용 변경된 파일 목록 조회 | `{ files }`. 폴더가 없으면 빈 목록 |
| `POST /api/review-worktree/open-terminal` | 설정의 터미널 앱으로 worktree 열기 | 204. 폴더가 없으면 404, `open` 실패 시 502 `{ message }` |
| `DELETE /api/review-worktree` | worktree 삭제 | 204. git 실패 시 502 `{ message }` |

- MR 상세는 기존 `MrComparisons.detail(iid, { refresh: true })`로 조회해서 체크아웃 시점의 최신 head를 쓴다.
- GitLab 연결이 안 된 상태(`status.available: false`)이면 체크아웃 API는 기존 MR API와 같은 오류 형태를 돌려준다.
- 서버는 git 실행부와 `open` 실행부를 `AppOptions`로 주입받는다. 테스트에서는 가짜 `open` 실행부를 넘겨 실제 터미널 앱이 열리지 않게 한다. worktree 루트 폴더(`~/.config/diffx/worktrees`)도 주입받아 테스트에서 임시 폴더를 쓴다.

## 5. UI

### 체크아웃 영역 (`MrCheckout`)

MR 모드 툴바의 MR 제목 링크(`toolbar-mr-link`) 옆에 둔다. 브랜치 비교 모드에서는 그리지 않는다. MR diff 응답의 `mr.headSha`와 `GET /api/review-worktree`의 `headSha`를 비교해 상태를 정한다.

| 상태 | 표시 |
|---|---|
| worktree 없음 | `체크아웃` 버튼 |
| worktree HEAD가 MR head와 다름 (다른 MR이 체크아웃됨, MR에 새 커밋이 push됨) | `체크아웃` 버튼, `터미널에서 열기` 버튼, `worktree 삭제` 버튼 |
| worktree HEAD가 MR head와 같음 | `체크아웃됨` 표시, `터미널에서 열기` 버튼, `worktree 삭제` 버튼 |
| 요청 처리 중 | 누른 버튼에 로딩 표시, 나머지 버튼 비활성 |

- `체크아웃됨` 표시와 `터미널에서 열기` 버튼의 `title`에 worktree 경로를 넣는다.
- `체크아웃` 클릭 후 409 응답 시 버튼 아래 팝오버에 "리뷰용 worktree에 커밋하지 않은 변경사항이 있습니다" 안내, 변경된 파일 목록, `변경사항을 버리고 체크아웃` 버튼, `취소` 버튼을 보여준다. `변경사항을 버리고 체크아웃` 클릭 시 `force: true`로 다시 요청한다.
- 체크아웃 200 응답 시 `copiedEnvFiles`가 있으면 "env 파일 N개를 복사했습니다" 안내를 버튼 아래에 5초 동안 보여준다.
- `worktree 삭제` 클릭 시 `GET /api/review-worktree/changes`로 변경된 파일을 조회한 뒤 확인 팝오버를 보여준다.
  - 문구: "리뷰용 worktree를 삭제합니다. 이 폴더에서 실행 중인 개발서버가 있으면 먼저 종료해 주세요"
  - 변경된 파일이 있으면 목록을 함께 보여준다.
  - `삭제` 클릭 시 `DELETE /api/review-worktree`를 요청하고 204 응답 시 worktree 없음 상태로 바뀐다.
- 502나 404 응답 시 버튼 아래에 서버가 돌려준 메시지를 보여준다.
- 다른 MR을 선택하면 팝오버와 안내 메시지를 닫고 worktree 상태를 다시 조회한다.

### 설정

툴바 설정 팝오버의 `Default tab size` 항목 아래에 `Terminal` input을 추가한다. placeholder는 `Terminal`이다. 입력값은 `PUT /api/settings`로 `terminalApp`에 저장한다. iTerm, Warp, Ghostty처럼 `/Applications`의 앱 이름을 넣는다.

## 6. 테스트

- `reviewWorktree.ts`와 서버 API는 기존 `src/test/mrRepo.ts` 임시 저장소와 가짜 glab으로 확인한다. worktree 루트는 임시 폴더를 주입한다.
  - 첫 체크아웃 시 worktree가 생기고 HEAD가 MR head다.
  - 다른 MR을 체크아웃하면 같은 폴더에서 HEAD가 바뀐다.
  - worktree에서 git에 등록된 파일을 수정하면 409와 파일 목록이 오고 HEAD가 바뀌지 않는다. `force: true`로 다시 요청하면 체크아웃되고 수정 내용이 사라진다.
  - 원본 저장소의 gitignore된 `.env.local`과 하위 폴더의 `.env`가 복사되고 `copiedEnvFiles`에 담긴다. worktree에 이미 있는 `.env.local`은 덮어쓰지 않는다. `node_modules` 안의 `.env` 파일은 복사되지 않는다.
  - worktree 폴더를 직접 지운 뒤 체크아웃하면 worktree가 다시 생긴다.
  - gitignore된 `node_modules` 폴더가 있는 worktree를 삭제하면 폴더와 worktree 등록 정보가 모두 사라진다.
  - 저장소명이 같고 경로가 다른 두 저장소의 worktree 경로가 다르다.
- 터미널 열기는 가짜 `open` 실행부로 `['-a', <설정한 앱>, <worktree 경로>]` 인자와 설정이 없을 때 `Terminal`이 쓰이는지 확인한다. worktree가 없을 때 404를 확인한다.
- `MrCheckout`의 상태 결정은 worktree 상태와 MR head를 입력으로 받는 함수로 분리해 단위테스트로 확인한다.
- 실제 확인: 사용자가 앱에서 사내 GitLab MR 하나로 체크아웃, 터미널 열기, `pnpm install`, `pnpm dev` 실행, 다른 MR 체크아웃, worktree 삭제를 직접 실행한다.

## 7. 문서

README의 GitLab MR 리뷰 사용법 아래에 체크아웃, 터미널 열기, worktree 경로, 삭제 방법을 추가한다.

## 구현 순서

1. `reviewWorktree.ts` 경로 계산, 상태 조회, 체크아웃, env 복사, 삭제
2. 서버 API와 `terminalApp` 설정
3. `MrCheckout`, `useReviewWorktree`, 설정 팝오버
4. README
