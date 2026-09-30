# 작업 중 변경사항 모드와 CLI 제거 설계

## 목적

앱 사용자가 CLI를 몰라도 되도록 사용자용 CLI(`diffx` 명령)를 없애고, 앱에서 `작업 중 변경사항`(작업 트리 diff) 모드를 제거한다. 앱은 `브랜치 비교`와 `MR` 모드만 남긴다. 개발에 필요한 스크립트는 남긴다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| `작업 중 변경사항` 모드 | 앱 화면과 서버에서 모두 제거 |
| 사용자용 CLI(`diffx` 명령, npm `bin`) | 제거 |
| custom 모드(`diffx -- <git diff 인자>`) | CLI와 함께 제거 |
| 개발 실행 스크립트 | `dev:app`, `dev:server`, `dev:client` 세 개만 남긴다 |
| 빌드와 테스트 스크립트 | `build:electron`, `build:app`, `test`, `test:watch`를 남긴다 |
| npm 배포 관련 스크립트와 설정 | 제거 |
| 앱의 첫 화면 | `브랜치 비교`. 소스는 현재 브랜치, 타겟은 기본 브랜치 |

## 1. 스크립트와 패키지 설정

- `package.json` 스크립트는 다음만 남긴다.

| 스크립트 | 명령 |
|---|---|
| `dev:app` | `pnpm run build:electron && electron .` (지금과 같다) |
| `dev:server` | `tsx src/devServer.ts` |
| `dev:client` | `vite` (지금과 같다) |
| `build:electron` | `vite build && tsdown` (지금과 같다) |
| `build:app` | `pnpm run build:electron && electron-builder --mac zip --arm64` (지금과 같다) |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

- 삭제: 스크립트 `build`, `prepublishOnly`, `release`, `changeset`, `version-packages`, `package.json`의 `bin`과 `files`, 의존성 `open`, `get-port`, `@changesets/cli`, `@changesets/changelog-git`, `.changeset/` 폴더, `tsdown.config.ts`의 `src/cli.ts` 항목, `src/cli.ts`
- `src/devServer.ts`(신규): 개발용 서버. 명령을 실행한 폴더의 git 저장소 루트로 `127.0.0.1:3433`에 서버를 띄우고 주소를 출력한다. 브라우저는 열지 않는다. 토큰은 쓰지 않는다. git 저장소가 아니면 오류를 출력하고 종료 코드 1로 끝낸다. `SIGINT`, `SIGTERM` 입력 시 서버를 닫고 끝낸다. `dev:client`의 `/api` 프록시(3433)가 이 서버를 가리킨다.

## 2. 앱 화면

- 모드 탭이 `브랜치 비교 / MR` 두 개가 된다.
- 저장소를 처음 열면 `브랜치 비교` 기본값(소스: 현재 브랜치, 타겟: `defaultTarget`)으로 시작한다. 기존 `defaultBranchComparison`을 그대로 쓴다.
- localStorage에 저장된 비교 조합이 `{ mode: 'worktree' }`이면 저장된 값이 없는 것으로 보고 브랜치 비교 기본값을 쓴다.
- 저장된 MR을 여는데 glab을 쓸 수 없으면 브랜치 비교 기본값으로 돌아가고 드롭다운 아래에 이유를 보여준다.
- 브랜치 목록 조회에 실패하면 `MR` 탭(MR 미선택 상태)으로 시작하고 모드 탭 아래 안내 줄에 "브랜치 목록을 불러오지 못했습니다: <오류>"를 보여준다. `브랜치 비교` 탭은 브랜치 목록이 없어 기존처럼 비활성이다.
- 툴바 설정 메뉴에서 `Show staged`, `Show untracked`, `Browser`를 뺀다. `Browser`는 CLI가 여는 브라우저를 고르는 설정이었다.
- 파일 트리의 untracked 아이콘과 바이너리 파일의 `untracked` 표시를 뺀다.
- custom 모드 분기(`repo.customMode`로 모드 탭을 그리지 않던 처리)를 뺀다.

## 3. 서버

- `/api/diff`, `/api/file-content`, `/api/file-versions`, `/api/review`, `/api/definition`은 `mode=branch`, `mode=mr`만 받는다. 그 외에는 400 `{ error: 'missing_mode', message: '비교 방식을 선택해 주세요' }`를 돌려준다. 기존 `ComparisonError`에 `missing_mode` 코드를 추가한다.
- `/api/repo` 응답에서 `customMode`를 뺀다.
- `key` 없이 `/api/comments`, `/api/viewed`를 부르면 마지막으로 `/api/diff`가 응답한 조합을 쓴다. `/api/diff`가 한 번도 응답하지 않았으면 빈 목록을 돌려준다.
- 삭제
  - `AppOptions`의 `customDiffArgs`, `diffCwd`와 서버 안의 custom 모드 분기
  - `comparison.ts`의 worktree와 custom 분기, `comparisonKey`의 두 분기, `ResolvedComparison.mode`의 `'worktree' | 'custom'`
  - `git.ts`: `getGitDiff`, untracked 파일 diff 생성, `getUntrackedFilePaths`, 이 함수들만 쓰는 `isBinaryFile`, `getCustomGitDiff`, `getFileContent`
  - `/api/diff` 응답의 `untrackedFiles`, `customMode`, `BinaryFileInfo.type`의 `'untracked'`
  - `/api/file-versions`의 작업 트리 파일 읽기 fallback. 브랜치와 MR 모드의 blob은 모두 커밋에 있다
  - `/api/definition`의 작업 트리 reader와 `HEAD` reader 분기
  - `settings.ts`와 UI 설정의 `staged`, `untracked`, `browser`. 이미 저장된 `~/.config/diffx/settings.json`에 이 값들이 남아 있어도 읽을 때 무시한다
- 남기는 것
  - `src/definition/reader.ts`의 `worktreeReader`. 정의 찾기 테스트가 임시 저장소를 이 reader로 읽는다
  - 토큰이 없는 서버를 위한 Origin과 Content-Type 검사. 개발용 서버가 토큰 없이 뜬다

## 4. AI 리뷰

- `ReviewContext.mode`를 `'branch'`만 남기고 `customArgs`, `staged`를 뺀다.
- 프롬프트의 작업 트리와 custom 모드 안내 문구, `diffCommand`의 두 분기를 뺀다.
- 설치 확인용 `PROBE_CONTEXT`를 브랜치 모드 값으로 바꾼다.
- `/api/review` 요청 본문의 `staged`, `untracked`를 뺀다.

## 5. 테스트

- 작업 트리 모드와 custom 모드를 쓰던 기존 테스트는 브랜치 모드로 바꾸거나 지운다. `getGitDiff`, `getCustomGitDiff` 테스트는 지운다.
- 새로 확인할 것
  - `mode` 없는 `/api/diff`, `/api/file-content`, `/api/definition` 요청이 400 `missing_mode`를 돌려준다
  - UI `loadComparison`이 저장된 `worktree`를 무시하고, `reconcileComparison`이 저장값이 없을 때 브랜치 비교 기본값을 돌려준다
  - `reconcileMrAvailability`가 glab을 쓸 수 없을 때 브랜치 비교 기본값으로 돌아간다
  - `loadSettings`가 저장 파일의 `staged`, `untracked`, `browser`를 결과에 넣지 않는다
  - 개발용 서버가 git 저장소가 아닌 폴더에서 종료 코드 1로 끝난다 (`tsx src/devServer.ts`를 자식 프로세스로 실행)

## 6. 문서

- README에서 npm 설치(`Install`), CLI 사용법(`Usage`, `Options`), `Agent Skills` 섹션을 지운다. `Features`의 `Staged / Untracked toggles`, `Custom diff commands` 항목을 지운다.
- README에 `개발` 섹션을 두고 `dev:app`, `dev:server` + `dev:client`, `build:app`, `test`의 용도를 적는다.
- 기존 spec과 계획 문서는 고치지 않는다. 당시 결정을 기록한 문서이기 때문이다.

## 구현 순서

1. 서버: 비교 조합, 설정, git 함수, API
2. AI 리뷰
3. CLI 제거와 개발용 서버, `package.json`, `tsdown.config.ts`
4. UI: 비교 조합, 모드 탭, 설정 메뉴, 파일 트리
5. README
