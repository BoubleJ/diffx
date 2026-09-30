import { execFile, execFileSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { isSafePath } from './path.js'
import { parseSync as parseEditorConfig, type ProcessedFileConfig } from 'editorconfig'

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
])

const MAX_BUFFER = 50 * 1024 * 1024

const QUOTEPATH_OFF = ['-c', 'core.quotepath=false']

function run(repo: string, args: string[]): string {
  return execFileSync('git', [...QUOTEPATH_OFF, ...args], { cwd: repo, encoding: 'utf-8', stdio: 'pipe', maxBuffer: MAX_BUFFER })
}

function runBuffer(repo: string, args: string[]): Buffer {
  return execFileSync('git', [...QUOTEPATH_OFF, ...args], { cwd: repo, stdio: 'pipe', maxBuffer: MAX_BUFFER })
}

export function isImageFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

const BLOB_OID_REGEX = /^[0-9a-f]{4,64}$/

export function getBlobContent(repo: string, oid: string): string | null {
  if (!BLOB_OID_REGEX.test(oid) || /^0+$/.test(oid)) {
    return null
  }
  try {
    return run(repo, ['cat-file', 'blob', oid])
  } catch {
    return null
  }
}

export function getWorktreeFileContent(repo: string, filePath: string): string | null {
  if (!isSafePath(filePath, repo)) {
    return null
  }
  const resolved = resolve(repo, filePath)
  try {
    // Match git's notion of the worktree blob: for a symlink that is the
    // target string, never the contents of the file it points at (which
    // could be outside the repository).
    const stats = lstatSync(resolved)
    if (stats.isSymbolicLink()) {
      return readlinkSync(resolved, 'utf-8')
    }
    if (!stats.isFile()) {
      return null
    }
    return readFileSync(resolved, 'utf-8')
  } catch {
    return null
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync('git', [...QUOTEPATH_OFF, 'rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getRepoRoot(cwd: string): string {
  return execFileSync('git', [...QUOTEPATH_OFF, 'rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
}

export function getRepoName(repo: string): string {
  return basename(repo)
}

export function getBranchName(repo: string): string {
  try {
    return run(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  } catch {
    return ''
  }
}

// Force standard unified diff regardless of user's git config
// (e.g. diff.external = difftastic, color.ui = always).
const DIFF_FLAGS = ['--no-ext-diff', '--no-color'] as const

export function getTabSizeForFiles(repo: string, filePaths: string[]): Record<string, number> {
  const cache = new Map<string, ProcessedFileConfig>()
  const result: Record<string, number> = {}
  for (const filePath of filePaths) {
    try {
      const absPath = join(repo, filePath)
      const config = parseEditorConfig(absPath, { cache })
      const size = config.tab_width ?? (config.indent_size === 'tab' ? undefined : config.indent_size)
      if (typeof size === 'number') {
        result[filePath] = size
      }
    } catch {
      // skip files that fail to resolve
    }
  }
  return result
}

export interface BranchList {
  local: string[]
  remote: string[]
  current: string
  defaultTarget: string | null
}

export function listBranches(repo: string): BranchList {
  const output = run(repo, ['for-each-ref', '--format=%(refname)%00%(symref)', 'refs/heads', 'refs/remotes'])
  const local: string[] = []
  const remote: string[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const [ref, symref] = line.split('\0')
    if (symref) continue
    if (ref.startsWith('refs/heads/')) local.push(ref.slice('refs/heads/'.length))
    else if (ref.startsWith('refs/remotes/')) remote.push(ref.slice('refs/remotes/'.length))
  }
  local.sort()
  remote.sort()
  return { local, remote, current: getBranchName(repo), defaultTarget: findDefaultTarget(repo, local, remote) }
}

function findDefaultTarget(repo: string, local: string[], remote: string[]): string | null {
  try {
    const head = run(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).trim()
    if (head) return head
  } catch {
  }
  const all = new Set([...local, ...remote])
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (all.has(candidate)) return candidate
  }
  return null
}

export function resolveCommit(repo: string, ref: string): string | null {
  if (!ref || ref.startsWith('-')) return null
  try {
    return run(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null
  } catch {
    return null
  }
}

const SHA_REGEX = /^[0-9a-f]{40,64}$/

export function getMergeBase(repo: string, a: string, b: string): string | null {
  if (!SHA_REGEX.test(a) || !SHA_REGEX.test(b)) return null
  try {
    return run(repo, ['merge-base', a, b]).trim() || null
  } catch {
    return null
  }
}

export function getRangeDiff(repo: string, fromSha: string, toSha: string): string {
  if (!SHA_REGEX.test(fromSha) || !SHA_REGEX.test(toSha)) throw new Error('invalid commit sha')
  return run(repo, ['diff', ...DIFF_FLAGS, fromSha, toSha])
}

export function getFileAtCommit(repo: string, sha: string, filePath: string): Buffer | null {
  if (!SHA_REGEX.test(sha) || !filePath || !isSafePath(filePath, repo)) return null
  try {
    return runBuffer(repo, ['show', `${sha}:${filePath}`])
  } catch {
    return null
  }
}

export function getHeadSha(repo: string): string | null {
  return resolveCommit(repo, 'HEAD')
}

export function hasCommit(repo: string, sha: string): boolean {
  if (!SHA_REGEX.test(sha)) return false
  try {
    run(repo, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

type FetchResult = { ok: true } | { ok: false; error: string }

function runFetch(repo: string, args: string[], timeoutMs: number): Promise<FetchResult> {
  return new Promise((done) => {
    execFile(
      'git',
      [...QUOTEPATH_OFF, 'fetch', ...args],
      { cwd: repo, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, _stdout, stderr) => {
        if (!err) return done({ ok: true })
        const message = stderr?.toString().trim() || err.message
        done({ ok: false, error: err.killed ? `git fetch가 ${timeoutMs / 1000}초 안에 끝나지 않았습니다` : message })
      },
    )
  })
}

export function fetchAll(repo: string, timeoutMs = 60_000): Promise<FetchResult> {
  return runFetch(repo, ['--all', '--prune'], timeoutMs)
}

export function fetchRefs(repo: string, remote: string, refspecs: string[], timeoutMs = 60_000): Promise<FetchResult> {
  if (remote.startsWith('-') || refspecs.some((r) => r.startsWith('-'))) {
    return Promise.resolve({ ok: false, error: 'invalid fetch arguments' })
  }
  return runFetch(repo, ['--no-tags', remote, ...refspecs], timeoutMs)
}

export interface RemoteInfo {
  name: string
  url: string
}

export function listRemotes(repo: string): RemoteInfo[] {
  let output: string
  try {
    output = run(repo, ['remote', '-v'])
  } catch {
    return []
  }
  const remotes: RemoteInfo[] = []
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\t(\S+) \(fetch\)$/)
    if (match) remotes.push({ name: match[1], url: match[2] })
  }
  return remotes
}
