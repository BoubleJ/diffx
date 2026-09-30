import { describe, it, expect } from 'vitest'
import { isNewer, parseVersion } from './version'

describe('parseVersion', () => {
  it('parses versions with and without a v prefix', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })

  it('returns null for prerelease and malformed versions', () => {
    expect(parseVersion('1.2.3-beta.1')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('release')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('isNewer', () => {
  it('compares each part as a number', () => {
    expect(isNewer('v1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('v2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('v1.0.1', '1.0.0')).toBe(true)
  })

  it('returns false for the same or an older version', () => {
    expect(isNewer('v1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('v1.0.0', '1.0.1')).toBe(false)
  })

  it('returns false when either version cannot be parsed', () => {
    expect(isNewer('nightly', '1.0.0')).toBe(false)
    expect(isNewer('v1.0.1', 'dev')).toBe(false)
  })
})
