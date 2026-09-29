import { describe, it, expect } from 'vitest'
import { parseShellPath, fallbackPath, resolveShellPath } from './shellPath'

describe('parseShellPath', () => {
  it('extracts PATH between markers even with rc noise', () => {
    expect(parseShellPath('Welcome!\n__DIFFX_PATH__/opt/homebrew/bin:/usr/bin__DIFFX_PATH__\n')).toBe('/opt/homebrew/bin:/usr/bin')
    expect(parseShellPath('no markers')).toBeNull()
    expect(parseShellPath('__DIFFX_PATH____DIFFX_PATH__')).toBeNull()
  })
})

describe('fallbackPath', () => {
  it('appends common bin dirs without duplicates', () => {
    expect(fallbackPath('/usr/bin:/opt/homebrew/bin', '/Users/me'))
      .toBe('/usr/bin:/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin')
    expect(fallbackPath(undefined, '/Users/me'))
      .toBe('/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin')
  })
})

describe('resolveShellPath', () => {
  it('reads PATH from a login shell', async () => {
    const path = await resolveShellPath('/bin/sh')
    expect(path).toContain('/usr/bin')
  })

  it('returns null when the shell does not exist', async () => {
    expect(await resolveShellPath('/nonexistent/shell')).toBeNull()
  })
})
