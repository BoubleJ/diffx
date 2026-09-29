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

function isBinaryFile(absolutePath: string): boolean {
  try {
    const buffer = readFileSync(absolutePath)
    const bytesToCheck = Math.min(buffer.length, 8192)
    for (let i = 0; i < bytesToCheck; i++) {
      if (buffer[i] === 0) return true
    }
    return false
  } catch {
    return true
  }
}

export function getFileContent(repo: string, filePath: string, version: 'old' | 'new'): Buffer | null {
  if (!isSafePath(filePath, repo)) {
    return null
  }
  const resolved = resolve(repo, filePath)
  if (version === 'new') {
    try {
      return readFileSync(resolved)
    } catch {
      return null
    }
  }
  // old version: try staged first, then HEAD
  try {
    return runBuffer(repo, ['show', `HEAD:${filePath}`])
  } catch {
    return null
  }
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

export function getCustomGitDiff(repo: string, args: string[]): string {
  return run(repo, ['diff', ...DIFF_FLAGS, ...args])
}

export function getGitDiff(repo: string, options: { staged?: boolean; untracked?: boolean } = {}): string {
  const parts: string[] = []

  // unstaged changes (always included as the base)
  const unstaged = run(repo, ['diff', ...DIFF_FLAGS])
  if (unstaged) parts.push(unstaged)

  // staged changes
  if (options.staged) {
    const staged = run(repo, ['diff', ...DIFF_FLAGS, '--staged'])
    if (staged) parts.push(staged)
  }

  // untracked files
  if (options.untracked) {
    const untrackedPatch = getUntrackedFilesDiff(repo)
    if (untrackedPatch) parts.push(untrackedPatch)
  }

  return parts.join('\n')
}

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

export function getUntrackedFilePaths(repo: string): string[] {
  const output = run(repo, ['ls-files', '--others', '--exclude-standard']).trim()
  return output ? output.split('\n') : []
}

function getUntrackedFilesDiff(repo: string): string {
  const files = getUntrackedFilePaths(repo)
  if (files.length === 0) return ''

  const patches: string[] = []

  for (const file of files) {
    const absolutePath = join(repo, file)
    if (isBinaryFile(absolutePath)) {
      const patch = [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..0000001',
        `Binary files /dev/null and b/${file} differ`,
      ].join('\n')
      patches.push(patch)
    } else {
      try {
        const content = readFileSync(absolutePath, 'utf-8')
        const lines = content.split('\n')
        const diffLines = lines.map((l: string) => `+${l}`)
        const patch = [
          `diff --git a/${file} b/${file}`,
          'new file mode 100644',
          'index 0000000..0000001',
          '--- /dev/null',
          `+++ b/${file}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...diffLines,
        ].join('\n')
        patches.push(patch)
      } catch {
        // skip unreadable files
      }
    }
  }

  return patches.length > 0 ? '\n' + patches.join('\n') : ''
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
    // origin/HEAD is not set
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

export function fetchAll(repo: string, timeoutMs = 60_000): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((done) => {
    execFile(
      'git',
      [...QUOTEPATH_OFF, 'fetch', '--all', '--prune'],
      { cwd: repo, timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, _stdout, stderr) => {
        if (!err) return done({ ok: true })
        const message = stderr?.toString().trim() || err.message
        done({ ok: false, error: err.killed ? `git fetch가 ${timeoutMs / 1000}초 안에 끝나지 않았습니다` : message })
      },
    )
  })
}
