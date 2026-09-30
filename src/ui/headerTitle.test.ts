import { describe, it, expect } from 'vitest'
import { findHeaderTitle } from './headerTitle'

const el = (attrs: string[]) => ({ hasAttribute: (name: string) => attrs.includes(name) }) as unknown as HTMLElement

describe('findHeaderTitle', () => {
  it('finds the header title element in an event path', () => {
    const title = el(['data-title'])
    expect(findHeaderTitle([el([]), title, el(['data-diffs-header'])])).toBe(title)
  })

  it('returns null when the event did not come from the title', () => {
    expect(findHeaderTitle([el([]), {} as EventTarget])).toBeNull()
  })
})
