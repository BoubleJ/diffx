import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' })
}

// macOS의 tmpdir(/var/...)는 /private/var의 심볼릭 링크라서 git rev-parse --show-toplevel 결과와 맞추려고 realpath를 쓴다.
export function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-test-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'commit.gpgsign', 'false')
  return dir
}

export function commit(dir: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
    git(dir, 'add', path)
  }
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD').trim()
}
