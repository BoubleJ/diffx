import { execFile, spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getWorktreeFileContent } from '../git.js'
import { isSafePath } from '../path.js'
import { SOURCE_EXTENSIONS } from './sourceFiles.js'

export interface GrepHit {
  path: string
  line: number
  text: string
}

export interface SourceReader {
  readFile(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  grep(pattern: string): Promise<GrepHit[]>
  close(): void
}

export type GitFn = (repo: string, args: string[], timeout?: number) => Promise<string>
export type SpawnFn = (command: string, args: string[], options: { cwd: string }) => ChildProcessWithoutNullStreams

const PATHSPECS = [
  ...SOURCE_EXTENSIONS.map((ext) => `*${ext}`),
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/dist/**',
  ':(exclude,glob)**/.nuxt/**',
  ':(exclude,glob)**/.next/**',
]

const GIT_PREFIX = ['-c', 'core.quotepath=false']
const GREP_TIMEOUT_MS = 10_000
const MAX_BUFFER = 50 * 1024 * 1024

export const runGit: GitFn = (repo, args, timeout) =>
  new Promise((done, fail) => {
    execFile('git', [...GIT_PREFIX, ...args], { cwd: repo, encoding: 'utf-8', maxBuffer: MAX_BUFFER, timeout }, (err, stdout) => {
      if (err) fail(err)
      else done(stdout)
    })
  })

async function runGrep(git: GitFn, repo: string, args: string[], prefix: string): Promise<GrepHit[]> {
  let output: string
  try {
    output = await git(repo, ['grep', '-n', '-I', '-E', ...args], GREP_TIMEOUT_MS)
  } catch (err) {
    const { code, signal } = err as { code?: number | string; signal?: string }
    if (code === 1 || signal === 'SIGTERM') return []
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

class BatchReader {
  private proc: ChildProcessWithoutNullStreams | null = null
  private stopped = false
  private buffer = Buffer.alloc(0)
  private waiting: ((content: string | null) => void)[] = []

  constructor(private repo: string, private spawnFn: SpawnFn) {}

  read(spec: string): Promise<string | null> {
    if (this.stopped) return Promise.resolve(null)
    const proc = this.start()
    return new Promise((done) => {
      this.waiting.push(done)
      proc.stdin.write(`${spec}\n`)
    })
  }

  close(): void {
    this.stop()
    this.proc?.kill()
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const proc = this.spawnFn('git', [...GIT_PREFIX, 'cat-file', '--batch'], { cwd: this.repo })
    proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    proc.on('error', () => this.stop())
    proc.on('close', () => this.stop())
    proc.stdin.on('error', () => this.stop())
    this.proc = proc
    return proc
  }

  private drain(): void {
    while (this.waiting.length > 0) {
      const newline = this.buffer.indexOf(0x0a)
      if (newline < 0) return
      const header = this.buffer.subarray(0, newline).toString('utf-8')
      const m = header.match(/^[0-9a-f]+ (\S+) (\d+)$/)
      if (!m) {
        this.buffer = this.buffer.subarray(newline + 1)
        this.waiting.shift()!(null)
        continue
      }
      const end = newline + 1 + Number(m[2])
      if (this.buffer.length < end + 1) return
      const content = this.buffer.subarray(newline + 1, end)
      this.buffer = this.buffer.subarray(end + 1)
      this.waiting.shift()!(m[1] === 'blob' ? content.toString('utf-8') : null)
    }
  }

  private stop(): void {
    this.stopped = true
    for (const done of this.waiting.splice(0)) done(null)
  }
}

export function worktreeReader(repo: string): SourceReader {
  return {
    readFile: async (path) => getWorktreeFileContent(repo, path),
    exists: async (path) => {
      if (!isSafePath(path, repo)) return false
      try {
        return statSync(resolve(repo, path)).isFile()
      } catch {
        return false
      }
    },
    grep: (pattern) => runGrep(runGit, repo, ['--untracked', '-e', pattern, '--', ...PATHSPECS], ''),
    close: () => {},
  }
}

export function commitReader(repo: string, sha: string, options: { spawn?: SpawnFn; git?: GitFn } = {}): SourceReader {
  const git = options.git ?? runGit
  const batch = new BatchReader(repo, options.spawn ?? (nodeSpawn as SpawnFn))
  const files = new Map<string, Promise<string | null>>()
  let tree: Promise<Set<string>> | null = null
  const listFiles = () => {
    tree ??= git(repo, ['ls-tree', '-r', '-z', sha])
      .then((out) => new Set(out.split('\0').filter((entry) => entry.split(' ', 3)[1] === 'blob').map((entry) => entry.slice(entry.indexOf('\t') + 1))))
      .catch(() => new Set<string>())
    return tree
  }
  return {
    readFile: (path) => {
      if (!isSafePath(path, repo) || path.includes('\n')) return Promise.resolve(null)
      let cached = files.get(path)
      if (!cached) {
        cached = batch.read(`${sha}:${path}`)
        files.set(path, cached)
      }
      return cached
    },
    exists: async (path) => isSafePath(path, repo) && (await listFiles()).has(path),
    grep: (pattern) => runGrep(git, repo, ['-e', pattern, sha, '--', ...PATHSPECS], `${sha}:`),
    close: () => batch.close(),
  }
}
