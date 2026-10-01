import { afterEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DAY = 24 * 60 * 60 * 1000

async function setup() {
  vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'diffx-home-')))
  vi.resetModules()
  const { createApp, startServer } = await import('./server')
  const { ReviewStore } = await import('./review/store')
  const { makeRepo } = await import('./test/gitRepo')
  const repo = makeRepo()
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '')
  const store = new ReviewStore(mkdtempSync(join(tmpdir(), 'diffx-reviews-')))
  const save = (key: string, createdAt: number) =>
    store.append(repo, key, { provider: 'claude', providerLabel: 'Fake', sessionId: 's-1', message: { id: key, createdAt, kind: 'review', question: null, fingerprint: 'x', result: { answer: 's', locations: [] } } })
  save('mr:1', Date.now() - 40 * DAY)
  save('mr:2', Date.now() - 10 * DAY)
  save('mr:3', Date.now())
  return { createApp, startServer, repo, clientDir, store }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('review retention', () => {
  it('prunes old conversations when the retention days are saved', async () => {
    const { createApp, repo, clientDir, store } = await setup()
    const app = createApp({ repoPath: repo, clientDir, reviewStore: store })
    const put = (body: unknown) => app.request('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await (await put({ reviewRetentionDays: 7 })).json()).reviewRetentionDays).toBe(7)
    expect(store.list(repo).map((s) => s.key)).toEqual(['mr:3'])
    await put({ reviewRetentionDays: 7 })
    expect(store.list(repo).map((s) => s.key)).toEqual(['mr:3'])
  })

  it('prunes with the saved retention days when the server starts', async () => {
    const { startServer, repo, clientDir, store } = await setup()
    const server = await startServer({ repoPath: repo, clientDir, reviewStore: store, port: 0, host: '127.0.0.1' })
    expect(store.list(repo).map((s) => s.key)).toEqual(['mr:3', 'mr:2'])
    await server.close()
  })

  it('still starts the server when pruning fails', async () => {
    const { startServer, repo, clientDir, store } = await setup()
    store.prune = () => {
      throw new Error('EACCES')
    }
    const server = await startServer({ repoPath: repo, clientDir, reviewStore: store, port: 0, host: '127.0.0.1' })
    expect(server.port).toBeGreaterThan(0)
    await server.close()
  })
})
