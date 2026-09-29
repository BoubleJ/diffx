import { BrowserWindow, session, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { getRepoName, getRepoRoot, isGitRepo } from '../src/git.js'
import { startServer } from '../src/server.js'
import { startOnPreferredPort } from './port.js'
import type { RecentStore } from './recent.js'
import { isExternalHttpUrl, isSameOrigin } from './urls.js'

export type OpenResult = { ok: true } | { ok: false; error: string }

interface RepoWindow {
  window: BrowserWindow
  close: () => Promise<void>
}

function openExternalSafe(url: string): void {
  if (isExternalHttpUrl(url)) shell.openExternal(url)
}

export class RepoWindows {
  private windows = new Map<string, RepoWindow>()
  private pending = new Map<string, Promise<OpenResult>>()
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

    const inFlight = this.pending.get(repoPath)
    if (inFlight) return inFlight
    const promise = this.launch(repoPath).finally(() => this.pending.delete(repoPath))
    this.pending.set(repoPath, promise)
    return promise
  }

  private async launch(repoPath: string): Promise<OpenResult> {
    const name = getRepoName(repoPath)
    const saved = this.deps.recent.list().find((r) => r.path === repoPath)
    const token = randomBytes(32).toString('hex')
    const server = await startOnPreferredPort(
      (port) => startServer({ repoPath, clientDir: this.deps.clientDir, port, host: '127.0.0.1', token }),
      saved?.port ?? null,
    )
    let window: BrowserWindow | undefined
    try {
      this.tokens.set(server.port, token)
      this.deps.recent.touch(repoPath, name)
      this.deps.recent.setPort(repoPath, server.port)
      this.deps.onRecentChange()

      const origin = `http://127.0.0.1:${server.port}`
      const created = new BrowserWindow({
        width: 1400,
        height: 900,
        title: name,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      })
      window = created
      created.webContents.setWindowOpenHandler(({ url }) => {
        openExternalSafe(url)
        return { action: 'deny' }
      })
      const guardNavigation = (event: { preventDefault: () => void }, url: string) => {
        if (!isSameOrigin(url, origin)) {
          event.preventDefault()
          openExternalSafe(url)
        }
      }
      created.webContents.on('will-navigate', guardNavigation)
      created.webContents.on('will-redirect', guardNavigation)
      created.on('page-title-updated', (event) => event.preventDefault())
      created.on('closed', () => {
        if (this.windows.get(repoPath)?.window === created) this.windows.delete(repoPath)
        this.tokens.delete(server.port)
        server.close().catch(() => {})
      })

      this.windows.set(repoPath, { window: created, close: server.close })
      try {
        await created.loadURL(origin)
      } catch (err) {
        const aborted = (err as { code?: string }).code === 'ERR_ABORTED' && created.isDestroyed()
        if (!aborted) throw err
      }
      return { ok: true }
    } catch (err) {
      this.tokens.delete(server.port)
      if (this.windows.get(repoPath)?.window === window) this.windows.delete(repoPath)
      if (window && !window.isDestroyed()) window.destroy()
      await server.close().catch(() => {})
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `저장소를 열지 못했습니다: ${message}` }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.windows.values()].map((w) => w.close()))
    this.windows.clear()
    this.tokens.clear()
  }
}
