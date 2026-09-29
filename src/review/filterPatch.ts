function chunkPath(chunk: string): string | null {
  const hunkStart = chunk.search(/^@@/m)
  const header = hunkStart === -1 ? chunk : chunk.slice(0, hunkStart)
  const added = header.match(/^\+\+\+ b\/([^\t\r\n]+)/m)
  if (added) return added[1]
  if (/^\+\+\+ \/dev\/null/m.test(header)) {
    const removed = header.match(/^--- a\/([^\t\r\n]+)/m)
    if (removed) return removed[1]
  }
  const renamed = header.match(/^rename to (.+)$/m)
  if (renamed) return renamed[1]
  const same = header.match(/^diff --git a\/(.+) b\/\1$/m)
  return same ? same[1] : null
}

export function excludeFilesFromPatch(patch: string, exclude: string[]): string {
  if (exclude.length === 0) return patch
  const excluded = new Set(exclude)
  return patch
    .split(/^(?=diff --git )/m)
    .filter((chunk) => {
      const path = chunkPath(chunk)
      return path === null || !excluded.has(path)
    })
    .join('')
}
