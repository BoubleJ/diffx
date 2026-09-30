type KeyTarget = {
  addEventListener: (type: string, listener: (event: { metaKey?: boolean }) => void) => void
}

export function createTokenLinkHover(target: KeyTarget) {
  let hovered: HTMLElement | null = null
  let meta = false
  let attached = false

  const paint = (el: HTMLElement, on: boolean) => {
    el.style.textDecoration = on ? 'underline' : ''
    el.style.cursor = on ? 'pointer' : ''
  }
  const setMeta = (next: boolean) => {
    meta = next
    if (hovered) paint(hovered, meta)
  }
  const onKey = (event: { metaKey?: boolean }) => setMeta(!!event.metaKey)
  const onBlur = () => setMeta(false)

  return {
    enter(el: HTMLElement, metaKey: boolean) {
      if (!attached) {
        target.addEventListener('keydown', onKey)
        target.addEventListener('keyup', onKey)
        target.addEventListener('blur', onBlur)
        attached = true
      }
      if (hovered && hovered !== el) paint(hovered, false)
      hovered = el
      setMeta(metaKey)
    },
    leave() {
      if (hovered) paint(hovered, false)
      hovered = null
    },
  }
}

export const tokenLinkHover = createTokenLinkHover(typeof window === 'undefined' ? { addEventListener() {} } : window as unknown as KeyTarget)
