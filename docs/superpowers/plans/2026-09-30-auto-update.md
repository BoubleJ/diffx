# 자동 업데이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** reviewHelper 앱이 GitHub Release의 새 버전을 확인하고, 사용자가 `지금 업데이트`를 클릭하면 zip을 내려받아 `.app`을 교체한 뒤 다시 실행한다. 릴리스는 `pnpm run release <patch|minor|major>` 한 번으로 올린다.

**Architecture:** 메인 프로세스에 `electron/updater/` 모듈을 추가한다. `version.ts`와 `github.ts`는 Electron 없이 동작하는 순수 로직이고, `install.ts`는 다운로드, `ditto` 압축 해제, `plutil` 버전 검증, 교체 쉘 스크립트 실행을 맡는다. `index.ts`만 Electron의 `dialog`, `BrowserWindow`, `app`을 쓰고 `main.ts`와 `menu.ts`가 이를 호출한다. 릴리스는 `scripts/release.sh`가 `pnpm version`, 테스트, 빌드, push, `gh release create`를 순서대로 실행한다.

**Tech Stack:** TypeScript, Electron 44, Node 24 `fetch`, vitest, tsdown, electron-builder, bash, gh CLI

**Spec:** `docs/superpowers/specs/2026-09-30-auto-update-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다. `electron-updater`를 쓰지 않는다.
- Release 조회 url: `https://api.github.com/repos/BoubleJ/diffx/releases/latest`. 요청 헤더 `Accept: application/vnd.github+json`, `User-Agent: reviewHelper`. 제한 시간 10초.
- 태그와 Release 제목: `v1.0.1`. 버전업 커밋 메시지: `chore: v1.0.1 버전업`. Release 첨부 파일: `reviewHelper-1.0.1.zip`.
- 작업 폴더: `<app.getPath('temp')>/reviewHelper-update-<버전>`. zip은 `update.zip`, 압축 해제 폴더는 `app`, 백업은 `backup.app`, 교체 스크립트는 `swap.sh`.
- 교체 스크립트는 0.2초 간격으로 최대 150번(30초) 앱 종료를 기다린다.
- Release 노트는 1500자까지만 대화상자에 넣고 넘으면 `...`을 붙인다.
- 대화상자 문구(그대로 쓴다)
  - "새 버전(<버전>)을 설치할 수 있습니다", 버튼 `지금 업데이트`, `나중에`
  - "현재 버전: <버전>"
  - "최신 버전을 사용 중입니다 (<버전>)"
  - "업데이트를 확인하지 못했습니다"
  - "이 Release에는 설치 파일이 없습니다"
  - "개발 모드에서는 업데이트를 확인하지 않습니다"
  - "업데이트를 내려받는 중입니다"
  - "앱을 응용 프로그램 폴더나 다른 폴더로 옮긴 뒤 다시 실행해 주세요"
  - "앱이 있는 폴더에 쓸 수 없습니다"
  - "업데이트를 설치하지 못했습니다"
- 앱 메뉴 항목 이름: `업데이트 확인...`
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 이 계획에 적힌 주석 외에 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. Electron 빌드: `pnpm run build:electron`. 작업 시작 시점에 테스트 366개가 통과한다.
- 작업 브랜치: `main`에서 `feature/auto-update`를 만들어 작업한다. 작업 시작 전 `main`에 커밋하지 않은 표 렌더링 수정(`AnswerMarkdown`, `remark-gfm`)이 있으면 사용자에게 먼저 커밋할지 묻는다.
- 테스트는 macOS의 `ditto`, `plutil`, `/bin/sh`를 실제로 실행한다.

## Review Focus

1. GitHub이 JSON이 아닌 응답이나 `assets`가 배열이 아닌 응답을 돌려주면 앱이 예외로 멈추지 않고 확인 실패로 처리해야 한다. Task 1 `github.test.ts`의 `returns an error for a non-JSON body`와 `treats a missing assets list as no zip`이 확인한다.
2. Release 노트를 비워 두면 GitHub이 `body: null`을 돌려주는데, 이때 대화상자 detail에 `null`이 찍히지 않아야 한다. Task 1 `treats a null body as empty notes`가 확인한다.
3. zip 다운로드가 404 같은 오류 응답을 받으면 교체를 시작하지 않고 오류를 알려야 한다. Task 2 `prepareUpdate` 테스트 `fails when the download responds with an error`가 확인한다.
4. 앱을 이름에 공백이 있는 폴더(`~/My Apps/reviewHelper.app`)에 둔 사용자도 교체가 되어야 한다. Task 2 교체 스크립트 테스트 `swaps apps in a folder with spaces`가 확인한다.
5. 교체 스크립트가 실패한 뒤에도 사용자가 앱을 다시 쓸 수 있어야 한다. 새 앱이 없어 이동이 실패하면 기존 앱이 원래 자리로 돌아오고 다시 실행되어야 한다. Task 2 `restores the current app when the new app cannot be moved`가 확인한다.

---

### Task 1: 버전 비교와 Release 조회

**Files:**
- Create: `electron/updater/version.ts`, `electron/updater/github.ts`
- Test: `electron/updater/version.test.ts`, `electron/updater/github.test.ts`

**Interfaces:**
- Produces:
  - `parseVersion(text: string): [number, number, number] | null`
  - `isNewer(latest: string, current: string): boolean`
  - `LATEST_RELEASE_URL: string`
  - `type LatestRelease = { kind: 'release'; version: string; notes: string; zipUrl: string | null } | { kind: 'none' } | { kind: 'error'; message: string }` (`version`은 `v`를 뗀 값)
  - `fetchLatestRelease(fetchFn?: typeof fetch, timeoutMs?: number): Promise<LatestRelease>`
  - `releaseDetail(current: string, notes: string): string`

- [ ] **Step 1: 작업 브랜치 만들기**

```bash
git status --short
git switch -c feature/auto-update
```

`git status --short`에 출력이 있으면 멈추고 사용자에게 먼저 커밋할지 묻는다.

- [ ] **Step 2: `version.test.ts` 작성**

```ts
import { describe, it, expect } from 'vitest'
import { isNewer, parseVersion } from './version'

describe('parseVersion', () => {
  it('parses versions with and without a v prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })

  it('returns null for prerelease and malformed versions', () => {
    expect(parseVersion('1.2.3-beta.1')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('release')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('v1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('v2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('v1.0.1', '1.0.0')).toBe(true)
  })

  it('returns false for the same or an older version', () => {
    expect(isNewer('v1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('v1.0.0', '1.0.1')).toBe(false)
  })

  it('returns false when either version cannot be parsed', () => {
    expect(isNewer('nightly', '1.0.0')).toBe(false)
    expect(isNewer('v1.0.1', 'dev')).toBe(false)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run electron/updater/version.test.ts`
Expected: FAIL, `Failed to resolve import "./version"`

- [ ] **Step 4: `version.ts` 구현**

```ts
export type Version = [number, number, number]

export function parseVersion(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run electron/updater/version.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: `github.test.ts` 작성**

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchLatestRelease, LATEST_RELEASE_URL, releaseDetail } from './github'

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch

const zipAsset = (version: string) => ({
  name: `reviewHelper-${version}.zip`,
  browser_download_url: `https://github.com/BoubleJ/diffx/releases/download/v${version}/reviewHelper-${version}.zip`,
})

describe('fetchLatestRelease', () => {
  it('requests the latest release with GitHub headers', async () => {
    const fetchFn = respond({ tag_name: 'v1.0.1', body: '', assets: [] })
    await fetchLatestRelease(fetchFn)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'reviewHelper' })
  })

  it('returns the version without v, the notes and the matching zip url', async () => {
    const result = await fetchLatestRelease(respond({
      tag_name: 'v1.0.1',
      body: '- 표 렌더링 수정',
      assets: [{ name: 'reviewHelper-1.0.1.zip.blockmap', browser_download_url: 'x' }, zipAsset('1.0.1')],
    }))
    expect(result).toEqual({ kind: 'release', version: '1.0.1', notes: '- 표 렌더링 수정', zipUrl: zipAsset('1.0.1').browser_download_url })
  })

  it('returns a null zip url when the release has no matching zip', async () => {
    const result = await fetchLatestRelease(respond({ tag_name: 'v1.0.1', body: '', assets: [zipAsset('1.0.0')] }))
    expect(result).toMatchObject({ kind: 'release', zipUrl: null })
  })

  it('treats a missing assets list as no zip', async () => {
    const result = await fetchLatestRelease(respond({ tag_name: 'v1.0.1', body: '' }))
    expect(result).toMatchObject({ kind: 'release', zipUrl: null })
  })

  it('treats a null body as empty notes', async () => {
    const result = await fetchLatestRelease(respond({ tag_name: 'v1.0.1', body: null, assets: [] }))
    expect(result).toMatchObject({ kind: 'release', notes: '' })
  })

  it('returns none for 404', async () => {
    expect(await fetchLatestRelease(respond({ message: 'Not Found' }, 404))).toEqual({ kind: 'none' })
  })

  it('returns an error for other error statuses', async () => {
    expect(await fetchLatestRelease(respond({ message: 'boom' }, 500))).toEqual({ kind: 'error', message: 'GitHub 응답 500' })
  })

  it('returns an error for a network failure', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com') }) as unknown as typeof fetch
    expect(await fetchLatestRelease(fetchFn)).toEqual({ kind: 'error', message: 'getaddrinfo ENOTFOUND api.github.com' })
  })

  it('returns an error for a non-JSON body', async () => {
    expect(await fetchLatestRelease(respond('<html>'))).toMatchObject({ kind: 'error' })
  })

  it('returns an error for a malformed tag', async () => {
    expect(await fetchLatestRelease(respond({ tag_name: 'nightly', body: '', assets: [] }))).toEqual({
      kind: 'error',
      message: '태그 형식이 올바르지 않습니다: nightly',
    })
  })
})

describe('releaseDetail', () => {
  it('puts the current version above the notes', () => {
    expect(releaseDetail('1.0.0', '- 수정')).toBe('현재 버전: 1.0.0\n\n- 수정')
  })

  it('omits the notes section when notes are empty', () => {
    expect(releaseDetail('1.0.0', '  ')).toBe('현재 버전: 1.0.0')
  })

  it('cuts notes longer than 1500 characters', () => {
    const detail = releaseDetail('1.0.0', 'a'.repeat(1600))
    expect(detail).toBe(`현재 버전: 1.0.0\n\n${'a'.repeat(1500)}...`)
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm vitest run electron/updater/github.test.ts`
Expected: FAIL, `Failed to resolve import "./github"`

- [ ] **Step 8: `github.ts` 구현**

```ts
import { parseVersion } from './version.js'

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/BoubleJ/diffx/releases/latest'
const NOTES_LIMIT = 1500

export type LatestRelease =
  | { kind: 'release'; version: string; notes: string; zipUrl: string | null }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

interface ReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface ReleaseResponse {
  tag_name?: unknown
  body?: unknown
  assets?: unknown
}

export async function fetchLatestRelease(fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<LatestRelease> {
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'reviewHelper' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404) return { kind: 'none' }
    if (!res.ok) return { kind: 'error', message: `GitHub 응답 ${res.status}` }
    const data = (await res.json()) as ReleaseResponse
    const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
    if (!parseVersion(tag)) return { kind: 'error', message: `태그 형식이 올바르지 않습니다: ${tag}` }
    const version = tag.replace(/^v/, '')
    const assets: ReleaseAsset[] = Array.isArray(data.assets) ? data.assets : []
    const zip = assets.find((asset) => asset?.name === `reviewHelper-${version}.zip`)
    return {
      kind: 'release',
      version,
      notes: typeof data.body === 'string' ? data.body : '',
      zipUrl: typeof zip?.browser_download_url === 'string' ? zip.browser_download_url : null,
    }
  } catch (err) {
    return { kind: 'error', message: (err as Error).message }
  }
}

export function releaseDetail(current: string, notes: string): string {
  const trimmed = notes.trim()
  const header = `현재 버전: ${current}`
  if (!trimmed) return header
  const body = trimmed.length > NOTES_LIMIT ? `${trimmed.slice(0, NOTES_LIMIT)}...` : trimmed
  return `${header}\n\n${body}`
}
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm vitest run electron/updater/`
Expected: PASS (version 5 tests, github 13 tests)

- [ ] **Step 10: 커밋**

```bash
git add electron/updater/version.ts electron/updater/version.test.ts electron/updater/github.ts electron/updater/github.test.ts
git commit -m "feat: 자동 업데이트용 버전 비교와 GitHub Release 조회 추가"
```

---

### Task 2: 다운로드, 새 앱 검증, 교체 스크립트

**Files:**
- Create: `electron/updater/install.ts`
- Test: `electron/updater/install.test.ts`

**Interfaces:**
- Produces:
  - `appBundlePath(execPath: string): string`
  - `type Installable = { ok: true } | { ok: false; error: string }`
  - `checkInstallable(appPath: string): Promise<Installable>`
  - `downloadFile(url: string, dest: string, onProgress: (ratio: number | null) => void, fetchFn?: typeof fetch): Promise<void>` (`ratio`는 0~1, `Content-Length`가 없으면 `null`)
  - `interface PreparedUpdate { workDir: string; newAppPath: string }`
  - `prepareUpdate(opts: { zipUrl: string; version: string; tempDir: string; onProgress: (ratio: number | null) => void; fetchFn?: typeof fetch }): Promise<PreparedUpdate>`
  - `SWAP_SCRIPT: string` (인자: pid, 현재 앱 경로, 새 앱 경로, 백업 경로)
  - `startSwap(opts: { pid: number; currentAppPath: string; newAppPath: string; workDir: string }): Promise<void>`

- [ ] **Step 1: `install.test.ts` 작성**

```ts
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appBundlePath, checkInstallable, downloadFile, prepareUpdate, SWAP_SCRIPT } from './install'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'updater-'))
})

afterEach(() => {
  chmodSync(dir, 0o755)
  rmSync(dir, { recursive: true, force: true })
})

const plist = (version: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>
`

function makeApp(path: string, version: string, marker: string) {
  mkdirSync(join(path, 'Contents'), { recursive: true })
  writeFileSync(join(path, 'Contents', 'Info.plist'), plist(version))
  writeFileSync(join(path, 'marker.txt'), marker)
}

function makeAppZip(version: string): Uint8Array {
  const app = join(dir, 'build', 'reviewHelper.app')
  makeApp(app, version, 'new')
  const zip = join(dir, 'build', 'app.zip')
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip])
  return new Uint8Array(readFileSync(zip))
}

const serve = (body: BodyInit, init?: ResponseInit) => vi.fn(async () => new Response(body, init)) as unknown as typeof fetch

describe('appBundlePath', () => {
  it('returns the .app folder three levels above the executable', () => {
    expect(appBundlePath('/Applications/reviewHelper.app/Contents/MacOS/reviewHelper')).toBe('/Applications/reviewHelper.app')
  })
})

describe('checkInstallable', () => {
  it('rejects an app running from App Translocation', async () => {
    const path = '/private/var/folders/xy/AppTranslocation/ABC/d/reviewHelper.app'
    expect(await checkInstallable(path)).toEqual({ ok: false, error: '앱을 응용 프로그램 폴더나 다른 폴더로 옮긴 뒤 다시 실행해 주세요' })
  })

  it('accepts an app in a writable folder', async () => {
    expect(await checkInstallable(join(dir, 'reviewHelper.app'))).toEqual({ ok: true })
  })

  it('rejects an app in a read-only folder', async () => {
    chmodSync(dir, 0o555)
    expect(await checkInstallable(join(dir, 'reviewHelper.app'))).toEqual({ ok: false, error: '앱이 있는 폴더에 쓸 수 없습니다' })
  })
})

describe('downloadFile', () => {
  it('writes the body and reports progress by Content-Length', async () => {
    const progress: (number | null)[] = []
    const dest = join(dir, 'file.bin')
    await downloadFile('https://example.com/file', dest, (ratio) => progress.push(ratio), serve('hello', { headers: { 'content-length': '5' } }))
    expect(readFileSync(dest, 'utf8')).toBe('hello')
    expect(progress.at(-1)).toBe(1)
  })

  it('reports null progress without Content-Length', async () => {
    const progress: (number | null)[] = []
    await downloadFile('https://example.com/file', join(dir, 'file.bin'), (ratio) => progress.push(ratio), serve('hello'))
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((ratio) => ratio === null)).toBe(true)
  })
})

describe('prepareUpdate', () => {
  it('downloads, extracts and returns the new app path', async () => {
    const fetchFn = serve(makeAppZip('1.2.0'))
    const tempDir = join(dir, 'temp')
    mkdirSync(tempDir)
    const prepared = await prepareUpdate({ zipUrl: 'https://example.com/app.zip', version: '1.2.0', tempDir, onProgress: () => {}, fetchFn })
    expect(prepared.workDir).toBe(join(tempDir, 'reviewHelper-update-1.2.0'))
    expect(prepared.newAppPath).toBe(join(tempDir, 'reviewHelper-update-1.2.0', 'app', 'reviewHelper.app'))
    expect(readFileSync(join(prepared.newAppPath, 'marker.txt'), 'utf8')).toBe('new')
  })

  it('replaces a work folder left by an earlier attempt', async () => {
    const tempDir = join(dir, 'temp')
    mkdirSync(join(tempDir, 'reviewHelper-update-1.2.0', 'app', 'reviewHelper.app'), { recursive: true })
    writeFileSync(join(tempDir, 'reviewHelper-update-1.2.0', 'leftover.txt'), 'old')
    const prepared = await prepareUpdate({ zipUrl: 'x', version: '1.2.0', tempDir, onProgress: () => {}, fetchFn: serve(makeAppZip('1.2.0')) })
    expect(existsSync(join(prepared.workDir, 'leftover.txt'))).toBe(false)
  })

  it('fails when the app version differs from the release version', async () => {
    const tempDir = join(dir, 'temp')
    mkdirSync(tempDir)
    await expect(
      prepareUpdate({ zipUrl: 'x', version: '1.3.0', tempDir, onProgress: () => {}, fetchFn: serve(makeAppZip('1.2.0')) }),
    ).rejects.toThrow('새 앱 버전(1.2.0)이 Release 버전(1.3.0)과 다릅니다')
  })

  it('fails when the download responds with an error', async () => {
    const tempDir = join(dir, 'temp')
    mkdirSync(tempDir)
    await expect(
      prepareUpdate({ zipUrl: 'x', version: '1.2.0', tempDir, onProgress: () => {}, fetchFn: serve('Not Found', { status: 404 }) }),
    ).rejects.toThrow('다운로드 응답 404')
  })
})

describe('SWAP_SCRIPT', () => {
  function runSwap(root: string, next: string) {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'open'), '#!/bin/sh\necho "$@" >> "$OPEN_LOG"\n')
    chmodSync(join(bin, 'open'), 0o755)
    const script = join(dir, 'swap.sh')
    writeFileSync(script, SWAP_SCRIPT)
    const log = join(dir, 'open.log')
    const deadPid = spawnSync('true').pid
    const current = join(root, 'reviewHelper.app')
    const backup = join(dir, 'backup.app')
    const result = spawnSync('/bin/sh', [script, String(deadPid), current, next, backup], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPEN_LOG: log },
    })
    return { status: result.status, current, backup, opened: existsSync(log) ? readFileSync(log, 'utf8').trim() : '' }
  }

  it('moves the current app to the backup, moves the new app into place and opens it', () => {
    const root = join(dir, 'Applications')
    makeApp(join(root, 'reviewHelper.app'), '1.0.0', 'old')
    const next = join(dir, 'new', 'reviewHelper.app')
    makeApp(next, '1.1.0', 'new')
    const { status, current, backup, opened } = runSwap(root, next)
    expect(status).toBe(0)
    expect(readFileSync(join(current, 'marker.txt'), 'utf8')).toBe('new')
    expect(readFileSync(join(backup, 'marker.txt'), 'utf8')).toBe('old')
    expect(opened).toBe(current)
  })

  it('swaps apps in a folder with spaces', () => {
    const root = join(dir, 'My Apps')
    makeApp(join(root, 'reviewHelper.app'), '1.0.0', 'old')
    const next = join(dir, 'new dir', 'reviewHelper.app')
    makeApp(next, '1.1.0', 'new')
    const { status, current, opened } = runSwap(root, next)
    expect(status).toBe(0)
    expect(readFileSync(join(current, 'marker.txt'), 'utf8')).toBe('new')
    expect(opened).toBe(current)
  })

  it('restores the current app when the new app cannot be moved', () => {
    const root = join(dir, 'Applications')
    makeApp(join(root, 'reviewHelper.app'), '1.0.0', 'old')
    const { status, current, opened } = runSwap(root, join(dir, 'missing', 'reviewHelper.app'))
    expect(status).toBe(1)
    expect(readFileSync(join(current, 'marker.txt'), 'utf8')).toBe('old')
    expect(opened).toBe(current)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run electron/updater/install.test.ts`
Expected: FAIL, `Failed to resolve import "./install"`

- [ ] **Step 3: `install.ts` 구현**

```ts
import { execFile, spawn } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type Installable = { ok: true } | { ok: false; error: string }

export interface PreparedUpdate {
  workDir: string
  newAppPath: string
}

export function appBundlePath(execPath: string): string {
  return dirname(dirname(dirname(execPath)))
}

export async function checkInstallable(appPath: string): Promise<Installable> {
  // 브라우저로 받은 앱을 옮기지 않고 실행하면 macOS가 읽기 전용 임시 경로에서 실행해서 교체할 수 없다.
  if (appPath.includes('/AppTranslocation/')) {
    return { ok: false, error: '앱을 응용 프로그램 폴더나 다른 폴더로 옮긴 뒤 다시 실행해 주세요' }
  }
  try {
    await access(dirname(appPath), constants.W_OK)
  } catch {
    return { ok: false, error: '앱이 있는 폴더에 쓸 수 없습니다' }
  }
  return { ok: true }
}

export async function downloadFile(
  url: string,
  dest: string,
  onProgress: (ratio: number | null) => void,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchFn(url)
  if (!res.ok || !res.body) throw new Error(`다운로드 응답 ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      onProgress(total ? Math.min(received / total, 1) : null)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), progress, createWriteStream(dest))
}

export async function prepareUpdate(opts: {
  zipUrl: string
  version: string
  tempDir: string
  onProgress: (ratio: number | null) => void
  fetchFn?: typeof fetch
}): Promise<PreparedUpdate> {
  const workDir = join(opts.tempDir, `reviewHelper-update-${opts.version}`)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })
  const zipPath = join(workDir, 'update.zip')
  await downloadFile(opts.zipUrl, zipPath, opts.onProgress, opts.fetchFn)
  const extractDir = join(workDir, 'app')
  // unzip과 달리 ditto는 앱 번들 안의 symlink와 확장 속성을 그대로 푼다.
  await run('ditto', ['-x', '-k', zipPath, extractDir])
  const newAppPath = join(extractDir, 'reviewHelper.app')
  try {
    await access(newAppPath)
  } catch {
    throw new Error('압축 파일에 reviewHelper.app이 없습니다')
  }
  const { stdout } = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(newAppPath, 'Contents', 'Info.plist')])
  const appVersion = stdout.trim()
  if (appVersion !== opts.version) throw new Error(`새 앱 버전(${appVersion})이 Release 버전(${opts.version})과 다릅니다`)
  await run('xattr', ['-dr', 'com.apple.quarantine', newAppPath]).catch(() => {})
  return { workDir, newAppPath }
}

export const SWAP_SCRIPT = `#!/bin/sh
pid="$1"
current="$2"
next="$3"
backup="$4"
waited=0
while kill -0 "$pid" 2>/dev/null; do
  if [ "$waited" -ge 150 ]; then
    exit 1
  fi
  sleep 0.2
  waited=$((waited + 1))
done
if ! mv "$current" "$backup"; then
  open "$current"
  exit 1
fi
if ! mv "$next" "$current"; then
  mv "$backup" "$current"
  open "$current"
  exit 1
fi
open "$current"
`

export async function startSwap(opts: { pid: number; currentAppPath: string; newAppPath: string; workDir: string }): Promise<void> {
  const script = join(opts.workDir, 'swap.sh')
  await writeFile(script, SWAP_SCRIPT)
  const backup = join(opts.workDir, 'backup.app')
  spawn('/bin/sh', [script, String(opts.pid), opts.currentAppPath, opts.newAppPath, backup], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}
```

`checkInstallable`과 `prepareUpdate`의 주석 두 줄은 spec에 적힌 이유를 옮긴 것이다. 이 외의 주석은 추가하지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run electron/updater/install.test.ts`
Expected: PASS (13 tests)

`rejects an app in a read-only folder`가 root 권한으로 실행되는 환경에서는 실패할 수 있다. 이 계획의 테스트는 사용자 계정으로 실행한다.

- [ ] **Step 5: 커밋**

```bash
git add electron/updater/install.ts electron/updater/install.test.ts
git commit -m "feat: 업데이트 zip 다운로드와 앱 교체 스크립트 추가"
```

---

### Task 3: 확인 흐름, 대화상자, 앱 메뉴 연결

**Files:**
- Create: `electron/updater/index.ts`
- Modify: `electron/menu.ts`, `electron/main.ts`

**Interfaces:**
- Consumes: Task 1의 `fetchLatestRelease`, `isNewer`, `releaseDetail`. Task 2의 `appBundlePath`, `checkInstallable`, `prepareUpdate`, `startSwap`.
- Produces:
  - `checkForUpdates(opts: { manual: boolean }): Promise<void>`
  - `buildMenu(deps: { openFolder: () => void; openRecent: (path: string) => void; checkForUpdates: () => void; recent: RecentRepo[] }): Menu`

이 Task의 코드는 Electron 모듈을 쓰므로 단위테스트를 쓰지 않는다. 타입 검사와 빌드로 확인하고 동작은 Task 5에서 확인한다.

- [ ] **Step 1: `index.ts` 작성**

```ts
import { app, BrowserWindow, dialog } from 'electron'
import { fetchLatestRelease, releaseDetail } from './github.js'
import { appBundlePath, checkInstallable, prepareUpdate, startSwap } from './install.js'
import { isNewer } from './version.js'

let installing = false

function setProgress(ratio: number | null) {
  // macOS는 창의 진행률을 Dock 아이콘에 표시한다. 1보다 큰 값은 진행률 없는 막대로, 음수는 막대 제거로 처리한다.
  const value = ratio === null ? 2 : ratio
  for (const window of BrowserWindow.getAllWindows()) window.setProgressBar(value)
}

async function install(version: string, zipUrl: string) {
  const appPath = appBundlePath(process.execPath)
  const installable = await checkInstallable(appPath)
  if (!installable.ok) {
    await dialog.showMessageBox({ type: 'warning', message: installable.error })
    return
  }
  installing = true
  try {
    const prepared = await prepareUpdate({ zipUrl, version, tempDir: app.getPath('temp'), onProgress: setProgress })
    setProgress(-1)
    await startSwap({ pid: process.pid, currentAppPath: appPath, ...prepared })
    app.quit()
  } catch (err) {
    setProgress(-1)
    installing = false
    await dialog.showMessageBox({ type: 'error', message: '업데이트를 설치하지 못했습니다', detail: (err as Error).message })
  }
}

export async function checkForUpdates({ manual }: { manual: boolean }): Promise<void> {
  if (!app.isPackaged) {
    if (manual) await dialog.showMessageBox({ type: 'info', message: '개발 모드에서는 업데이트를 확인하지 않습니다' })
    return
  }
  if (installing) {
    if (manual) await dialog.showMessageBox({ type: 'info', message: '업데이트를 내려받는 중입니다' })
    return
  }
  const current = app.getVersion()
  const latest = await fetchLatestRelease()
  if (latest.kind === 'error') {
    if (manual) await dialog.showMessageBox({ type: 'warning', message: '업데이트를 확인하지 못했습니다', detail: latest.message })
    return
  }
  if (latest.kind === 'none' || !isNewer(latest.version, current)) {
    if (manual) await dialog.showMessageBox({ type: 'info', message: `최신 버전을 사용 중입니다 (${current})` })
    return
  }
  if (!latest.zipUrl) {
    await dialog.showMessageBox({ type: 'warning', message: '이 Release에는 설치 파일이 없습니다', detail: `새 버전: ${latest.version}` })
    return
  }
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `새 버전(${latest.version})을 설치할 수 있습니다`,
    detail: releaseDetail(current, latest.notes),
    buttons: ['지금 업데이트', '나중에'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response !== 0 || installing) return
  await install(latest.version, latest.zipUrl)
}
```

`setProgress`의 주석은 `setProgressBar` 값의 의미가 코드만으로 드러나지 않아서 단다. 이 외의 주석은 추가하지 않는다.

- [ ] **Step 2: `menu.ts`의 앱 메뉴 바꾸기**

`electron/menu.ts` 전체를 아래로 바꾼다. 바뀌는 곳은 import의 `app`, `deps.checkForUpdates`, 첫 번째 메뉴 항목이다.

```ts
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { RecentRepo } from './recent.js'

export function buildMenu(deps: {
  openFolder: () => void
  openRecent: (path: string) => void
  checkForUpdates: () => void
  recent: RecentRepo[]
}): Menu {
  const recentItems: MenuItemConstructorOptions[] = deps.recent.length
    ? deps.recent.map((r) => ({ label: `${r.name}  ${r.path}`, click: () => deps.openRecent(r.path) }))
    : [{ label: '최근 저장소 없음', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: '업데이트 확인...', click: deps.checkForUpdates },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '파일',
      submenu: [
        { label: '저장소 열기...', accelerator: 'CmdOrCtrl+O', click: deps.openFolder },
        { label: '최근 저장소', submenu: recentItems },
        { type: 'separator' },
        { role: 'close', label: '창 닫기' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '보기',
      submenu: [
        { role: 'reload', label: '새로고침', accelerator: 'CmdOrCtrl+R' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}
```

- [ ] **Step 3: `main.ts` 연결**

import 목록의 `import { buildMenu } from './menu.js'` 아래에 추가한다.

```ts
import { checkForUpdates } from './updater/index.js'
```

`refreshMenu`의 `buildMenu` 인자를 아래로 바꾼다.

```ts
  Menu.setApplicationMenu(buildMenu({
    openFolder: () => void selectFolder({ fromMenu: true }),
    openRecent: (path) => void openAndReport(path),
    checkForUpdates: () => void checkForUpdates({ manual: true }),
    recent: recent.list(),
  }))
```

`app.whenReady()` 콜백의 마지막 두 줄 뒤에 실행 시 확인을 추가한다.

```ts
  if (initialPaths.length === 0) showLauncher()
  for (const path of initialPaths) await openAndReport(path)
  void checkForUpdates({ manual: false })
})
```

- [ ] **Step 4: 타입 검사와 빌드 확인**

Run: `pnpm exec tsc --noEmit -p . && pnpm run build:electron && pnpm test`
Expected: 타입 오류 없음, `dist/electron/main.cjs` 빌드 성공, 테스트 397개 통과(기존 366개와 Task 1, 2의 31개)

- [ ] **Step 5: 커밋**

```bash
git add electron/updater/index.ts electron/menu.ts electron/main.ts
git commit -m "feat: 실행 시와 앱 메뉴에서 업데이트를 확인하고 설치"
```

---

### Task 4: 릴리스 스크립트와 README

**Files:**
- Create: `scripts/release.sh`
- Modify: `package.json` (`scripts`), `README.md` (`직접 빌드` 아래)

**Interfaces:**
- Consumes: `package.json`의 `build:app`, `test` 스크립트, `electron-builder.yml`의 `artifactName: reviewHelper-${version}.${ext}`
- Produces: `pnpm run release <patch|minor|major>`

- [ ] **Step 1: `scripts/release.sh` 작성**

```bash
#!/usr/bin/env bash
set -euo pipefail

bump="${1:-}"
case "$bump" in
  patch | minor | major) ;;
  *)
    echo "사용법: pnpm run release <patch|minor|major>" >&2
    exit 1
    ;;
esac

if [ "$(git branch --show-current)" != "main" ]; then
  echo "main 브랜치에서 실행해 주세요" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "커밋하지 않은 변경사항이 있습니다" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh auth login 으로 GitHub에 로그인해 주세요" >&2
  exit 1
fi

pnpm version "$bump" -m "chore: v%s 버전업"
version="$(node -p "require('./package.json').version")"
tag="v$version"

if ! pnpm test || ! pnpm run build:app; then
  git tag -d "$tag"
  git reset --hard HEAD~1
  echo "테스트나 빌드가 실패해서 $tag 버전업을 되돌렸습니다" >&2
  exit 1
fi

previous="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' HEAD~1 2>/dev/null || true)"
if [ -n "$previous" ]; then
  notes="$(git log "$previous..HEAD~1" --pretty='- %s')"
else
  notes="첫 릴리스"
fi

git push origin main --follow-tags

zip="release/reviewHelper-$version.zip"
if ! gh release create "$tag" "$zip" --repo BoubleJ/diffx --title "$tag" --notes "$notes"; then
  echo "Release를 만들지 못했습니다. 아래 명령으로 다시 실행해 주세요" >&2
  printf 'gh release create %q %q --repo BoubleJ/diffx --title %q --notes %q\n' "$tag" "$zip" "$tag" "$notes" >&2
  exit 1
fi

cp "$zip" "$HOME/Desktop/"
echo "$tag 릴리스를 올렸습니다"
```

- [ ] **Step 2: `package.json`에 스크립트 추가**

`scripts`의 `"build:app"` 줄 아래에 추가한다.

```json
    "release": "bash scripts/release.sh",
```

- [ ] **Step 3: 스크립트의 문법과 인자 검사 확인**

Run: `bash -n scripts/release.sh && pnpm run release foo; echo "exit=$?"`
Expected: `사용법: pnpm run release <patch|minor|major>` 출력, `exit=1`

Run: `pnpm run release patch; echo "exit=$?"`
Expected: 현재 브랜치가 `feature/auto-update`이므로 `main 브랜치에서 실행해 주세요` 출력, `exit=1`. `package.json` 버전이 바뀌지 않았는지 `git status --short`로 확인한다.

- [ ] **Step 4: README에 릴리스와 자동 업데이트 설명 추가**

`README.md`의 `### 직접 빌드` 섹션(`` `release/reviewHelper-<버전>.zip`이 만들어진다. ... `` 문단) 바로 아래, `## 개발` 위에 추가한다.

````markdown
### 자동 업데이트

앱 실행 시 GitHub Release(`BoubleJ/diffx`)의 최신 버전을 확인한다. 앱 메뉴의 `업데이트 확인...` 클릭 시에도 확인한다.

1. 새 버전이 있으면 현재 버전과 Release 노트가 담긴 대화상자가 열린다.
2. `지금 업데이트` 클릭 시 zip을 내려받는다. 내려받는 동안 Dock 아이콘에 진행률 막대가 표시된다.
3. 다 받으면 앱이 종료되고 기존 `reviewHelper.app`이 새 버전으로 교체된 뒤 다시 실행된다.

`나중에`를 누르면 다음 실행 때 다시 확인한다. 설정과 AI 리뷰 기록은 `~/Library/Application Support/reviewHelper`에 있어서 업데이트 후에도 남는다.

브라우저로 받은 zip을 풀고 앱을 옮기지 않은 채 실행하면 macOS가 앱을 읽기 전용 임시 경로에서 실행해서 교체할 수 없다. 이때는 앱을 `/Applications`나 다른 폴더로 옮긴 뒤 다시 실행한다.

1.0.0에는 업데이트 기능이 없다. 업데이트 기능이 들어간 첫 버전은 zip으로 한 번 직접 설치한다.

### 릴리스

1. gh를 설치하고 GitHub에 로그인한다. 처음 한 번만 한다.
   ```bash
   brew install gh
   gh auth login
   ```
2. `main` 브랜치에서 커밋하지 않은 변경이 없는 상태로 실행한다.
   ```bash
   pnpm run release patch   # 또는 minor, major
   ```
3. 스크립트가 아래 순서로 실행한다.
   - `package.json` 버전을 올리고 `chore: v1.0.1 버전업` 커밋과 `v1.0.1` 태그를 만든다.
   - 테스트와 `build:app`을 실행한다. 실패하면 버전업 커밋과 태그를 되돌린다.
   - 커밋과 태그를 push한다.
   - 이전 태그 이후의 커밋 제목으로 Release 노트를 만들고 `v1.0.1` Release에 `reviewHelper-1.0.1.zip`을 올린다.
   - zip을 바탕화면에 복사한다.
````

- [ ] **Step 5: 커밋**

```bash
git add scripts/release.sh package.json README.md
git commit -m "feat: GitHub Release 릴리스 스크립트와 자동 업데이트 문서 추가"
```

---

### Task 5: 실제 업데이트 확인

이 Task는 push와 Release 생성을 포함한다. 단계마다 사용자에게 확인을 받고 진행한다.

- [ ] **Step 1: gh 준비 (사용자)**

사용자가 `brew install gh`와 `! gh auth login`을 실행한다. `gh auth status`가 성공하는지 확인한다.

- [ ] **Step 2: `main`에 머지 (사용자 승인 필요)**

```bash
git switch main
git merge --ff-only feature/auto-update
git branch -d feature/auto-update
```

FF 머지가 안 되면 멈추고 사용자에게 알린다.

- [ ] **Step 3: 1.1.0 릴리스와 직접 설치**

Run: `pnpm run release minor`
Expected: `v1.1.0` 태그와 Release가 만들어지고 `~/Desktop/reviewHelper-1.1.0.zip`이 복사된다. `https://github.com/BoubleJ/diffx/releases/tag/v1.1.0`에 zip이 첨부되어 있다.

사용자가 실행 중인 reviewHelper를 종료하고 바탕화면의 `reviewHelper.app`을 1.1.0 zip에서 푼 앱으로 교체한다. 1.1.0 앱을 실행하고 앱 메뉴의 `업데이트 확인...` 클릭 시 "최신 버전을 사용 중입니다 (1.1.0)"이 나오는지 확인한다.

- [ ] **Step 4: 1.1.1 릴리스**

작은 변경(예: README 오탈자)을 커밋하고 `pnpm run release patch`를 실행한다.
Expected: `v1.1.1` Release가 만들어지고 Release 노트에 그 커밋 제목이 들어 있다.

- [ ] **Step 5: 자동 업데이트 확인 (사용자)**

1. 1.1.0 앱을 다시 실행한다.
2. "새 버전(1.1.1)을 설치할 수 있습니다" 대화상자와 "현재 버전: 1.1.0", Release 노트가 보이는지 확인한다.
3. `지금 업데이트` 클릭 시 Dock 아이콘에 진행률 막대가 보이는지 확인한다.
4. 앱이 종료되고 다시 실행된 뒤 앱 메뉴의 `업데이트 확인...` 클릭 시 "최신 버전을 사용 중입니다 (1.1.1)"이 나오는지 확인한다.
5. 저장소 최근 목록과 AI 리뷰 기록이 그대로 남아 있는지 확인한다.
