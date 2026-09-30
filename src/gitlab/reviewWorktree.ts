import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { APP_DATA_DIR } from '../appData.js'
import { getRepoName } from '../git.js'

export const DEFAULT_WORKTREE_ROOT = join(APP_DATA_DIR, 'worktrees')

export type ReviewWorktreeStatus = { exists: false } | { exists: true; path: string; headSha: string | null }

export type CheckoutResult =
  | { kind: 'dirty'; files: string[] }
  | { kind: 'done'; path: string; headSha: string; copiedEnvFiles: string[] }

export class WorktreeGitError extends Error {}

const TIMEOUT_MS = 60_000
const SHA_REGEX = /^[0-9a-f]{40,64}$/

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', ...args],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        if (!err) return done(stdout)
        fail(new WorktreeGitError(err.killed ? `git ${args[0]} 명령이 ${TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다` : stderr.trim() || err.message))
      },
    )
  })
}

export function reviewWorktreePath(root: string, repo: string): string {
  const hash = createHash('sha256').update(repo).digest('hex').slice(0, 8)
  return join(root, `${getRepoName(repo)}-${hash}`)
}

async function isWorktree(path: string): Promise<boolean> {
  try {
    return (await runGit(path, ['rev-parse', '--show-toplevel'])).trim() === realpathSync(path)
  } catch {
    return false
  }
}

export async function getReviewWorktree(root: string, repo: string): Promise<ReviewWorktreeStatus> {
  const path = reviewWorktreePath(root, repo)
  if (!existsSync(path)) return { exists: false }
  if (!(await isWorktree(path))) return { exists: true, path, headSha: null }
  return { exists: true, path, headSha: (await runGit(path, ['rev-parse', 'HEAD'])).trim() }
}

// -z 출력에서 이름 변경(R)과 복사(C) 항목은 바뀐 경로 뒤에 원래 경로가 한 항목 더 붙는다.
function parseStatus(output: string): string[] {
  const entries = output.split('\0')
  const files: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.length < 4) continue
    files.push(entry.slice(3))
    if (/[RC]/.test(entry.slice(0, 2))) i++
  }
  return files
}

function untrackedOverwritten(message: string): string[] {
  if (!message.includes('untracked working tree files would be overwritten')) return []
  return message.split('\n').filter((line) => line.startsWith('\t')).map((line) => line.slice(1))
}

export async function listChangedFiles(root: string, repo: string): Promise<string[]> {
  const path = reviewWorktreePath(root, repo)
  if (!existsSync(path) || !(await isWorktree(path))) return []
  return parseStatus(await runGit(path, ['status', '--porcelain', '-z', '--untracked-files=no']))
}

// --directory는 node_modules처럼 무시된 폴더를 폴더 이름 한 줄(`node_modules/`)로 출력해서 그 안의 파일을 나열하지 않는다.
export async function copyEnvFiles(repo: string, worktree: string): Promise<string[]> {
  const output = await runGit(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'])
  const worktreeReal = realpathSync(worktree)
  const insideWorktree = (dir: string) => {
    while (!existsSync(dir)) dir = dirname(dir)
    const real = realpathSync(dir)
    return real === worktreeReal || real.startsWith(worktreeReal + sep)
  }
  const copied: string[] = []
  for (const file of output.split('\0')) {
    if (!file || file.endsWith('/') || !basename(file).startsWith('.env')) continue
    const target = join(worktree, file)
    if (lstatSync(target, { throwIfNoEntry: false }) || !insideWorktree(dirname(target))) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(repo, file), target)
    copied.push(file)
  }
  return copied
}

export async function checkoutReviewWorktree(root: string, repo: string, headSha: string, options: { force: boolean }): Promise<CheckoutResult> {
  if (!SHA_REGEX.test(headSha)) throw new WorktreeGitError('커밋 sha가 올바르지 않습니다')
  const path = reviewWorktreePath(root, repo)
  if (!existsSync(path)) {
    mkdirSync(root, { recursive: true })
    // 리뷰어가 폴더를 직접 지우면 원본 저장소에 worktree 등록 정보가 남아 worktree add가 거부된다.
    await runGit(repo, ['worktree', 'prune'])
    await runGit(repo, ['worktree', 'add', '--detach', path, headSha])
  } else {
    if (!(await isWorktree(path))) throw new WorktreeGitError('리뷰용 worktree 폴더가 올바르지 않습니다. worktree 삭제 후 다시 체크아웃해 주세요')
    const files = await listChangedFiles(root, repo)
    if (files.length > 0 && !options.force) return { kind: 'dirty', files }
    try {
      await runGit(path, ['checkout', ...(options.force ? ['--force'] : []), '--detach', headSha])
    } catch (err) {
      const blocking = err instanceof WorktreeGitError ? untrackedOverwritten(err.message) : []
      if (blocking.length === 0) throw err
      return { kind: 'dirty', files: blocking }
    }
  }
  return { kind: 'done', path, headSha, copiedEnvFiles: await copyEnvFiles(repo, path) }
}

// node_modules처럼 git에 등록되지 않은 파일이 있으면 --force 없이는 git이 삭제를 거부한다.
export async function removeReviewWorktree(root: string, repo: string): Promise<void> {
  const path = reviewWorktreePath(root, repo)
  if (existsSync(path) && (await isWorktree(path))) {
    await runGit(repo, ['worktree', 'remove', '--force', path])
    return
  }
  rmSync(path, { recursive: true, force: true })
  await runGit(repo, ['worktree', 'prune'])
}

// 앱을 찾지 못하면 open이 "Unable to find application named '<앱>'"을 stderr로 출력한다.
export function openWithApp(args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile('open', args, { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) fail(new Error(stderr.trim() || err.message))
      else done()
    })
  })
}
