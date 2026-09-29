import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit } from './test/gitRepo'
import { createApp, startServer } from './server'

function setup() {
  const repo = makeRepo()
  commit(repo, { 'a.txt': 'a\n' }, 'init')
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '<html>ui</html>')
  return { repo, clientDir }
}

describe('token check', () => {
  it('rejects /api requests without the token and serves static files', async () => {
    const { repo, clientDir } = setup()
    const app = createApp({ repoPath: repo, clientDir, token: 'secret' })
    expect((await app.request('/api/repo')).status).toBe(403)
    expect((await app.request('/api/repo', { headers: { 'X-Diffx-Token': 'wrong' } })).status).toBe(403)
    expect((await app.request('/api/repo', { headers: { 'X-Diffx-Token': 'secret' } })).status).toBe(200)
    expect(await (await app.request('/')).text()).toBe('<html>ui</html>')
  })

  it('does not check anything without a token (CLI mode)', async () => {
    const { repo, clientDir } = setup()
    const app = createApp({ repoPath: repo, clientDir })
    expect((await app.request('/api/repo')).status).toBe(200)
  })
})

describe('startServer', () => {
  it('rejects with EADDRINUSE when the port is taken', async () => {
    const { repo, clientDir } = setup()
    const first = await startServer({ repoPath: repo, clientDir, port: 0, host: '127.0.0.1' })
    await expect(startServer({ repoPath: repo, clientDir, port: first.port, host: '127.0.0.1' }))
      .rejects.toMatchObject({ code: 'EADDRINUSE' })
    await first.close()
  })
})

describe('mutation request check', () => {
  const json = { 'Content-Type': 'application/json' }
  const comment = JSON.stringify({ filePath: 'a.txt', side: 'additions', lineNumber: 1, lineContent: 'a', body: 'c' })

  it('rejects non-JSON bodies so other pages cannot send simple requests', async () => {
    const { repo, clientDir } = setup()
    const app = createApp({ repoPath: repo, clientDir })
    const res = await app.request('/api/comments', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: comment })
    expect(res.status).toBe(415)
    expect((await app.request('/api/comments', { method: 'POST', body: comment })).status).toBe(415)
  })

  it('rejects requests whose Origin is not the server itself, including body-less ones', async () => {
    const { repo, clientDir } = setup()
    const app = createApp({ repoPath: repo, clientDir })
    const evil = { Origin: 'http://evil.example' }
    expect((await app.request('/api/comments', { method: 'POST', headers: { ...json, ...evil }, body: comment })).status).toBe(403)
    expect((await app.request('/api/fetch', { method: 'POST', headers: evil })).status).toBe(403)
    expect((await app.request('/api/review/x', { method: 'DELETE', headers: evil })).status).toBe(403)
    expect((await app.request('/api/review/x', { method: 'DELETE', headers: { Origin: 'http://localhost' } })).status).toBe(200)
  })

  it('keeps accepting JSON requests without Origin (curl from the finish-review skill)', async () => {
    const { repo, clientDir } = setup()
    const app = createApp({ repoPath: repo, clientDir })
    const res = await app.request('/api/comments', { method: 'POST', headers: json, body: comment })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect((await app.request(`/api/comments/${id}`, { method: 'PUT', headers: json, body: JSON.stringify({ status: 'resolved' }) })).status).toBe(200)
  })
})
