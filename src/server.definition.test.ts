import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './test/gitRepo'
import { createApp } from './server'

function setup() {
  const repo = makeRepo()
  commit(repo, {
    'src/a.ts': 'export function greet() {}\n',
    'src/b.ts': "import { greet } from './a'\ngreet()\n",
  }, 'base')
  git(repo, 'switch', '-q', '-c', 'feature/x')
  commit(repo, { 'src/a.ts': '// moved\nexport function greet() {}\n' }, 'move')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'src/a.ts'), '\n\n\nexport function greet() {}\n')
  const clientDir = mkdtempSync(join(tmpdir(), 'diffx-client-'))
  writeFileSync(join(clientDir, 'index.html'), '')
  return createApp({ repoPath: repo, clientDir })
}

const branch = 'mode=branch&source=feature/x&target=main'
const click = 'path=src/b.ts&line=2&col=0'

describe('GET /api/definition', () => {
  it('resolves added lines against the source commit', async () => {
    const app = setup()
    const body = await (await app.request(`/api/definition?${branch}&side=additions&${click}`)).json()
    expect(body).toEqual({ kind: 'found', version: 'new', targets: [{ path: 'src/a.ts', line: 2 }] })
  })

  it('resolves deleted lines against the merge-base', async () => {
    const app = setup()
    const body = await (await app.request(`/api/definition?${branch}&side=deletions&${click}`)).json()
    expect(body).toEqual({ kind: 'found', version: 'old', targets: [{ path: 'src/a.ts', line: 1 }] })
  })

  it('returns other result kinds without a version', async () => {
    const app = setup()
    expect(await (await app.request(`/api/definition?${branch}&side=additions&path=src/a.ts&line=2&col=16`)).json()).toEqual({ kind: 'self' })
    expect(await (await app.request(`/api/definition?${branch}&side=additions&path=src/b.ts&line=1&col=0`)).json()).toEqual({ kind: 'not_found' })
  })

  it('rejects invalid queries', async () => {
    const app = setup()
    const noMode = await app.request(`/api/definition?side=additions&${click}`)
    expect(noMode.status).toBe(400)
    expect(await noMode.json()).toMatchObject({ error: 'missing_mode' })
    for (const q of ['path=../x.ts&side=additions&line=1&col=0', 'path=src/b.ts&side=left&line=1&col=0', 'path=src/b.ts&side=additions&line=0&col=0', 'path=src/b.ts&side=additions&line=1&col=-1', 'side=additions&line=1&col=0']) {
      const res = await app.request(`/api/definition?${branch}&${q}`)
      expect(res.status).toBe(400)
    }
  })
})
