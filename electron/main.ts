import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fixPath } from './shellPath.js'
import { RecentStore } from './recent.js'
import { RepoWindows, type OpenResult } from './repoWindows.js'
import { buildMenu } from './menu.js'

const pendingOpen: string[] = []
let initialized = false
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (initialized) void openRepo(path)
  else pendingOpen.push(path)
})

let launcher: BrowserWindow | null = null
let repoWindows: RepoWindows
let recent: RecentStore

function refreshMenu() {
  Menu.setApplicationMenu(buildMenu({
    openFolder: () => void selectFolder({ fromMenu: true }),
    openRecent: (path) => void openRepo(path),
    recent: recent.list(),
  }))
}

function showLauncher() {
  if (launcher) {
    launcher.focus()
    return
  }
  launcher = new BrowserWindow({
    width: 560,
    height: 520,
    resizable: false,
    title: 'diffx',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  })
  launcher.on('closed', () => {
    launcher = null
  })
  void launcher.loadFile(join(app.getAppPath(), 'electron', 'launcher', 'index.html'))
}

async function openRepo(path: string): Promise<OpenResult> {
  if (!existsSync(path)) return { ok: false, error: '폴더를 찾지 못했습니다' }
  try {
    const result = await repoWindows.open(path)
    if (result.ok) launcher?.close()
    return result
  } catch (err) {
    return { ok: false, error: `저장소를 열지 못했습니다: ${(err as Error).message}` }
  }
}

async function selectFolder({ fromMenu = false } = {}): Promise<OpenResult | { ok: false; error: 'cancelled' }> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '저장소 폴더 선택' })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, error: 'cancelled' }
  const opened = await openRepo(result.filePaths[0])
  if (!opened.ok && fromMenu) {
    showLauncher()
    void dialog.showMessageBox({ type: 'warning', message: opened.error })
  }
  return opened
}

function checkGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

app.whenReady().then(async () => {
  await fixPath()
  if (!checkGit()) {
    await dialog.showMessageBox({ type: 'error', message: 'git을 찾지 못했습니다', detail: 'Xcode Command Line Tools(xcode-select --install)나 Homebrew로 git을 설치한 뒤 다시 실행해 주세요.' })
    app.quit()
    return
  }

  recent = new RecentStore(join(app.getPath('userData'), 'recent.json'))
  repoWindows = new RepoWindows({
    clientDir: join(app.getAppPath(), 'dist', 'client'),
    recent,
    onRecentChange: refreshMenu,
  })
  refreshMenu()

  ipcMain.handle('diffx:select-folder', () => selectFolder())
  ipcMain.handle('diffx:open-repo', (_e, path: unknown) => {
    if (typeof path !== 'string' || !isAbsolute(path)) return { ok: false, error: '폴더 경로가 올바르지 않습니다' }
    return openRepo(path)
  })
  ipcMain.handle('diffx:get-recent', () => recent.list())
  ipcMain.handle('diffx:remove-recent', (_e, path: unknown) => {
    if (typeof path !== 'string' || !isAbsolute(path)) return recent.list()
    const list = recent.remove(path)
    refreshMenu()
    return list
  })

  initialized = true
  if (pendingOpen.length > 0) {
    for (const path of pendingOpen.splice(0)) await openRepo(path)
  } else {
    showLauncher()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) showLauncher()
})

app.on('window-all-closed', () => {
  // macOS 관례대로 창을 모두 닫아도 앱을 종료하지 않는다.
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !repoWindows) return
  event.preventDefault()
  quitting = true
  void Promise.race([repoWindows.closeAll(), new Promise((r) => setTimeout(r, 2000))]).catch(() => {}).then(() => app.quit())
})
