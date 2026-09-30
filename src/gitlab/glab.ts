import { execFile } from 'node:child_process'

export type GlabErrorKind = 'not_installed' | 'auth' | 'not_gitlab' | 'api'

export class GlabError extends Error {
  constructor(public kind: GlabErrorKind, message: string) {
    super(message)
  }
}

export interface GlabRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  paginate?: boolean
}

export type GlabClient = (path: string, request?: GlabRequest) => Promise<unknown>

export interface GlabClientOptions {
  bin?: string
  prefixArgs?: string[]
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

function cleanGlabMessage(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'ERROR')
    .join(' ')
}

export function classifyGlabError(stderr: string): GlabError {
  const message = cleanGlabMessage(stderr) || 'glab 실행에 실패했습니다'
  // 원격 판별 실패 메시지에도 `glab auth login` 안내가 들어 있어서 인증 오류보다 먼저 확인한다.
  if (/no git remotes|point to a known GitLab host/i.test(message)) return new GlabError('not_gitlab', message)
  if (/\b401\b|Unauthenticated|Unauthorized|not logged in|no token found/i.test(message)) return new GlabError('auth', message)
  return new GlabError('api', message)
}

export function glabArgs(path: string, request: GlabRequest = {}): string[] {
  const args = ['api', path, '-X', request.method ?? 'GET']
  if (request.paginate) args.push('--paginate')
  if (request.body !== undefined) args.push('--input', '-', '-H', 'Content-Type: application/json')
  return args
}

export function createGlabClient(repoPath: string, options: GlabClientOptions = {}): GlabClient {
  const { bin = 'glab', prefixArgs = [], timeoutMs = 30_000, env = process.env } = options
  return (path, request = {}) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        bin,
        [...prefixArgs, ...glabArgs(path, request)],
        { cwd: repoPath, timeout: timeoutMs, env: { ...env, NO_COLOR: '1' }, maxBuffer: 50 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return reject(new GlabError('not_installed', 'glab이 설치되어 있지 않습니다'))
            }
            if (err.killed) {
              return reject(new GlabError('api', `GitLab 응답이 ${timeoutMs / 1000}초 안에 오지 않았습니다`))
            }
            return reject(classifyGlabError(stderr.toString()))
          }
          const text = stdout.toString().trim()
          if (!text) return resolve(null)
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new GlabError('api', 'GitLab 응답을 JSON으로 읽지 못했습니다'))
          }
        },
      )
      child.stdin?.end(request.body === undefined ? undefined : JSON.stringify(request.body))
    })
}
