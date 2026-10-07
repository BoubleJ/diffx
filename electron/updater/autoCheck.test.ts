import { describe, it, expect } from 'vitest'
import { AutoCheckPolicy } from './autoCheck'

const HOUR = 60 * 60 * 1000

describe('AutoCheckPolicy', () => {
  it('checks the first time and then only after the interval', () => {
    const policy = new AutoCheckPolicy(HOUR)
    expect(policy.shouldCheck(0)).toBe(true)
    policy.markChecked(0)
    expect(policy.shouldCheck(HOUR - 1)).toBe(false)
    expect(policy.shouldCheck(HOUR)).toBe(true)
  })

  it('does not ask again about a dismissed version but asks about a newer one', () => {
    const policy = new AutoCheckPolicy(HOUR)
    policy.dismiss('1.5.0')
    expect(policy.isDismissed('1.5.0')).toBe(true)
    expect(policy.isDismissed('1.5.1')).toBe(false)
  })
})
