import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { APP_DATA_DIR } from './appData'

describe('APP_DATA_DIR', () => {
  it('uses the same folder as the Electron userData of the app', () => {
    const { productName } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
    expect(APP_DATA_DIR).toBe(join(homedir(), 'Library', 'Application Support', productName))
  })
})
