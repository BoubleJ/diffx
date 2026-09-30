export function findHeaderTitle(path: EventTarget[]): HTMLElement | null {
  for (const target of path) {
    const el = target as Partial<HTMLElement>
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-title')) return target as HTMLElement
  }
  return null
}
