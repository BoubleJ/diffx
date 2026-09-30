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
  idleTimeoutMs = 30_000,
): Promise<void> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const resetTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }
  resetTimer()
  try {
    const res = await fetchFn(url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`다운로드 응답 ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        resetTimer()
        received += chunk.length
        onProgress(total ? Math.min(received / total, 1) : null)
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), progress, createWriteStream(dest), {
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) throw new Error('다운로드가 멈춰서 중단했습니다')
    throw err
  } finally {
    clearTimeout(timer)
  }
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

export async function startSwap(opts: {
  pid: number
  currentAppPath: string
  newAppPath: string
  workDir: string
  shell?: string
}): Promise<void> {
  const script = join(opts.workDir, 'swap.sh')
  await writeFile(script, SWAP_SCRIPT)
  const backup = join(opts.workDir, 'backup.app')
  const child = spawn(opts.shell ?? '/bin/sh', [script, String(opts.pid), opts.currentAppPath, opts.newAppPath, backup], {
    detached: true,
    stdio: 'ignore',
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}
