import { spawn, execFile } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { buildPrompt } from './prompt.js'
import { extractJson, validateResult } from './schema.js'
import { ReviewFailure, type FinalOutput, type ReviewContext, type ReviewProvider, type ReviewResult } from './types.js'

export interface RunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (text: string) => void
  env?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT = 600_000
const MAX_STDOUT = 20 * 1024 * 1024

const PROBE_CONTEXT: ReviewContext = { repoPath: process.cwd(), mode: 'worktree', sourceCheckedOut: true, files: [], patch: '' }

export function detectProvider(provider: ReviewProvider): Promise<{ installed: boolean; version?: string }> {
  const command = provider.buildCommand(PROBE_CONTEXT, '')
  command.cleanup?.()
  return new Promise((done) => {
    execFile(command.bin, provider.versionArgs, { timeout: 5000 }, (err, stdout) => {
      if (err) return done({ installed: false })
      const version = stdout.toString().trim().split('\n')[0]
      done(version ? { installed: true, version } : { installed: true })
    })
  })
}

function toResult(final: FinalOutput | null, rawOutput: string): ReviewResult {
  const candidates: unknown[] = []
  if (final?.json !== undefined) candidates.push(final.json)
  if (final?.text) candidates.push(extractJson(final.text))
  for (const c of candidates) {
    const result = validateResult(c)
    if (result) return result
  }
  throw new ReviewFailure('invalid_output', '리뷰 결과를 읽지 못했습니다', final?.text ?? rawOutput)
}

function tail(text: string, lines: number): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}

export function runReview(provider: ReviewProvider, ctx: ReviewContext, options: RunOptions = {}): Promise<ReviewResult> {
  const command = provider.buildCommand(ctx, buildPrompt(ctx))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT

  return new Promise<ReviewResult>((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let final: FinalOutput | null = null
    let timedOut = false
    let cancelled = false

    const child = spawn(command.bin, command.args, {
      cwd: ctx.repoPath,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // cleanup이 outputFile을 지우므로 결과를 읽는 fn 실행 뒤에 호출한다.
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      try {
        fn()
      } finally {
        command.cleanup?.()
      }
    }

    const kill = () => {
      if (child.exitCode === null) child.kill('SIGTERM')
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)

    const onAbort = () => {
      cancelled = true
      kill()
    }
    if (options.signal?.aborted) onAbort()
    options.signal?.addEventListener('abort', onAbort)

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(() => reject(
        err.code === 'ENOENT'
          ? new ReviewFailure('not_installed', `${provider.label}이 설치돼 있지 않습니다`)
          : new ReviewFailure('process', err.message),
      ))
    })

    child.stdin.on('error', () => {})
    child.stdin.end(command.stdin ?? '')

    child.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > MAX_STDOUT) stderr = stderr.slice(-MAX_STDOUT)
    })

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      if (stdout.length < MAX_STDOUT) stdout += line + '\n'
      if (!provider.parseLine || !line.trim()) return
      let parsed = null
      try {
        parsed = provider.parseLine(line)
      } catch {
        return
      }
      if (parsed?.progress) options.onProgress?.(parsed.progress.replaceAll(`${ctx.repoPath}/`, ''))
      if (parsed?.final) final = parsed.final
    })

    child.on('close', (code) => {
      rl.close()
      finish(() => {
        if (cancelled) return reject(new ReviewFailure('cancelled', '리뷰를 취소했습니다'))
        if (timedOut) return reject(new ReviewFailure('timeout', '10분 안에 리뷰가 끝나지 않아 중단했습니다'))

        if (!final && command.outputFile && existsSync(command.outputFile)) {
          final = { text: readFileSync(command.outputFile, 'utf-8') }
          rmSync(command.outputFile, { force: true })
        }
        if (!final && provider.parseFinal) final = provider.parseFinal(stdout)

        const combined = `${stdout}\n${stderr}`
        if (code !== 0 || final?.isError) {
          if (provider.authPattern.test(combined) || provider.authPattern.test(final?.text ?? '')) {
            return reject(new ReviewFailure('auth', `${provider.label} 로그인이 필요합니다. 터미널에서 \`${provider.loginHint}\`을 실행해 주세요`))
          }
          if (code !== 0) {
            return reject(new ReviewFailure('process', `종료 코드 ${code}\n${tail(stderr || stdout, 20)}`))
          }
        }
        try {
          resolve(toResult(final, stdout))
        } catch (err) {
          reject(err)
        }
      })
    })
  })
}
