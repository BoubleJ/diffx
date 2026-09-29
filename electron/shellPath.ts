import { execFile } from 'node:child_process'
import { homedir } from 'node:os'

const MARK = '__DIFFX_PATH__'

export function parseShellPath(output: string): string | null {
  const match = output.match(new RegExp(`${MARK}([\\s\\S]*?)${MARK}`))
  const value = match?.[1].trim()
  return value ? value : null
}

export function fallbackPath(current: string | undefined, home: string): string {
  const parts = (current ?? '').split(':').filter(Boolean)
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`]) {
    if (!parts.includes(dir)) parts.push(dir)
  }
  return parts.join(':')
}

export function resolveShellPath(shell = process.env.SHELL || '/bin/zsh', timeoutMs = 5000): Promise<string | null> {
  return new Promise((done) => {
    execFile(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], { timeout: timeoutMs }, (err, stdout) => {
      if (err && !stdout) return done(null)
      done(parseShellPath(stdout.toString()))
    })
  })
}

// Finder로 실행한 macOS 앱은 셸 설정 파일의 PATH를 받지 못해서 git, claude 등을 찾지 못한다.
export async function fixPath(): Promise<'shell' | 'fallback'> {
  const path = await resolveShellPath()
  if (path) {
    process.env.PATH = path
    return 'shell'
  }
  process.env.PATH = fallbackPath(process.env.PATH, homedir())
  return 'fallback'
}
