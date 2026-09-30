# diffx

A local code review tool designed for the coding agent workflow. Review AI-generated changes in a GitHub PR-like web UI, leave inline comments, then hand them back to your coding agent to fix.

![screenshot](https://raw.githubusercontent.com/wong2/diffx/main/screenshot.png)

## Install

```bash
npm install -g diffx-cli
```

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

### 직접 빌드

```bash
pnpm install
pnpm run build:app
```

`release/reviewHelper-<버전>.zip`이 만들어진다. 버전은 `package.json`의 `version` 값이다.

## Usage

Run in any git repository:

```bash
diffx
```

This starts a local server and opens your browser with a diff review UI.

### Options

```
diffx [options] [-- <git-diff-args>]

Options:
  -p, --port <port>   Server port (default: 3433)
  --no-open           Don't auto-open browser

Examples:
  diffx                          # Review working tree changes
  diffx -p 8080                  # Use custom port
  diffx -- HEAD~3                # Diff against 3 commits ago
  diffx -- main..HEAD            # Diff between branches
  diffx -- --cached -- src/      # Staged changes in src/
```

## Features

- **Split / Unified view** — Toggle between side-by-side and inline diff
- **Syntax highlighting** — Powered by Shiki with GitHub themes
- **File tree** — Hierarchical file browser with search filter and file change-type icons
- **Inline comments** — Click the `+` button on any line to add a review comment
- **Comment replies** — AI agents can reply to comments via API, displayed with bot avatar in the UI
- **Comment status tracker** — Sidebar widget showing open, replied, and resolved comment counts with click-to-navigate links
- **Copy comments** — One-click copy all comments as structured XML for AI coding agents
- **Image preview** — Side-by-side comparison for added, modified, and deleted images
- **Viewed tracking** — Mark files as reviewed to track progress
- **Staged / Untracked toggles** — Choose which changes to include
- **Custom diff commands** — Pass any `git diff` arguments after `--`
- **EditorConfig support** — Respects `.editorconfig` for per-file tab size
- **Persistent settings** — Your preferences are saved across sessions

## Comment Output Format

When you click "Copy comments", the output is structured XML optimized for AI agents:

```xml
<code-review-comments>
<file path="src/utils/parser.ts">
<comment line="42">
<code>+ const parsedToken = tokenize(input)</code>
Rename `x` to `parsedToken` for clarity.
</comment>
<comment line="15">
<code>- if (input != null) {</code>
This null check removal may cause a bug when `input` is undefined.
</comment>
</file>
</code-review-comments>
```

Each comment includes the commented code line with a `+`/`-` prefix indicating whether it's an added or removed line.

## Agent Skills

Install the diffx skills to use diffx directly from your AI coding agent:

```bash
npx skills add wong2/diffx
```

The review workflow uses two commands:

1. **`/diffx-start-review`** — Launches the diffx server and opens the browser. Review your changes and leave inline comments.
2. **`/diffx-finish-review`** — The agent fetches all comments from the running diffx server via API, applies the requested changes, and marks each comment as resolved. The browser UI updates in real time as comments are resolved.

## License

MIT
