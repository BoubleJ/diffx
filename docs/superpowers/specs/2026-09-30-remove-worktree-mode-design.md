# 작업 중 변경사항 모드 제거 설계

## 목적

앱과 CLI에서 `작업 중 변경사항`(작업 트리 diff) 모드를 제거한다. 앱은 `브랜치 비교`와 `MR` 모드만, CLI는 `--` 뒤 git diff 인자로 여는 custom 모드만 남긴다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 제거 범위 | 앱 화면, 서버, CLI 모두 |
| 인자 없는 CLI 실행 | 사용법을 출력하고 종료 코드 1로 끝낸다 |
| custom 모드(`diffx -- <git diff 인자>`) | 지금과 같다 |
| 앱의 첫 화면 | `브랜치 비교`. 소스는 현재 브랜치, 타겟은 기본 브랜치 |

## 1. CLI

- `diffx`를 `--` 뒤 인자 없이 실행하면 도움말을 stdout에 출력하고 종료 코드 1로 끝낸다. 서버를 띄우지 않는다.
- `diffx --help`, `diffx --version`은 지금과 같다.
- 도움말의 사용법과 예시를 다음으로 바꾼다.

```
Usage: diffx [options] -- <git diff args>

Examples:
  diffx -- HEAD                Review uncommitted changes
  diffx -- --staged            Review staged changes
  diffx -- HEAD~3              Review last 3 commits
  diffx -- main..feature       Compare branches
  diffx --host 0.0.0.0 -- HEAD Allow other machines on the LAN to review
```

## 2. 앱 화면

- 모드 탭이 `브랜치 비교 / MR` 두 개가 된다.
- 저장소를 처음 열면 `브랜치 비교` 기본값(소스: 현재 브랜치, 타겟: `defaultTarget`)으로 시작한다. 기본값을 정하는 기존 `defaultBranchComparison`을 그대로 쓴다.
- localStorage에 저장된 비교 조합이 `{ mode: 'worktree' }`이면 저장된 값이 없는 것으로 보고 브랜치 비교 기본값을 쓴다.
- 저장된 MR을 여는데 glab을 쓸 수 없으면 브랜치 비교 기본값으로 돌아가고 드롭다운 아래에 이유를 보여준다.
- 브랜치 목록 조회에 실패하면 diff 영역에 "브랜치 목록을 불러오지 못했습니다: <오류>"를 보여준다. 모드 탭은 그대로 그리고 `MR` 탭은 사용할 수 있다.
- 툴바 설정 메뉴에서 `Show staged`, `Show untracked`를 뺀다.
- 파일 트리의 untracked 아이콘과 바이너리 파일의 `untracked` 표시를 뺀다.
- CLI의 custom 모드 화면은 지금처럼 모드 탭 없이 그린다. UI의 비교 조합 타입에 `{ mode: 'custom' }`을 두고, 요청 쿼리는 비워서 보낸다(서버가 custom 인자로 diff를 만든다).

## 3. 서버

- `/api/diff`, `/api/file-content`, `/api/file-versions`, `/api/review`, `/api/definition`은 `mode=branch`, `mode=mr`, custom 모드만 받는다.
  - custom 모드가 아니고 `mode`가 `branch`나 `mr`가 아니면 400 `{ error: 'missing_mode', message: '비교 방식을 선택해 주세요' }`를 돌려준다. 기존 `ComparisonError`에 `missing_mode` 코드를 추가한다.
- `key` 없이 `/api/comments`, `/api/viewed`를 부르면 custom 모드에서는 custom 조합을, 그 외에는 마지막으로 `/api/diff`가 응답한 조합을 쓴다. `/api/diff`가 한 번도 응답하지 않았으면 빈 목록을 돌려준다.
- 삭제
  - `git.ts`: `getGitDiff`, untracked 파일 diff 생성, `getUntrackedFilePaths`, 이 함수들만 쓰는 `isBinaryFile`
  - `/api/diff` 응답의 `untrackedFiles`와 `BinaryFileInfo.type`의 `'untracked'`
  - `settings.ts`와 UI 설정의 `staged`, `untracked`. 이미 저장된 `~/.config/diffx/settings.json`에 두 값이 남아 있어도 읽을 때 무시한다
  - `comparisonKey`의 `worktree` 분기와 `ResolvedComparison.mode`의 `'worktree'`
- 남기는 것
  - `/api/file-content`의 작업 트리와 `HEAD` 읽기, `/api/file-versions`의 작업 트리 읽기, `/api/definition`의 작업 트리 reader와 `HEAD` reader. custom 모드가 작업 트리 기준 diff를 만들 수 있어서 계속 쓴다.

## 4. AI 리뷰

- `ReviewContext.mode`를 `'branch' | 'custom'`으로 줄이고 `staged`를 뺀다.
- 프롬프트의 작업 트리 안내 문구(`비교 대상: 작업 트리의 커밋하지 않은 변경사항`)와 `git diff HEAD -- <경로>` 분기를 뺀다.
- 설치 확인용 `PROBE_CONTEXT`의 모드를 `'custom'`(인자 없음)으로 바꾼다.
- `/api/review` 요청 본문의 `staged`, `untracked`를 뺀다.

## 5. 테스트

- 작업 트리 모드를 쓰던 기존 테스트는 브랜치 모드나 custom 모드로 바꾸고, `getGitDiff` 테스트는 지운다.
- 새로 확인할 것
  - `mode` 없는 `/api/diff` 요청이 400 `missing_mode`를 돌려준다
  - custom 모드 서버는 `mode` 없이도 custom diff를 돌려준다
  - 인자 없는 CLI가 도움말을 출력하고 종료 코드 1로 끝난다 (`tsx src/cli.ts`를 자식 프로세스로 실행)
  - UI `loadComparison`이 저장된 `worktree`를 무시하고, `reconcileComparison`이 저장값이 없을 때 브랜치 비교 기본값을 돌려준다
  - `reconcileMrAvailability`가 glab을 쓸 수 없을 때 브랜치 비교 기본값으로 돌아간다
  - `loadSettings`가 저장 파일의 `staged`, `untracked`를 결과에 넣지 않는다

## 6. 문서

- README의 CLI 사용법과 예시를 1장의 내용으로 바꾼다.
- 기존 spec 문서는 고치지 않는다. 당시 결정을 기록한 문서이기 때문이다.

## 구현 순서

1. 서버와 CLI: 비교 조합, 설정, git 함수, API, CLI
2. AI 리뷰
3. UI: 비교 조합, 모드 탭, 설정 메뉴, 파일 트리
4. README
