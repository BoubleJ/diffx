import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('devServer', () => {
  it('exits with 1 outside a git repository', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-nogit-')))
    const res = spawnSync(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'src/devServer.ts')], { cwd: dir, encoding: 'utf-8' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('git 저장소가 아닙니다')
  })
})
