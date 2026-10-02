# 코드 하이퍼링크 비동기 처리 설계

## 목적

코드 하이퍼링크(정의로 이동, 사용처 보기, 파일 사용처 보기)를 실행하는 동안 앱이 멈추지 않게 한다.

저장소 서버는 Electron 메인 프로세스 안에서 실행된다(`electron/repoWindows.ts`가 `startServer`를 직접 호출한다). 하이퍼링크 처리는 git을 `execFileSync`로 실행하므로 git이 끝날 때까지 메인 프로세스의 이벤트 루프가 멈춘다. 그동안 메뉴, 다른 저장소 창, 같은 창의 다른 API 요청이 처리되지 않는다.

하이퍼링크 처리가 실행하는 동기 git 호출은 세 종류다.

| 동작 | 실행하는 git | 호출 횟수 |
|---|---|---|
| `exists` | `git cat-file -t <sha>:<path>` | import 경로 하나를 해석할 때 후보마다 한 번, 최대 19번(`modules.ts`의 `tryFile`). 사용처 검색은 import한 파일의 모든 import 문을 해석한다 |
| `readFile` | `git show <sha>:<path>` | 파일마다 한 번 |
| `grep` | `git grep` | 검색마다 한 번 |

## 결정 사항

| 항목 | 결정 |
|---|---|
| 범위 | `src/definition/`와 서버의 `/api/definition`, `/api/references` 핸들러 |
| `SourceReader` | 메서드가 Promise를 돌려준다. `close()`를 추가한다 |
| `exists` | 요청당 한 번 `git ls-tree`로 받은 파일 목록에서 확인한다 |
| `readFile` | 요청당 `git cat-file --batch` 프로세스 하나로 읽고 요청 안에서 캐시한다 |
| `grep` | `execFile`로 비동기 실행한다. 10초 제한은 유지한다 |
| 찾는 규칙 | 바꾸지 않는다. 정규식, re-export 깊이 5, 사용처 상한 200, 후보 상한 20 그대로 |
| 범위 밖 | `readerFor`의 `resolveBranchRefs`(동기 `rev-parse`, `merge-base`), `src/git.ts`의 다른 동기 git 호출 |

## 1. `SourceReader` (`src/definition/reader.ts`)

```ts
export interface SourceReader {
  readFile(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  grep(pattern: string): Promise<GrepHit[]>
  close(): void
}
```

`close()`는 reader가 띄운 프로세스를 종료한다. 띄운 프로세스가 없으면 아무것도 하지 않는다. 여러 번 호출해도 문제를 일으키지 않는다.

## 2. `commitReader(repo, sha, options?)`

### 파일 목록과 `exists`

- 처음 `exists`가 호출될 때 `git ls-tree -r -z --name-only <sha>`를 비동기로 한 번 실행하고 결과를 `Set<string>`에 담는다. 같은 reader의 다음 `exists`는 이 `Set`을 쓴다.
- 동시에 여러 `exists`가 호출되어도 `ls-tree`는 한 번만 실행한다. 실행 중인 Promise를 저장해 두고 함께 기다린다.
- `ls-tree -r`은 파일(blob)만 나열하므로 폴더 경로는 `false`가 된다. 지금 동작(`cat-file -t`가 `tree`이면 `false`)과 같다.
- `isSafePath`를 통과하지 못한 경로는 목록을 보지 않고 `false`를 돌려준다.
- `ls-tree`가 실패하면 `exists`는 모두 `false`를 돌려준다.

### `readFile`

- 처음 `readFile`이 호출될 때 `git cat-file --batch`를 `spawn`으로 띄운다. 이 reader의 모든 파일 읽기는 이 프로세스 하나로 처리한다.
- 요청은 `<sha>:<path>\n`을 stdin에 쓰고 응답을 stdout에서 순서대로 읽는다. 응답 형식은 아래와 같다.
  - 있는 개체: `<oid> <type> <size>\n<size 바이트 내용>\n`
  - 없는 개체: `<sha>:<path> missing\n`
- `type`이 `blob`이면 내용을 UTF-8 문자열로 돌려준다. `blob`이 아니면(폴더 등) `null`을 돌려준다. `missing`이면 `null`을 돌려준다.
- 요청은 보낸 순서대로 응답이 오므로 대기열(FIFO)로 짝을 맞춘다.
- 같은 경로는 다시 요청하지 않는다. 경로별 Promise를 `Map`에 담아 두고 재사용한다.
- 경로에 줄바꿈 문자가 있거나 `isSafePath`를 통과하지 못하면 요청하지 않고 `null`을 돌려준다.
- 프로세스가 종료되거나 오류가 나면 대기 중인 읽기와 이후 읽기는 모두 `null`을 돌려준다.

### `grep`

- `execFile`을 Promise로 감싸 실행한다. 인자, 경로 필터, 10초 제한, `maxBuffer`(50MB)는 지금과 같다.
- 종료 코드 1(일치 없음)과 제한 시간 초과(`SIGTERM`)는 빈 배열을 돌려준다. 그 외 오류는 예외로 던진다.

### 프로세스 실행 주입

- `options.spawn`으로 `spawn` 함수를 주입받는다. 기본값은 `node:child_process`의 `spawn`이다. 테스트에서 프로세스 실행 횟수를 세기 위해 쓴다.

## 3. `worktreeReader(repo)`

운영 코드에서는 쓰지 않고 테스트에서만 쓴다. 인터페이스만 맞춘다.

- `readFile`, `exists`는 지금 로직을 그대로 쓰고 결과를 Promise로 돌려준다.
- `grep`은 `commitReader`와 같은 비동기 실행을 쓴다.
- `close()`는 아무것도 하지 않는다.

## 4. 해석 함수

- `modules.ts`: `resolveModule`, `tryFile`, `findConfig`, `readConfig`를 `async`로 바꾼다. `tryFile`의 후보 확인은 지금처럼 순서대로 확인하고 처음 있는 파일을 돌려준다.
- `resolve.ts`: `resolveDefinition`, `findExportLocation`, `searchDeclarations`를 `async`로 바꾼다.
- `references.ts`: `findSymbolReferences`, `findFileReferences`, `findImporters`, `createResolver`가 만드는 함수를 `async`로 바꾼다. `createResolver`의 캐시는 해석 결과 Promise를 담는다.
- `imports.ts`, `declarations.ts`, `token.ts`는 바꾸지 않는다.

## 5. 서버 (`src/server.ts`)

- `/api/definition`과 `/api/references` 핸들러는 해석 함수를 `await`하고, 응답을 만든 뒤 `finally`에서 `reader.close()`를 호출한다.
- `/api/definition`이 후보마다 줄 내용을 붙일 때 쓰는 `reader.readFile`도 `await`한다. 같은 파일은 reader 캐시에서 읽는다.

## 6. 테스트

- 기존 `reader.test.ts`, `modules.test.ts`, `resolve.test.ts`, `references.test.ts`, `server.definition.test.ts`의 호출에 `await`를 붙이고 기대값은 바꾸지 않는다. 기대값이 그대로 통과하면 찾는 규칙이 바뀌지 않았다는 뜻이다.
- `commitReader` 테스트 추가
  - 파일 세 개를 읽고 같은 파일을 한 번 더 읽어도 `cat-file` 프로세스는 하나만 띄운다. 주입한 `spawn`의 호출을 센다.
  - 없는 파일, 폴더, 줄바꿈이 들어간 경로는 `null`이다.
  - `exists`를 여러 번 호출해도 `ls-tree`는 한 번만 실행한다.
  - 내용에 줄바꿈이 많은 파일과 빈 파일을 정확히 읽는다.
  - `close()` 후 `cat-file` 프로세스가 종료된다.
- 서버 테스트 추가: `/api/references`를 처리하는 동안 이벤트 루프가 멈추지 않는다. 1ms 간격 `setInterval`을 켜 둔 채 요청을 보내고, 응답이 올 때까지 타이머가 한 번 이상 실행됐는지 확인한다. 지금 코드는 처리 중 동기 git만 실행하므로 타이머가 실행되지 않는다.
- 앱에서 확인할 항목
  1. 큰 저장소에서 export된 함수의 사용처 검색을 실행하는 동안 메뉴를 열 수 있고 다른 저장소 창의 diff가 바뀐다.
  2. 정의로 이동, 사용처 보기, 파일 사용처 보기의 결과가 바꾸기 전과 같다.

## 구현 순서

1. `SourceReader`와 `commitReader`, `worktreeReader` 비동기 전환
2. `modules.ts`, `resolve.ts`, `references.ts` 비동기 전환
3. 서버 핸들러와 이벤트 루프 테스트
