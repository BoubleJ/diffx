import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getFileAtCommit, getWorktreeFileContent } from '../git.js'
import { isSafePath } from '../path.js'
import { SOURCE_EXTENSIONS } from './sourceFiles.js'

export interface GrepHit {
  path: string
  line: number
  text: string
}

export interface SourceReader {
  readFile(path: string): string | null
  exists(path: string): boolean
  grep(pattern: string): GrepHit[]
}

const PATHSPECS = [
  ...SOURCE_EXTENSIONS.map((ext) => `*${ext}`),
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/dist/**',
  ':(exclude,glob)**/.nuxt/**',
  ':(exclude,glob)**/.next/**',
]

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: repo, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 })
}

function runGrep(repo: string, args: string[], prefix: string): GrepHit[] {
  let output: string
  try {
    output = git(repo, ['grep', '-n', '-I', '-E', ...args])
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []
    throw err
  }
  const hits: GrepHit[] = []
  for (const raw of output.split('\n')) {
    if (!raw.startsWith(prefix)) continue
    const m = raw.slice(prefix.length).match(/^(.*?):(\d+):(.*)$/)
    if (m) hits.push({ path: m[1], line: Number(m[2]), text: m[3] })
  }
  return hits
}

export function worktreeReader(repo: string): SourceReader {
  return {
    readFile: (path) => getWorktreeFileContent(repo, path),
    exists: (path) => {
      if (!isSafePath(path, repo)) return false
      try {
        return statSync(resolve(repo, path)).isFile()
      } catch {
        return false
      }
    },
    grep: (pattern) => runGrep(repo, ['--untracked', '-e', pattern, '--', ...PATHSPECS], ''),
  }
}

export function commitReader(repo: string, sha: string): SourceReader {
  return {
    readFile: (path) => getFileAtCommit(repo, sha, path)?.toString('utf-8') ?? null,
    exists: (path) => {
      if (!isSafePath(path, repo)) return false
      try {
        return git(repo, ['cat-file', '-t', `${sha}:${path}`]).trim() === 'blob'
      } catch {
        return false
      }
    },
    grep: (pattern) => runGrep(repo, ['-e', pattern, sha, '--', ...PATHSPECS], `${sha}:`),
  }
}
