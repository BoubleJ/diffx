import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { createGlabClient, classifyGlabError, glabArgs, GlabError } from './glab'

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-glab.mjs', import.meta.url))
const CWD = realpathSync(tmpdir())

const client = (mode: string, timeoutMs?: number) =>
  createGlabClient(CWD, { bin: process.execPath, prefixArgs: [FAKE], timeoutMs, env: { ...process.env, FAKE_GLAB_MODE: mode } })

async function failure(p: Promise<unknown>): Promise<GlabError> {
  try {
    await p
  } catch (err) {
    if (err instanceof GlabError) return err
    throw err
  }
  throw new Error('expected failure')
}

describe('glabArgs', () => {
  it('builds GET, paginate and body args', () => {
    expect(glabArgs('projects/:fullpath')).toEqual(['api', 'projects/:fullpath', '-X', 'GET'])
    expect(glabArgs('x', { paginate: true })).toEqual(['api', 'x', '-X', 'GET', '--paginate'])
    expect(glabArgs('x', { method: 'POST', body: {} })).toEqual(['api', 'x', '-X', 'POST', '--input', '-', '-H', 'Content-Type: application/json'])
  })
})

describe('classifyGlabError', () => {
  it('treats the remote detection message as not_gitlab even though it mentions auth login', () => {
    const err = classifyGlabError('\n   ERROR  \n\n  Unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab\n  host. Please use `glab auth login` to authenticate and configure a new host for glab.\n')
    expect(err.kind).toBe('not_gitlab')
    expect(err.message).toBe('Unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab host. Please use `glab auth login` to authenticate and configure a new host for glab.')
  })

  it('treats a repo without remotes as not_gitlab', () => {
    expect(classifyGlabError('ERROR\nUnable to expand placeholder in path: no git remotes found.').kind).toBe('not_gitlab')
  })

  it('detects auth failures', () => {
    expect(classifyGlabError('\n   ERROR  \n\n  Unauthenticated.\n').kind).toBe('auth')
    expect(classifyGlabError('glab: 401 Unauthorized (HTTP 401)').kind).toBe('auth')
  })

  it('falls back to api with the cleaned message', () => {
    const err = classifyGlabError('glab: 404 Project Not Found (HTTP 404)\n')
    expect(err.kind).toBe('api')
    expect(err.message).toBe('glab: 404 Project Not Found (HTTP 404)')
  })
})

describe('createGlabClient', () => {
  it('runs in the repo directory and passes the body on stdin', async () => {
    const out = await client('echo')('projects/:fullpath/draft_notes', { method: 'POST', body: { note: '안녕' } }) as { args: string[]; stdin: string; cwd: string }
    expect(out.args).toEqual(['api', 'projects/:fullpath/draft_notes', '-X', 'POST', '--input', '-', '-H', 'Content-Type: application/json'])
    expect(JSON.parse(out.stdin)).toEqual({ note: '안녕' })
    expect(out.cwd).toBe(CWD)
  })

  it('returns null for an empty response', async () => {
    expect(await client('empty')('x', { method: 'DELETE' })).toBeNull()
  })

  it('classifies failures', async () => {
    expect((await failure(client('not_gitlab')('x'))).kind).toBe('not_gitlab')
    expect((await failure(client('auth')('x'))).kind).toBe('auth')
    expect((await failure(client('not_found')('x'))).kind).toBe('api')
    expect((await failure(client('garbage')('x'))).message).toBe('GitLab 응답을 JSON으로 읽지 못했습니다')
  })

  it('reports a missing binary as not_installed', async () => {
    const missing = createGlabClient(CWD, { bin: 'glab-does-not-exist-xyz' })
    expect(await failure(missing('x'))).toMatchObject({ kind: 'not_installed', message: 'glab이 설치되어 있지 않습니다' })
  })

  it('stops after the timeout', async () => {
    expect(await failure(client('hang', 300)('x'))).toMatchObject({ kind: 'api', message: 'GitLab 응답이 0.3초 안에 오지 않았습니다' })
  })
})
