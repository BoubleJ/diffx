import { describe, it, expect } from 'vitest'
import { createTokenLinkHover } from './tokenLinkHover'

function fakeWindow() {
  const listeners = new Map<string, (e: { metaKey?: boolean }) => void>()
  return {
    addEventListener: (type: string, fn: (e: { metaKey?: boolean }) => void) => void listeners.set(type, fn),
    fire: (type: string, e: { metaKey?: boolean } = {}) => listeners.get(type)?.(e),
  }
}

const token = () => ({ style: { textDecoration: '', cursor: '' } }) as unknown as HTMLElement

describe('createTokenLinkHover', () => {
  it('marks a token entered with Cmd held and clears it on leave', () => {
    const hover = createTokenLinkHover(fakeWindow())
    const el = token()
    hover.enter(el, true)
    expect(el.style).toMatchObject({ textDecoration: 'underline', cursor: 'pointer' })
    hover.leave()
    expect(el.style).toMatchObject({ textDecoration: '', cursor: '' })
  })

  it('follows Cmd presses while the pointer stays on a token', () => {
    const win = fakeWindow()
    const hover = createTokenLinkHover(win)
    const el = token()
    hover.enter(el, false)
    expect(el.style.textDecoration).toBe('')
    win.fire('keydown', { metaKey: true })
    expect(el.style).toMatchObject({ textDecoration: 'underline', cursor: 'pointer' })
    win.fire('keyup', { metaKey: false })
    expect(el.style).toMatchObject({ textDecoration: '', cursor: '' })
  })

  it('clears the mark when the window loses focus', () => {
    const win = fakeWindow()
    const hover = createTokenLinkHover(win)
    const el = token()
    hover.enter(el, true)
    win.fire('blur')
    expect(el.style.textDecoration).toBe('')
  })

  it('does not touch a token after leaving it', () => {
    const win = fakeWindow()
    const hover = createTokenLinkHover(win)
    const el = token()
    hover.enter(el, false)
    hover.leave()
    win.fire('keydown', { metaKey: true })
    expect(el.style.textDecoration).toBe('')
  })
})
