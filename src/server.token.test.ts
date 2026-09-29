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
