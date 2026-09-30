const PREFIX = String.raw`^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?`

function escapeRegExp(name: string): string {
  return name.replace(/[$]/g, '\\$')
}

export function declarationRegex(name: string): RegExp {
  const n = escapeRegExp(name)
  const end = '(?![A-Za-z0-9_$])'
  return new RegExp(
    PREFIX + `(?:function\\s*\\*?\\s*${n}${end}|(?:const|let|var)\\s+${n}${end}|(?:const\\s+)?enum\\s+${n}${end}|(?:class|interface|type|namespace)\\s+${n}${end})`,
  )
}

export function findDeclarationLines(text: string, name: string): number[] {
  const re = declarationRegex(name)
  const lines: number[] = []
  text.split('\n').forEach((line, i) => {
    if (re.test(line)) lines.push(i + 1)
  })
  return lines
}

export type ExportMatch = { kind: 'line'; line: number } | { kind: 'reexport'; specifier: string; name: string }

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

export function findExport(text: string, name: string): ExportMatch[] {
  const lines = text.split('\n')
  const results: ExportMatch[] = []
  if (name === 'default') {
    const i = lines.findIndex((l) => /^\s*export\s+default\b/.test(l))
    if (i !== -1) results.push({ kind: 'line', line: i + 1 })
  } else {
    const decl = declarationRegex(name)
    const i = lines.findIndex((l) => /^\s*export\s/.test(l) && decl.test(l))
    if (i !== -1) results.push({ kind: 'line', line: i + 1 })
  }
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[1].split(',')) {
      const item = part.trim().replace(/^type\s+/, '')
      const pm = item.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
      if (!pm || (pm[2] ?? pm[1]) !== name) continue
      if (m[2]) {
        results.push({ kind: 'reexport', specifier: m[2], name: pm[1] })
      } else {
        const local = findDeclarationLines(text, pm[1])
        results.push({ kind: 'line', line: local[0] ?? lineOf(text, m.index!) })
      }
    }
  }
  if (name !== 'default') {
    for (const m of text.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
      results.push({ kind: 'reexport', specifier: m[1], name })
    }
  }
  return results
}
