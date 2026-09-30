# 자동 업데이트 설계

## 목적

reviewHelper 앱이 GitHub Release에 올라온 새 버전을 확인하고, 사용자가 동의하면 새 버전을 내려받아 설치한 뒤 다시 실행한다. 동료에게 zip을 한 번 나눠 준 뒤에는 새 버전을 다시 나눠 주지 않아도 된다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 업데이트 방식 | `electron-updater`를 쓰지 않고 직접 구현한다 |
| 배포 위치 | `BoubleJ/diffx` 저장소의 GitHub Release (public) |
| 확인 시점 | 앱 실행 시 한 번, 앱 메뉴의 `업데이트 확인...` 클릭 시 |
| 다운로드 시점 | 대화상자에서 `지금 업데이트` 클릭 시. 미리 내려받지 않는다 |
| 설치 방식 | 앱이 종료된 뒤 쉘 스크립트가 기존 `.app`을 새 `.app`으로 교체하고 다시 실행한다 |
| 태그와 Release 제목 | `v1.0.1` |
| 버전업 커밋 메시지 | `chore: v1.0.1 버전업` |
| Release 첨부 파일 | `reviewHelper-1.0.1.zip` |
| 릴리스 명령 | `pnpm run release <patch\|minor\|major>` |

`electron-updater`는 macOS에서 Squirrel.Mac으로 설치하고, Squirrel.Mac은 새 앱이 기존 앱과 같은 인증서로 서명되어 있는지 검사한다. 이 앱은 ad-hoc 서명(`identity: "-"`)만 하므로 이 검사에서 설치가 실패한다. Apple Developer ID 인증서를 쓰면 표준 방식을 쓸 수 있지만 연 $99가 들어서 쓰지 않는다.

업데이트 기능이 없는 1.0.0 앱은 자동 업데이트를 받지 못한다. 업데이트 기능이 들어간 첫 버전은 사용자가 한 번 직접 설치해야 한다.

## 1. 전체 구조

```
electron/
├─ updater/
│  ├─ version.ts    (신규) 태그 파싱과 버전 비교
│  ├─ github.ts     (신규) 최신 Release 조회
│  ├─ install.ts    (신규) zip 다운로드, 압축 해제, 새 앱 검증, 교체 스크립트 실행
│  └─ index.ts      (신규) 확인 흐름, 대화상자, Dock 진행률
├─ menu.ts          앱 메뉴에 `업데이트 확인...` 추가
└─ main.ts          실행 시 확인 호출, 메뉴에 확인 함수 연결
scripts/
└─ release.sh       (신규) 버전업, 테스트, 빌드, push, Release 생성
```

## 2. 버전 비교 (`version.ts`)

- `parseVersion(text)`는 `v1.2.3`과 `1.2.3`을 `[1, 2, 3]`으로 바꾼다. 숫자 세 개 형식이 아니면 `null`을 돌려준다. `1.2.3-beta.1` 같은 prerelease 버전은 `null`로 처리한다.
- `isNewer(latest, current)`는 두 버전을 앞자리부터 숫자로 비교해 `latest`가 크면 `true`를 돌려준다. 둘 중 하나가 `null`이면 `false`를 돌려준다.
- 현재 버전은 `app.getVersion()`으로 읽는다. 이 값은 `package.json`의 `version`이다.

## 3. Release 조회 (`github.ts`)

- `GET https://api.github.com/repos/BoubleJ/diffx/releases/latest`를 호출한다. 이 API는 draft와 prerelease를 제외한 가장 최근 Release를 돌려준다.
- 요청 헤더에 `Accept: application/vnd.github+json`과 `User-Agent: reviewHelper`를 넣는다. GitHub API는 `User-Agent`가 없는 요청을 거부한다.
- 제한 시간은 10초다.
- 응답에서 `tag_name`, `body`, `assets`를 읽는다. `assets` 중 이름이 `reviewHelper-<버전>.zip`인 항목의 `browser_download_url`을 zip url로 쓴다. `<버전>`은 태그에서 `v`를 뗀 값이다.
- 결과 형태:
  - `{ kind: 'release', version, notes, zipUrl }`: zip이 있으면 `zipUrl`에 url이 들어가고, 없으면 `null`이 들어간다.
  - `{ kind: 'none' }`: 404 응답. Release가 하나도 없을 때 GitHub이 404를 돌려준다.
  - `{ kind: 'error', message }`: 네트워크 오류, 제한 시간 초과, 404 외 오류 응답, 태그 형식이 맞지 않는 경우.
- `fetch` 함수를 인자로 받아 테스트에서 가짜 응답을 넘긴다.

인증 없이 호출하면 IP당 시간당 60번까지 호출할 수 있다. 실행 시 한 번과 메뉴 클릭 시에만 호출하므로 이 제한에 걸리지 않는다.

## 4. 확인 흐름과 대화상자 (`index.ts`)

### 확인을 하지 않는 경우

- `app.isPackaged`가 `false`이면 확인하지 않는다. `pnpm run dev:app`으로 띄운 앱이 여기에 해당한다. 메뉴의 `업데이트 확인...` 클릭 시에는 "개발 모드에서는 업데이트를 확인하지 않습니다"라고 안내한다.
- 다운로드나 설치가 진행 중이면 새 확인을 시작하지 않는다. 메뉴 클릭 시에는 "업데이트를 내려받는 중입니다"라고 안내한다.

### 실행 시 확인

`app.whenReady()` 안에서 런처 창이나 저장소 창을 연 뒤 확인을 시작한다. 확인이 끝날 때까지 기다리지 않는다.

| 결과 | 동작 |
|---|---|
| 새 버전 있음 | 업데이트 대화상자를 띄운다 |
| 최신 버전이거나 Release 없음 | 아무 안내도 하지 않는다 |
| 조회 오류 | 아무 안내도 하지 않는다 |

### 메뉴 클릭 시 확인

| 결과 | 동작 |
|---|---|
| 새 버전 있음 | 업데이트 대화상자를 띄운다 |
| 최신 버전이거나 Release 없음 | "최신 버전을 사용 중입니다 (1.0.1)" 대화상자를 띄운다 |
| 조회 오류 | "업데이트를 확인하지 못했습니다" 대화상자를 띄우고 detail에 오류 메시지를 넣는다 |

### 업데이트 대화상자

- message: "새 버전(1.0.2)을 설치할 수 있습니다"
- detail: "현재 버전: 1.0.1" 다음 줄에 Release 노트를 넣는다. Release 노트가 1500자를 넘으면 1500자까지만 넣고 `...`을 붙인다.
- 버튼: `지금 업데이트`, `나중에`. `나중에` 클릭 시 아무것도 하지 않고, 다음 실행 시 다시 확인한다.
- `zipUrl`이 `null`이면 `지금 업데이트` 대신 "이 Release에는 설치 파일이 없습니다" 대화상자를 띄운다.

### 설치를 진행할 수 없는 경우

`지금 업데이트` 클릭 시 다운로드 전에 아래를 확인한다.

- 현재 앱 경로는 `process.execPath`(`.../reviewHelper.app/Contents/MacOS/reviewHelper`)에서 세 단계 위 폴더로 구한다.
- 앱 경로에 `/AppTranslocation/`이 들어 있으면 "앱을 응용 프로그램 폴더나 다른 폴더로 옮긴 뒤 다시 실행해 주세요"라고 안내하고 멈춘다. 브라우저로 받은 zip을 풀고 옮기지 않은 채 실행하면 macOS가 앱을 읽기 전용 임시 경로에서 실행하는데, 이 경로의 앱은 교체할 수 없다.
- 앱이 있는 폴더에 쓰기 권한이 없으면(`fs.access`의 `W_OK` 실패) "앱이 있는 폴더에 쓸 수 없습니다"라고 안내하고 멈춘다.

### 진행 표시

- 다운로드 중에는 열려 있는 모든 창에 `setProgressBar(받은 크기 / 전체 크기)`를 호출한다. macOS는 이 값을 Dock 아이콘의 진행률 막대로 표시한다. 응답에 `Content-Length`가 없으면 `setProgressBar(2)`로 진행률 없는 막대를 표시한다.
- 다운로드와 압축 해제가 끝나면 `setProgressBar(-1)`로 막대를 지운다.
- 실패하면 막대를 지우고 "업데이트를 설치하지 못했습니다" 대화상자를 띄운다. detail에 오류 메시지를 넣는다. 기존 앱은 그대로 두고 계속 실행한다.

## 5. 다운로드와 교체 (`install.ts`)

### 준비

1. 작업 폴더 `<app.getPath('temp')>/reviewHelper-update-<버전>`을 새로 만든다. 같은 이름의 폴더가 있으면 먼저 지운다.
2. zip url을 `fetch`로 내려받아 작업 폴더의 `update.zip`에 저장한다. GitHub의 첨부 파일 url은 다른 호스트로 redirect하고 `fetch`가 따라간다.
3. `ditto -x -k update.zip <작업 폴더>/app`으로 압축을 푼다. `unzip` 대신 `ditto`를 쓰는 이유는 앱 번들 안의 symlink와 확장 속성을 그대로 풀기 때문이다.
4. `<작업 폴더>/app/reviewHelper.app`이 있는지 확인한다.
5. `plutil -extract CFBundleShortVersionString raw <새 앱>/Contents/Info.plist`로 새 앱 버전을 읽고 Release 버전과 같은지 확인한다. 다르면 실패로 처리한다.
6. `xattr -dr com.apple.quarantine <새 앱>`을 실행한다. Node로 내려받은 파일에는 quarantine 속성이 붙지 않지만 zip을 만든 환경에 따라 속성이 들어 있을 수 있어서 지운다. 속성이 없어 명령이 실패해도 무시한다.

### 교체

1. 교체 스크립트를 작업 폴더에 `swap.sh`로 쓴다. 스크립트 내용은 `install.ts`에 문자열로 둔다. 별도 파일로 두면 빌드 설정에서 앱 번들에 복사하는 설정을 추가해야 한다.
2. `spawn('/bin/sh', [swap.sh, <앱 pid>, <현재 앱 경로>, <새 앱 경로>, <백업 경로>], { detached: true, stdio: 'ignore' })`로 실행하고 `unref()`한다. 백업 경로는 `<작업 폴더>/backup.app`이다.
3. `app.quit()`을 호출한다. 기존 `before-quit` 처리가 저장소 창의 서버를 닫고 앱이 종료된다.

### 교체 스크립트 동작

1. `kill -0 <pid>`가 실패할 때까지 0.2초 간격으로 기다린다. 30초가 지나도 앱이 종료되지 않으면 교체하지 않고 끝낸다.
2. `mv <현재 앱> <백업 경로>`로 기존 앱을 옮긴다. 실패하면 `open <현재 앱>`으로 기존 앱을 다시 실행하고 끝낸다.
3. `mv <새 앱> <현재 앱>`으로 새 앱을 옮긴다. 실패하면 `mv <백업 경로> <현재 앱>`으로 기존 앱을 되돌리고 `open <현재 앱>`으로 기존 앱을 다시 실행한다.
4. 3번이 성공하면 `open <현재 앱>`으로 새 앱을 실행한다.

작업 폴더는 시스템 임시 폴더 안에 있어서 macOS가 정리한다. 앱이 직접 지우지 않는다.

## 6. 앱 메뉴 (`menu.ts`)

`{ role: 'appMenu' }`를 아래 항목으로 바꾼다. `업데이트 확인...` 외에는 기존 `appMenu`와 같은 항목이다.

- `{ role: 'about' }`
- `업데이트 확인...`
- 구분선
- `{ role: 'services' }`
- 구분선
- `{ role: 'hide' }`, `{ role: 'hideOthers' }`, `{ role: 'unhide' }`
- 구분선
- `{ role: 'quit' }`

`buildMenu`의 인자에 `checkForUpdates: () => void`를 추가한다.

## 7. 릴리스 스크립트 (`scripts/release.sh`)

`package.json`에 `"release": "bash scripts/release.sh"`를 추가한다. 실행 예: `pnpm run release patch`.

1. 사전 조건을 확인한다. 하나라도 맞지 않으면 아무것도 바꾸지 않고 멈춘다.
   - 인자가 `patch`, `minor`, `major` 중 하나다.
   - 현재 브랜치가 `main`이다.
   - `git status --porcelain` 출력이 없다.
   - `gh auth status`가 성공한다.
2. `pnpm version <인자> -m "chore: v%s 버전업"`을 실행한다. pnpm 10은 이 명령을 `npm version`으로 실행한다. `package.json` 버전이 올라가고 커밋과 `v1.0.1` 태그가 만들어진다. `%s`에는 `v`가 없는 버전이 들어간다.
3. `pnpm test`와 `pnpm run build:app`을 실행한다. 실패하면 `git tag -d v<버전>`과 `git reset --hard HEAD~1`로 2번의 태그와 커밋을 되돌리고 멈춘다. 1번에서 커밋하지 않은 변경이 없음을 확인했으므로 `reset --hard`로 사라지는 변경은 버전업 커밋뿐이다.
4. Release 노트를 만든다.
   - `git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' HEAD~1`로 이전 태그를 찾는다.
   - 이전 태그가 있으면 `git log <이전 태그>..HEAD~1 --pretty='- %s'`로 커밋 제목 목록을 만든다. 버전업 커밋은 목록에 넣지 않는다.
   - 이전 태그가 없으면 "첫 릴리스"라고 적는다.
5. `git push origin main --follow-tags`로 커밋과 태그를 push한다.
6. `gh release create v<버전> release/reviewHelper-<버전>.zip --title v<버전> --notes <노트>`로 Release를 만들고 zip을 올린다. 실패하면 다시 실행할 `gh release create` 명령을 출력하고 멈춘다. 5번에서 이미 push했으므로 되돌리지 않는다.
7. zip을 `~/Desktop`에 복사한다.

사전 준비로 사용자가 `brew install gh`와 `gh auth login`을 한 번 실행해야 한다.

## 8. 테스트

- `version.ts`: `v1.2.3`과 `1.2.3` 파싱, prerelease와 잘못된 형식의 `null` 처리, 자릿수가 다른 버전 비교(`1.10.0`이 `1.9.0`보다 크다), 같은 버전 비교를 확인한다.
- `github.ts`: 가짜 `fetch`로 zip이 있는 Release, zip이 없는 Release, 404 응답, 500 응답, 네트워크 오류, 형식이 맞지 않는 태그를 확인한다. 요청 url과 `User-Agent` 헤더도 확인한다.
- 교체 스크립트: 임시 폴더에 `Info.plist`만 있는 가짜 `.app` 두 개를 만들고 이미 종료된 프로세스의 pid로 스크립트를 실행한다. `open`은 `PATH` 앞에 둔 가짜 `open` 스크립트로 바꿔 호출 인자를 파일에 기록한다.
  - 교체가 성공하면 현재 앱 경로에 새 앱이 있고 백업 경로에 기존 앱이 있으며 `open`이 현재 앱 경로로 호출된다.
  - 새 앱 경로가 없어 3번 이동이 실패하면 현재 앱 경로에 기존 앱이 돌아와 있고 `open`이 호출된다.
- 대화상자와 Dock 진행률은 단위테스트를 쓰지 않는다. 실제 업데이트로 확인한다.
- 실제 확인
  1. 업데이트 기능을 넣은 버전을 `pnpm run release minor`로 1.1.0으로 올리고 바탕화면의 앱을 1.1.0으로 직접 교체한다.
  2. 작은 변경을 커밋하고 `pnpm run release patch`로 1.1.1을 올린다.
  3. 1.1.0 앱을 실행해서 업데이트 대화상자, Dock 진행률, 종료 후 1.1.1 실행을 확인한다.
  4. 1.1.1 앱의 `업데이트 확인...` 클릭 시 "최신 버전을 사용 중입니다 (1.1.1)"이 나오는지 확인한다.

## 9. 문서

README의 `직접 빌드` 아래에 릴리스 방법(gh 준비, `pnpm run release`, 태그와 커밋 형식)과 자동 업데이트 동작을 한국어로 추가한다.

## 구현 순서

1. `version.ts`, `github.ts`
2. `install.ts`와 교체 스크립트
3. `index.ts`, `menu.ts`, `main.ts` 연결
4. `scripts/release.sh`와 `package.json`
5. README
