import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('loadSettings', () => {
  it('drops settings that no longer exist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'diffx-home-'))
    mkdirSync(join(home, '.config', 'diffx'), { recursive: true })
    writeFileSync(join(home, '.config', 'diffx', 'settings.json'), JSON.stringify({ staged: false, untracked: false, browser: 'chrome', diffStyle: 'unified' }))
    vi.stubEnv('HOME', home)
    vi.resetModules()
    const { loadSettings } = await import('./settings')
    const settings = loadSettings()
    expect(settings.diffStyle).toBe('unified')
    expect(settings).not.toHaveProperty('staged')
    expect(settings).not.toHaveProperty('untracked')
    expect(settings).not.toHaveProperty('browser')
    vi.unstubAllEnvs()
  })
})
