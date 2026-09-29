import { execFileSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { readFileSync, lstatSync, readlinkSync } from 'node:fs'
import { isSafePath } from './path.js'
import { parseSync as parseEditorConfig, type ProcessedFileConfig } from 'editorconfig'

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
])

const MAX_BUFFER = 50 * 1024 * 1024

function run(repo: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: 'pipe', maxBuffer: MAX_BUFFER })
}

function runBuffer(repo: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: repo, stdio: 'pipe', maxBuffer: MAX_BUFFER })
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
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function getRepoRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
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
