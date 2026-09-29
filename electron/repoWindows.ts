import { BrowserWindow, session, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { getRepoName, getRepoRoot, isGitRepo } from '../src/git.js'
import { startServer } from '../src/server.js'
import { startOnPreferredPort } from './port.js'
import type { RecentStore } from './recent.js'

export type OpenResult = { ok: true } | { ok: false; error: string }

interface RepoWindow {
  window: BrowserWindow
  port: number
  close: () => Promise<void>
}

export class RepoWindows {
  private windows = new Map<string, RepoWindow>()
  private tokens = new Map<number, string>()

  constructor(private deps: { clientDir: string; recent: RecentStore; onRecentChange: () => void }) {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:*/*'] }, (details, callback) => {
      const port = Number(new URL(details.url).port)
      const token = this.tokens.get(port)
      if (token) details.requestHeaders['X-Diffx-Token'] = token
      callback({ requestHeaders: details.requestHeaders })
    })
  }

  count(): number {
    return this.windows.size
  }

  async open(folder: string): Promise<OpenResult> {
    if (!isGitRepo(folder)) return { ok: false, error: 'git 저장소가 아닙니다' }
    const repoPath = getRepoRoot(folder)
    const existing = this.windows.get(repoPath)
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.focus()
      return { ok: true }
    }

    const name = getRepoName(repoPath)
    const saved = this.deps.recent.list().find((r) => r.path === repoPath)
    const token = randomBytes(32).toString('hex')
    const server = await startOnPreferredPort(
      (port) => startServer({ repoPath, clientDir: this.deps.clientDir, port, host: '127.0.0.1', token }),
      saved?.port ?? null,
    )
    this.tokens.set(server.port, token)
    this.deps.recent.touch(repoPath, name)
    this.deps.recent.setPort(repoPath, server.port)
    this.deps.onRecentChange()

    const origin = `http://127.0.0.1:${server.port}`
    const window = new BrowserWindow({
      width: 1400,
      height: 900,
      title: name,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin)) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })
    window.on('page-title-updated', (event) => event.preventDefault())
    window.on('closed', () => {
      this.windows.delete(repoPath)
      this.tokens.delete(server.port)
      server.close()
    })

    this.windows.set(repoPath, { window, port: server.port, close: server.close })
    await window.loadURL(origin)
    return { ok: true }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.windows.values()].map((w) => w.close()))
    this.windows.clear()
    this.tokens.clear()
  }
}
