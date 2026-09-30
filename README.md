# diffx

A local code review tool designed for the coding agent workflow. Review AI-generated changes in a GitHub PR-like web UI, leave inline comments, then hand them back to your coding agent to fix.

![screenshot](https://raw.githubusercontent.com/wong2/diffx/main/screenshot.png)

## macOS 데스크톱 앱

터미널 없이 diffx를 실행하는 앱(reviewHelper)이다. Apple Silicon(arm64) 맥에서 동작한다.

### 설치

1. `reviewHelper-<버전>.zip`을 풀고 `reviewHelper.app`을 `/Applications`로 옮긴다.
2. Apple 공증을 받지 않은 앱이라 처음 실행 시 Gatekeeper가 막는다. 아래 중 하나를 한 번만 하면 된다.
   - Finder에서 `reviewHelper.app`을 우클릭하고 `열기`를 누른 뒤 경고 창에서 다시 `열기`를 누른다.
   - 터미널에서 `xattr -dr com.apple.quarantine /Applications/reviewHelper.app`을 실행한다.

### 사용

- 앱 실행 시 저장소 선택 창이 열린다. `폴더 열기`로 git 저장소를 고르거나 최근 저장소를 누른다.
- 저장소마다 창이 따로 열린다. `파일 > 저장소 열기`(`Cmd+O`)로 다른 저장소를 연다.
- Finder에서 저장소 폴더를 Dock의 reviewHelper 아이콘으로 끌어다 놓아도 열린다.
- AI 리뷰는 Claude Code(`claude`)로 실행된다. `claude`가 설치돼 있고 로그인돼 있어야 한다.

### GitLab MR 리뷰

`MR` 탭에서 현재 저장소의 GitLab MR을 골라 diff를 보고 코멘트를 남긴다.

1. glab을 설치하고 사내 GitLab에 로그인한다.
   ```bash
   brew install glab
   glab auth login --hostname gitlab.example.com
   ```
2. 앱에서 저장소를 열고 툴바의 `MR` 탭을 클릭한다. 원격 저장소가 GitLab이 아니거나 glab 로그인이 안 되어 있으면 `MR` 버튼이 비활성으로 보이고 마우스를 올리면 이유가 나온다.
3. MR 선택 드롭다운에서 MR을 고르면 그 MR의 diff가 열린다. 드롭다운의 `전체 / 열린 MR / 머지된 MR` 버튼과 `내가 올린 MR` 체크박스로 목록을 좁힌다.
4. diff 줄에 남긴 코멘트와 기존 코멘트의 답글은 GitLab에 초안으로 저장된다. 툴바의 `리뷰 제출` 클릭 시 초안이 모두 공개된다.

`브랜치 비교` 탭에서 남긴 코멘트는 GitLab에 보내지 않고 앱 안에서만 보인다.

#### MR 코드 로컬에서 실행하기

MR 모드 툴바의 MR 제목 옆 버튼으로 MR 코드를 리뷰용 worktree에 체크아웃하고 터미널을 연다.

1. `체크아웃` 클릭 시 MR 소스 브랜치의 최신 커밋이 `~/.config/diffx/worktrees/<저장소명>-<해시>` 폴더에 detached HEAD로 체크아웃된다. 원본 저장소의 브랜치와 작업 중인 파일은 바뀌지 않는다.
2. 원본 저장소의 gitignore된 `.env*` 파일 중 worktree에 없는 파일이 복사된다. worktree에서 수정한 env 파일은 덮어쓰지 않는다.
3. `터미널에서 열기` 클릭 시 설정한 터미널 앱이 worktree 폴더에서 열린다. 터미널에서 `pnpm install`, `pnpm dev`를 직접 실행한다.
4. 다른 MR에서 `체크아웃`을 누르면 같은 폴더에서 커밋만 바뀐다. `node_modules`는 그대로 남고 실행 중인 개발서버에 변경이 반영된다.
5. worktree에서 git에 등록된 파일을 수정한 상태로 체크아웃하면 변경된 파일 목록이 나온다. `변경사항을 버리고 체크아웃` 클릭 시 수정 내용을 버리고 체크아웃한다.
6. `worktree 삭제` 클릭 후 `삭제`를 누르면 worktree 폴더가 삭제된다. 이 폴더에서 실행 중인 개발서버를 먼저 종료한다.

터미널 앱은 툴바 설정 팝오버의 `Terminal` input에 `/Applications`의 앱 이름(`iTerm`, `Warp`, `Ghostty`)으로 입력한다. 비워 두면 `Terminal`을 쓴다.

### 코드 하이퍼링크

diff 코드에서 Cmd를 누른 채 import 경로나 이름을 클릭하면 정의 위치로 이동한다. `.ts .tsx .js .jsx .mjs .cjs .vue` 파일이 대상이다.

- 정의 파일이 diff에 있으면 그 파일 카드의 해당 줄로 스크롤한다. 없으면 가운데 창에서 파일 내용을 연다. 창 안에서도 Cmd+클릭으로 계속 이동하고 `뒤로`로 돌아간다.
- 같은 이름의 선언이 여러 곳이면 오른쪽 패널의 `코드 탐색` 탭에 후보 목록이 나온다.
- 정의 자리(선언한 이름)를 Cmd+클릭하면 `코드 탐색` 탭에 사용처 목록이 나온다. 다른 파일은 이 정의 파일을 import한 경우만 사용처로 본다.
- diff 카드나 가운데 창 헤더의 파일 경로를 Cmd+클릭하면 그 파일을 import하는 곳이 나온다.
- 목록 항목을 클릭하면 그 줄로 이동하고 목록은 그대로 남는다. 최대 200곳까지 보여준다.
- 브랜치 비교와 MR에서는 소스 커밋(삭제 줄은 기준 커밋)의 코드에서 찾는다.
- `obj.method`의 `method`처럼 `.` 뒤의 이름은 이동하지 않는다. 같은 파일 안에서 이름이 같은 지역 변수, 주석과 문자열 안의 같은 단어도 사용처로 나온다.

### 직접 빌드

```bash
pnpm install
pnpm run build:app
```

`release/reviewHelper-<버전>.zip`이 만들어진다. 버전은 `package.json`의 `version` 값이다.

## 개발

| 명령 | 용도 |
|---|---|
| `pnpm run dev:app` | UI와 Electron 코드를 빌드하고 데스크톱 앱을 띄운다. 코드를 고치면 앱을 다시 실행해야 반영된다 |
| `pnpm run dev:server` | 현재 폴더의 저장소로 3433 포트에 개발용 서버를 띄운다. 브라우저는 열지 않는다 |
| `pnpm run dev:client` | vite 개발 서버를 띄운다. `/api` 요청을 `dev:server`로 넘기며, UI 코드를 저장하면 브라우저에 바로 반영된다 |
| `pnpm run build:app` | 배포용 `.app`과 zip을 만든다 |
| `pnpm test` | 테스트를 실행한다 |

UI를 고칠 때는 터미널 두 개에서 `dev:server`와 `dev:client`를 함께 띄우고 vite가 출력한 주소를 브라우저로 연다.

## Features

- **Split / Unified view** — Toggle between side-by-side and inline diff
- **Syntax highlighting** — Powered by Shiki with GitHub themes
- **File tree** — Hierarchical file browser with search filter and file change-type icons
- **Inline comments** — Click the `+` button on any line to add a review comment
- **Comment replies** — AI agents can reply to comments via API, displayed with bot avatar in the UI
- **Comment status tracker** — Sidebar widget showing open, replied, and resolved comment counts with click-to-navigate links
- **Image preview** — Side-by-side comparison for added, modified, and deleted images
- **Viewed tracking** — Mark files as reviewed to track progress
- **EditorConfig support** — Respects `.editorconfig` for per-file tab size
- **Persistent settings** — Your preferences are saved across sessions

## License

MIT
