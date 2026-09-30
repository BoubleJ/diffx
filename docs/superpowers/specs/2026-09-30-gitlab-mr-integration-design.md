# GitLab MR 연동 설계

## 목적

`docs/backlog/gitlab-mr-integration.md`의 1~3번 기능을 구현한다.

1. 앱에서 현재 저장소의 GitLab MR 목록을 조회하고 MR 클릭 시 그 MR의 diff를 연다.
2. MR을 연 상태에서 diff 줄에 남긴 코멘트를 GitLab MR의 줄 코멘트로 등록한다. 기존 discussion을 보여주고 답글도 단다.
3. MR을 거치지 않고 브랜치를 직접 골라 비교할 때 남긴 코멘트는 지금처럼 앱 안의 메모로만 쓴다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 인증 | `glab` CLI 로그인 정보를 쓴다. 앱은 토큰을 저장하지 않는다 |
| GitLab 호스트와 프로젝트 판별 | `glab api`를 저장소 경로에서 실행하고 경로의 `:fullpath` 자리표시를 glab이 git 원격 URL로 판별하게 둔다 |
| MR diff 생성 | MR 커밋을 로컬로 fetch하고 `git diff <base_sha> <head_sha>`로 만든다. GitLab diffs API는 쓰지 않는다 |
| MR 목록 필터 | 상태 `전체 / 열린 MR / 머지된 MR` 중 하나와 `내가 올린 MR`(assignee가 본인) 체크박스. 기본값은 `열린 MR`, 체크 해제 |
| 코멘트 등록 시점 | GitLab Draft Notes로 초안을 올리고 `리뷰 제출` 클릭 시 `bulk_publish`로 한 번에 공개한다 |
| 기존 discussion | diff의 해당 줄에 보여주고 답글을 초안으로 단다. resolve 조작은 제공하지 않는다 |
| MR 목록 위치 | 툴바 모드 탭에 `MR`을 추가하고 탭 선택 시 MR 선택 드롭다운이 나온다 |
| 수동 브랜치 비교 코멘트 | 지금처럼 `InMemoryCommentStore`에 저장하고 GitLab으로 보내지 않는다 |

사내 GitLab(`gitlab.mrblue.com`)은 19.3.2 버전이라 Draft Notes API(`draft_notes`, `draft_notes/bulk_publish`)와 `in_reply_to_discussion_id`를 쓸 수 있다.

## 1. 전체 구조

```
src/
├─ gitlab/            (신규)
│  ├─ glab.ts         glab api 실행과 오류 분류
│  ├─ mr.ts           MR 목록, MR 상세, 커밋 fetch
│  ├─ notes.ts        discussion 조회, draft note 생성과 삭제, 공개
│  └─ position.ts     diff 줄을 GitLab position으로 변환
├─ comparison.ts      mr 모드 추가
├─ server.ts          /api/gitlab/* 추가, 기존 API에 mode=mr 처리 추가
└─ ui/
   ├─ components/MrSelect.tsx       (신규) MR 선택 드롭다운
   ├─ components/BranchPicker.tsx   MR 탭 추가
   ├─ components/CommentBubble.tsx  작성자, 초안 배지, 답글 입력 추가
   └─ hooks/useMrComments.ts        (신규) MR 모드 코멘트 조회와 변경
```

## 2. glab 실행 (`src/gitlab/glab.ts`)

- `execFile('glab', ['api', ...args], { cwd: repoPath })`로 실행한다. 요청 본문이 있으면 `--input -`와 `-H Content-Type:application/json`을 붙이고 JSON을 stdin으로 넘긴다.
- 목록 API는 `--paginate`를 붙인다.
- 제한 시간은 30초다.
- 실패를 다음 종류로 나눈다.
  - `not_installed`: `glab` 실행 파일이 없다 (`ENOENT`).
  - `auth`: stderr에 `401`이 있거나 로그인 정보가 없다는 메시지가 있다.
  - `not_gitlab`: glab이 원격 URL에서 GitLab 프로젝트를 판별하지 못했다.
  - `api`: 그 외 GitLab 응답 오류. stderr 마지막 줄을 메시지로 쓴다.
- 서버는 glab 실행부를 `AppOptions.glab`으로 주입받는다. 테스트에서 가짜 실행부를 넘긴다.

## 3. GitLab 상태 확인

`GET /api/gitlab/status`

- `glab api projects/:fullpath`와 `glab api user`를 실행한다.
- 응답: `{ available: true, host, project, webUrl, username }` 또는 `{ available: false, reason: 'not_installed' | 'auth' | 'not_gitlab' | 'api', message }`.
- 결과는 서버 메모리에 둔다. 쿼리 `refresh=true`이면 다시 확인한다.

## 4. MR 목록

`GET /api/gitlab/mrs?state=opened|merged|all&mine=true|false&search=<문자열>`

- `projects/:fullpath/merge_requests?state=<state>&order_by=updated_at&sort=desc&per_page=50`를 조회한다. `--paginate`를 붙이지 않고 첫 50개만 돌려준다.
- `mine=true`이면 `scope=assigned_to_me`를 붙인다.
- `search`가 있으면 `search=<문자열>&in=title`을 붙인다.
- 응답 항목: `{ iid, title, state, sourceBranch, targetBranch, author, webUrl, updatedAt }`.

## 5. MR diff

### 비교 조합

- 키: `mr:<iid>`
- UI의 `Comparison` 타입에 `{ mode: 'mr'; iid: number }`를 추가한다.
- 쿼리: `mode=mr&iid=<iid>`

### MR 상세와 커밋 fetch

1. `projects/:fullpath/merge_requests/<iid>`로 `diff_refs`(`base_sha`, `start_sha`, `head_sha`), `source_branch`, `target_branch`, `title`, `web_url`을 읽는다.
2. `git cat-file -e <sha>^{commit}`로 `base_sha`와 `head_sha`가 로컬에 있는지 확인한다.
3. 하나라도 없으면 `GIT_TERMINAL_PROMPT=0`으로 `git fetch --no-tags <원격> refs/merge-requests/<iid>/head refs/heads/<target_branch>`를 실행한다. 제한 시간은 60초다. 로컬에 ref를 새로 만들지 않는다.
   - 머지되어 타겟 브랜치가 삭제된 경우를 대비해 타겟 브랜치 fetch가 실패하면 `refs/merge-requests/<iid>/head`만 다시 fetch한다.
4. fetch 후에도 커밋이 없으면 `{ error: 'mr_fetch_failed', message }`와 502를 돌려준다.

`<원격>`은 `git remote -v`의 원격 중 URL의 호스트와 경로(끝의 `.git` 제외)가 status의 `host`, `project`와 같은 첫 번째다. 없으면 `origin`을 쓴다.

### 서버 API 변경

- `GET /api/diff?mode=mr&iid=<iid>`
  - 요청마다 MR 상세를 다시 조회한다. 새 커밋이 push되면 `head_sha`가 바뀌어 새 diff가 나온다.
  - diff는 기존 `createRangeDiffCache`로 `base_sha`와 `head_sha` 사이를 만든다.
  - 응답에 `mr: { iid, title, webUrl, baseSha, startSha, headSha }`를 추가한다. `sourceSha`는 `head_sha`, `targetSha`와 `mergeBase`는 `base_sha`다.
- 서버는 iid별 마지막 MR 상세를 메모리에 둔다. `/api/file-content`, `/api/file-versions`, `/api/review`의 `mode=mr` 요청은 이 값을 쓰고 없으면 MR 상세를 조회한다.
- `/api/file-content?mode=mr`: 이전 버전은 `base_sha`, 새 버전은 `head_sha`에서 읽는다.
- `/api/review`의 `mode=mr`: 리뷰 실행 문맥을 브랜치 비교와 같게 만든다. `mode: 'branch'`, `source: head_sha`, `target: base_sha`, `mergeBase: base_sha`, 키는 `mr:<iid>`다. `sourceCheckedOut`은 `HEAD`가 `head_sha`일 때만 true다.

## 6. MR 코멘트

### 데이터 형태

`ReviewComment`와 `CommentReply`에 다음을 추가한다. 로컬 메모는 `origin: 'local'`이고 나머지 필드가 없다.

```ts
interface CommentReply {
  id: string
  body: string
  createdAt: number
  author?: string
  draft?: boolean
}

interface ReviewComment {
  // 기존 필드
  origin: 'local' | 'draft' | 'gitlab'
  author?: string
  discussionId?: string
}
```

### 조회

`GET /api/gitlab/mrs/:iid/threads`

- `projects/:fullpath/merge_requests/<iid>/discussions`(`--paginate`)와 `.../draft_notes`를 조회한다.
- discussion 중 첫 note의 `type`이 `DiffNote`인 것만 쓴다.
  - `position.head_sha`가 현재 MR `head_sha`와 같으면 `origin: 'gitlab'`인 `ReviewComment`로 바꾼다. `id`와 `discussionId`는 discussion id, `filePath`는 `new_line`이 있으면 `new_path` 아니면 `old_path`, `side`는 `new_line`이 있으면 `additions` 아니면 `deletions`, `status`는 `resolved` 여부로 정한다. 두 번째 note부터 `replies`에 넣는다.
  - `head_sha`가 다른 discussion은 개수만 센다.
- draft note
  - `in_reply_to_discussion_id`가 없으면 `origin: 'draft'`인 `ReviewComment`로 바꾼다. `id`는 `draft:<draft id>`다.
  - 있으면 해당 discussion의 `replies` 끝에 `draft: true`로 넣는다. 그 discussion이 목록에 없으면 버린다.
- 응답: `{ comments: ReviewComment[], outdatedCount: number, draftCount: number }`.

### 초안 작성

`POST /api/gitlab/mrs/:iid/drafts`

- 새 줄 코멘트: 본문 `{ filePath, side, lineNumber, body }`. `position.ts`로 position을 만들어 `draft_notes`에 `{ note, position }`을 보낸다.
- 답글: 본문 `{ discussionId, body }`. `draft_notes`에 `{ note, in_reply_to_discussion_id }`를 보낸다.
- 실패 시 glab 오류 종류와 메시지를 502로 돌려준다.

### position 계산 (`src/gitlab/position.ts`)

- 입력: 현재 MR patch, 파일 경로, `side`, `lineNumber`, MR의 세 sha.
- 출력: `{ position_type: 'text', base_sha, start_sha, head_sha, old_path, new_path, old_line?, new_line? }`.
- patch에서 해당 파일의 hunk를 읽어 줄 종류를 판별한다.
  - 추가 줄: `new_line`만 넣는다.
  - 삭제 줄: `old_line`만 넣는다.
  - 변경되지 않은 줄: 반대쪽 줄 번호를 계산해 `old_line`과 `new_line`을 모두 넣는다. hunk 밖의 줄(전체 파일 펼치기로 보이는 줄)은 앞의 hunk 끝 기준 차이로 계산한다.
- 파일 이름 변경은 patch의 `rename from`, `rename to`로 `old_path`와 `new_path`를 따로 넣는다.
- 해당 파일이 patch에 없거나 바이너리 파일이면 `null`을 돌려주고 API는 400을 돌려준다.

### 초안 삭제

`DELETE /api/gitlab/mrs/:iid/drafts/:id`: `draft_notes/<id>`를 삭제한다.

### 리뷰 제출

`POST /api/gitlab/mrs/:iid/publish`: `draft_notes/bulk_publish`를 호출한다.

## 7. UI

### 모드 탭과 MR 선택 드롭다운

- `BranchPicker`의 모드 탭에 `MR` 버튼을 추가한다. custom 모드에서는 지금처럼 모드 탭을 그리지 않는다.
- `/api/gitlab/status`가 `available: false`이면 `MR` 버튼을 비활성으로 두고 `title`에 이유를 넣는다.
  - `not_installed`: "glab이 설치되어 있지 않습니다 (brew install glab)"
  - `auth`: "glab 로그인이 필요합니다. 터미널에서 `glab auth login --hostname <호스트>`를 실행해 주세요"
  - `not_gitlab`: "원격 저장소가 GitLab이 아닙니다"
  - `api`: 서버가 돌려준 메시지
- `MR` 탭 클릭 시 `MrSelect` 드롭다운과 새로고침 버튼이 나온다. MR을 고르기 전에는 diff 영역에 "MR을 선택해 주세요" 안내를 보여준다.
- `MrSelect` 구성
  - 검색 input: 입력 후 300ms 동안 추가 입력이 없으면 `search` 쿼리로 다시 조회한다.
  - 상태 필터 버튼 `전체 / 열린 MR / 머지된 MR`: 기본값은 `열린 MR`이다.
  - `내가 올린 MR` 체크박스: 기본값은 체크 해제다.
  - 목록 항목: `!<iid> <제목>`, 아래 줄에 `<소스 브랜치> → <타겟 브랜치>`와 작성자 이름. 머지된 MR에는 `머지됨` 배지, 닫힌 MR에는 `닫힘` 배지를 붙인다.
- 필터와 체크박스 값은 `diffx-mr-filter:<저장소 경로>` 키로 localStorage에 저장하고 다음에 드롭다운을 열 때 적용한다.
- 마지막으로 연 MR은 기존 비교 조합 저장처럼 `{ mode: 'mr', iid }`로 저장하고 다음 실행 시 그 MR을 연다. status가 `available: false`이면 `작업 중 변경사항`으로 되돌리고 드롭다운 아래에 이유를 보여준다.
- 새로고침 버튼 클릭 시 status를 `refresh=true`로 다시 확인하고 MR 목록, diff, 코멘트를 다시 불러온다.
- MR diff 첫 요청 중에는 diff 영역에 "MR 커밋을 가져오는 중입니다" 안내를 보여준다.
- 툴바의 저장소 이름 옆에 MR 제목을 표시하고 클릭 시 GitLab MR 웹 페이지를 외부 브라우저로 연다.

### MR 모드의 코멘트 표시

- MR 모드에서는 `useComments` 대신 `useMrComments`가 `/api/gitlab/mrs/:iid/threads`를 조회한다. 다른 모드는 지금과 같다.
- `CommentBubble`
  - `gitlab`: 작성자 이름과 시각, 본문, 답글 목록을 보여준다. 삭제 버튼을 그리지 않는다. `답글` 버튼 클릭 시 입력창이 나오고 저장 시 답글 draft가 만들어진다.
  - `draft`: 작성자 자리에 `초안` 배지를 붙이고 삭제 버튼을 둔다.
  - 답글 draft는 답글 목록 끝에 `초안` 배지와 함께 보여준다. 삭제 버튼을 둔다.
  - resolve된 discussion은 지금의 `comment-resolved` 스타일로 그린다.
- `outdatedCount`가 1 이상이면 사이드바 `CommentTracker` 위에 "이전 버전에 남은 코멘트 N개는 GitLab에서 확인해 주세요" 안내와 MR 링크를 보여준다.
- 코멘트 목록은 30초마다, 그리고 초안 저장, 삭제, 제출 직후에 다시 조회한다.

### 리뷰 제출

- MR 모드에서 툴바에 `리뷰 제출 (N)` 버튼을 둔다. N은 `draftCount`다. 0이면 비활성으로 둔다.
- 클릭 시 `POST /api/gitlab/mrs/:iid/publish`가 실행되고 버튼에 로딩 표시가 나온다. 성공 시 코멘트 목록을 다시 조회하고 초안 배지가 사라진다.
- 실패 시 버튼 아래에 오류 메시지를 보여준다. draft는 GitLab에 그대로 남는다.
- 기존 `Copy comments` 버튼은 그대로 둔다.

### 오류 처리

- MR 커밋 fetch 실패: diff 영역에 git 오류 메시지와 `다시 시도` 버튼을 보여준다.
- 초안 저장 실패: 입력창을 닫지 않고 입력창 아래에 오류 메시지를 보여준다. 입력한 내용은 유지한다.
- 바이너리 파일 카드에는 코멘트 추가 버튼을 그리지 않는다.

## 8. 테스트

- `position.ts`: 추가 줄, 삭제 줄, 변경되지 않은 줄, hunk 밖의 줄, 파일 이름 변경의 position 계산을 단위테스트로 확인한다.
- `glab.ts`: 가짜 glab 스크립트로 오류 종류 판별, `--input -` 본문 전달, JSON 파싱을 확인한다. `src/review/__fixtures__/fake-cli.mjs` 방식을 따른다.
- `notes.ts`: discussion과 draft note 응답 예시를 `src/gitlab/__fixtures__/`에 두고 `ReviewComment` 변환, 이전 버전 discussion 개수, 답글 draft 병합을 확인한다.
- 서버 API: 가짜 glab 실행부를 주입해 MR 목록 쿼리 구성, draft 생성 요청 본문, publish 호출을 확인한다. `mode=mr` diff는 임시 저장소에 `refs/merge-requests/1/head`를 만들고 가짜 MR 상세가 그 sha를 돌려주게 해서 확인한다.
- 실제 확인: 사내 GitLab MR 하나로 목록 조회, 필터, diff 열기, 초안 작성, 답글 초안, 리뷰 제출을 직접 실행한다. 실제 MR에 코멘트가 등록되므로 사용할 MR을 사용자에게 먼저 확인한다.

## 구현 순서

1. `src/gitlab/glab.ts`, status API
2. MR 목록 API와 `MrSelect`, 모드 탭
3. `mr` 모드 diff (상세 조회, fetch, 기존 API 연결)
4. `position.ts`, discussion 조회와 draft 작성, 코멘트 UI
5. 리뷰 제출
