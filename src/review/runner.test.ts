import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runReview, detectProvider, STOP_IMMEDIATELY } from './runner'
import { buildReviewPrompt } from './prompt'
import { ReviewFailure, type ReviewProvider, type ReviewContext } from './types'

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-cli.mjs', import.meta.url))

const ctx: ReviewContext = { repoPath: tmpdir(), mode: 'branch', source: 'feature/x', target: 'main', mergeBase: 'abc123', sourceCheckedOut: true, files: ['a.ts'], patch: '+x' }

function fakeProvider(overrides: Partial<ReviewProvider> = {}): ReviewProvider {
  return {
    id: 'claude',
    label: 'Fake',
    verified: true,
    installHint: '',
    loginHint: 'fake login',
    authPattern: /log ?in/i,
    versionArgs: ['--version'],
    buildCommand: (_ctx, prompt) => ({ bin: process.execPath, args: [FAKE], stdin: prompt }),
    parseLine: (line) => {
      const ev = JSON.parse(line)
      if (ev.type === 'progress') return { progress: ev.text }
      if (ev.type === 'final') return { final: { json: ev.json, text: ev.text } }
      return null
    },
    ...overrides,
  }
}

const run = (mode: string, provider = fakeProvider(), opts = {}) =>
  runReview(provider, ctx, { env: { ...process.env, FAKE_MODE: mode }, ...opts })

async function failure(p: Promise<unknown>): Promise<ReviewFailure> {
  try {
    await p
  } catch (err) {
    if (err instanceof ReviewFailure) return err
    throw err
  }
  throw new Error('expected failure')
}

describe('runReview', () => {
  it('returns the validated result and reports progress', async () => {
    const progress: string[] = []
    const result = await run('ok', fakeProvider(), { onProgress: (t: string) => progress.push(t) })
    expect(result.answer).toBe('요약')
    expect(progress).toEqual(['a.ts 읽는 중'])
  })

  it('passes the prompt on stdin', async () => {
    const result = await run('echo')
    expect(result.answer).toBe(buildReviewPrompt(ctx).slice(0, 20))
  })

  it('extracts JSON from text output', async () => {
    expect((await run('text')).locations).toHaveLength(1)
  })

  it('reads the final answer from an output file', async () => {
    const out = join(tmpdir(), `diffx-out-${Date.now()}.json`)
    const provider = fakeProvider({
      buildCommand: (_c, prompt) => ({ bin: process.execPath, args: [FAKE], stdin: prompt, outputFile: out }),
    })
    const result = await runReview(provider, ctx, { env: { ...process.env, FAKE_MODE: 'outfile', FAKE_OUT: out } })
    expect(result.answer).toBe('요약')
  })

  it('classifies unparsable output as invalid_output with raw output', async () => {
    const err = await failure(run('garbage'))
    expect(err.kind).toBe('invalid_output')
    expect(err.rawOutput).toContain('정리하면')
  })

  it('classifies login errors as auth', async () => {
    expect((await failure(run('auth'))).kind).toBe('auth')
  })

  it('classifies non-zero exits as process with stderr', async () => {
    const crash = await failure(run('crash'))
    expect(crash.kind).toBe('process')
    expect(crash.message).toContain('boom')
  })

  it('classifies a missing binary as not_installed and runs cleanup', async () => {
    let cleaned = 0
    const missing = fakeProvider({ buildCommand: () => ({ bin: '/nonexistent/diffx-cli', args: [], cleanup: () => { cleaned++ } }) })
    expect((await failure(run('ok', missing))).kind).toBe('not_installed')
    expect(cleaned).toBe(1)
  })

  it('rejects with process failure when buildCommand throws', async () => {
    const broken = fakeProvider({ buildCommand: () => { throw new Error('bad') } })
    const err = await failure(run('ok', broken))
    expect(err.kind).toBe('process')
    expect(err.message).toContain('bad')
  })

  it('rejects instead of hanging when parseFinal throws', async () => {
    const provider = fakeProvider({ parseLine: () => null, parseFinal: () => { throw new Error('parse boom') } })
    const err = await failure(run('ok', provider))
    expect(err.kind).toBe('process')
    expect(err.message).toContain('parse boom')
  })

  it('ignores a throwing onProgress listener', async () => {
    const result = await run('ok', fakeProvider(), { onProgress: () => { throw new Error('listener') } })
    expect(result.answer).toBe('요약')
  })

  it('strips the repo path prefix from progress text', async () => {
    const progress: string[] = []
    await runReview(fakeProvider(), ctx, {
      env: { ...process.env, FAKE_MODE: 'progress-path', FAKE_PROGRESS: `${ctx.repoPath}/src/a.ts 읽는 중` },
      onProgress: (t) => progress.push(t),
    })
    expect(progress).toEqual(['src/a.ts 읽는 중'])
  })

  it('reads the output file before running cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'diffx-clean-'))
    const out = join(dir, 'out.json')
    const provider = fakeProvider({
      buildCommand: (_c, prompt) => ({
        bin: process.execPath, args: [FAKE], stdin: prompt, outputFile: out,
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
      }),
    })
    const result = await runReview(provider, ctx, { env: { ...process.env, FAKE_MODE: 'outfile', FAKE_OUT: out } })
    expect(result.answer).toBe('요약')
    expect(existsSync(dir)).toBe(false)
  })

  it('times out and runs cleanup', async () => {
    let cleaned = 0
    const provider = fakeProvider({ buildCommand: (_c, prompt) => ({ bin: process.execPath, args: [FAKE], stdin: prompt, cleanup: () => { cleaned++ } }) })
    expect((await failure(run('hang', provider, { timeoutMs: 300 }))).kind).toBe('timeout')
    expect(cleaned).toBe(1)
  })

  it('cancels and runs cleanup', async () => {
    let cleaned = 0
    const provider = fakeProvider({ buildCommand: (_c, prompt) => ({ bin: process.execPath, args: [FAKE], stdin: prompt, cleanup: () => { cleaned++ } }) })
    const controller = new AbortController()
    const p = run('hang', provider, { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    expect((await failure(p)).kind).toBe('cancelled')
    expect(cleaned).toBe(1)
  })

  it('kills a process that ignores SIGTERM right away when stopped immediately', async () => {
    const controller = new AbortController()
    const p = run('stubborn', fakeProvider(), { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 200))
    const startedAt = Date.now()
    controller.abort(STOP_IMMEDIATELY)
    expect((await failure(p)).kind).toBe('cancelled')
    expect(Date.now() - startedAt).toBeLessThan(1500)
  })

  it('still times out when the process ignores SIGTERM', async () => {
    expect((await failure(run('stubborn', fakeProvider(), { timeoutMs: 300 }))).kind).toBe('timeout')
  }, 10000)
})

describe('detectProvider', () => {
  it('reports installed with version and missing binaries', async () => {
    const node = fakeProvider({ buildCommand: () => ({ bin: process.execPath, args: [] }) })
    expect(await detectProvider(node)).toEqual({ installed: true, version: process.version })
    const missing = fakeProvider({ buildCommand: () => ({ bin: '/nonexistent/diffx-cli', args: [] }) })
    expect(await detectProvider(missing)).toEqual({ installed: false })
  })
})
