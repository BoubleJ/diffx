import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runReview, detectProvider } from './runner'
import { buildPrompt } from './prompt'
import { ReviewFailure, type ReviewProvider, type ReviewContext } from './types'

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-cli.mjs', import.meta.url))

const ctx: ReviewContext = { repoPath: tmpdir(), mode: 'worktree', sourceCheckedOut: true, files: ['a.ts'], patch: '+x' }

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
    expect(result.summary).toBe('요약')
    expect(progress).toEqual(['a.ts 읽는 중'])
  })

  it('passes the prompt on stdin', async () => {
    const result = await run('echo')
    expect(result.summary).toBe(buildPrompt(ctx).slice(0, 20))
  })

  it('extracts JSON from text output', async () => {
    expect((await run('text')).findings).toHaveLength(1)
  })

  it('reads the final answer from an output file', async () => {
    const out = join(tmpdir(), `diffx-out-${Date.now()}.json`)
    const provider = fakeProvider({
      buildCommand: (_c, prompt) => ({ bin: process.execPath, args: [FAKE], stdin: prompt, outputFile: out }),
    })
    const result = await runReview(provider, ctx, { env: { ...process.env, FAKE_MODE: 'outfile', FAKE_OUT: out } })
    expect(result.summary).toBe('요약')
  })

  it('classifies failures', async () => {
    expect((await failure(run('garbage'))).kind).toBe('invalid_output')
    expect((await failure(run('garbage'))).rawOutput).toContain('정리하면')
    expect((await failure(run('auth'))).kind).toBe('auth')
    const crash = await failure(run('crash'))
    expect(crash.kind).toBe('process')
    expect(crash.message).toContain('boom')
    const missing = fakeProvider({ buildCommand: () => ({ bin: '/nonexistent/diffx-cli', args: [] }) })
    expect((await failure(run('ok', missing))).kind).toBe('not_installed')
  })

  it('times out and cancels', async () => {
    expect((await failure(run('hang', fakeProvider(), { timeoutMs: 300 }))).kind).toBe('timeout')
    const controller = new AbortController()
    const p = run('hang', fakeProvider(), { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    expect((await failure(p)).kind).toBe('cancelled')
  })
})

describe('detectProvider', () => {
  it('reports installed with version and missing binaries', async () => {
    const node = fakeProvider({ buildCommand: () => ({ bin: process.execPath, args: [] }) })
    expect(await detectProvider(node)).toEqual({ installed: true, version: process.version })
    const missing = fakeProvider({ buildCommand: () => ({ bin: '/nonexistent/diffx-cli', args: [] }) })
    expect(await detectProvider(missing)).toEqual({ installed: false })
  })
})
