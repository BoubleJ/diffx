const SIMPLE_ESCAPES: Record<string, number> = { t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 }

function unquote(quoted: string): string {
  const inner = quoted.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch))
      continue
    }
    const octal = inner.slice(i + 1, i + 4)
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8))
      i += 3
    } else {
      const next = inner[++i]
      bytes.push(next in SIMPLE_ESCAPES ? SIMPLE_ESCAPES[next] : next.charCodeAt(0))
    }
  }
  return Buffer.from(bytes).toString('utf-8')
}

const QUOTED = '"(?:[^"\\\\\\r\\n]|\\\\.)*"'

function headerPath(header: string, marker: string, prefix: string): string | null {
  const quoted = header.match(new RegExp(`^${marker} (${QUOTED})`, 'm'))
  if (quoted) {
    const path = unquote(quoted[1])
    return path.startsWith(prefix) ? path.slice(prefix.length) : null
  }
  const plain = header.match(new RegExp(`^${marker} ${prefix}([^\\t\\r\\n]+)`, 'm'))
  return plain ? plain[1] : null
}

function chunkPath(chunk: string): string | null {
  const hunkStart = chunk.search(/^@@/m)
  const header = hunkStart === -1 ? chunk : chunk.slice(0, hunkStart)
  const added = headerPath(header, '\\+\\+\\+', 'b/')
  if (added) return added
  if (/^\+\+\+ \/dev\/null/m.test(header)) {
    const removed = headerPath(header, '---', 'a/')
    if (removed) return removed
  }
  const renamed = header.match(/^rename to (.+)$/m)
  if (renamed) return renamed[1].startsWith('"') ? unquote(renamed[1]) : renamed[1]
  const quotedSame = header.match(new RegExp(`^diff --git (${QUOTED}) (${QUOTED})$`, 'm'))
  if (quotedSame) {
    const [a, b] = [unquote(quotedSame[1]), unquote(quotedSame[2])]
    return a.startsWith('a/') && b.startsWith('b/') && a.slice(2) === b.slice(2) ? b.slice(2) : null
  }
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
