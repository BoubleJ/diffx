import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appBundlePath, checkInstallable, downloadFile, prepareUpdate, startSwap, SWAP_SCRIPT } from './install'

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

function makeAppZip(version: string): Uint8Array<ArrayBuffer> {
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

  it('fails when the download stops sending data', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      },
    })
    await expect(
      downloadFile('https://example.com/file', join(dir, 'file.bin'), () => {}, serve(stalled), 50),
    ).rejects.toThrow('다운로드가 멈춰서 중단했습니다')
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

describe('startSwap', () => {
  const swapOpts = () => ({ pid: 1, currentAppPath: join(dir, 'a.app'), newAppPath: join(dir, 'b.app'), workDir: dir })

  it('writes the swap script and resolves once the shell starts', async () => {
    await startSwap({ ...swapOpts(), shell: '/usr/bin/true' })
    expect(readFileSync(join(dir, 'swap.sh'), 'utf8')).toBe(SWAP_SCRIPT)
  })

  it('rejects when the shell cannot be started', async () => {
    await expect(startSwap({ ...swapOpts(), shell: join(dir, 'missing-sh') })).rejects.toThrow('ENOENT')
  })
})
