import { app, BrowserWindow, dialog } from 'electron'
import { fetchLatestRelease, releaseDetail } from './github.js'
import { appBundlePath, checkInstallable, prepareUpdate, startSwap } from './install.js'
import { isNewer } from './version.js'
import { AutoCheckPolicy } from './autoCheck.js'

const HOUR = 60 * 60 * 1000
export const PERIODIC_CHECK_MS = 6 * HOUR

let installing = false
let prompting = false
const autoCheck = new AutoCheckPolicy(HOUR)

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
  if (!manual) {
    if (!autoCheck.shouldCheck(Date.now())) return
    autoCheck.markChecked(Date.now())
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
  if (!manual && autoCheck.isDismissed(latest.version)) return
  if (prompting) return
  prompting = true
  let response: number
  try {
    if (!latest.zipUrl) {
      autoCheck.dismiss(latest.version)
      await dialog.showMessageBox({ type: 'warning', message: '이 Release에는 설치 파일이 없습니다', detail: `새 버전: ${latest.version}` })
      return
    }
    response = (await dialog.showMessageBox({
      type: 'info',
      message: `새 버전(${latest.version})을 설치할 수 있습니다`,
      detail: releaseDetail(current, latest.notes),
      buttons: ['지금 업데이트', '나중에'],
      defaultId: 0,
      cancelId: 1,
    })).response
  } finally {
    prompting = false
  }
  if (response !== 0) {
    autoCheck.dismiss(latest.version)
    return
  }
  if (installing) return
  await install(latest.version, latest.zipUrl)
}
