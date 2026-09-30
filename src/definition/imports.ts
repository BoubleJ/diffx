export interface ImportBinding {
  specifier: string
  imported: string
}

const IMPORT_RE = /\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*['"]([^'"]+)['"]/g

function addClause(clause: string, specifier: string, map: Map<string, ImportBinding>): void {
  let rest = clause.trim()
  const braces = rest.match(/\{([\s\S]*)\}/)
  if (braces) {
    for (const part of braces[1].split(',')) {
      const item = part.trim().replace(/^type\s+/, '')
      const m = item.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
      if (m) map.set(m[2] ?? m[1], { specifier, imported: m[1] })
    }
    rest = rest.replace(braces[0], '')
  }
  const ns = rest.match(/\*\s*as\s+([\w$]+)/)
  if (ns) {
    map.set(ns[1], { specifier, imported: '*' })
    rest = rest.replace(ns[0], '')
  }
  const def = rest.replace(/,/g, ' ').trim()
  if (/^[\w$]+$/.test(def)) map.set(def, { specifier, imported: 'default' })
}

export function parseImports(text: string): Map<string, ImportBinding> {
  const map = new Map<string, ImportBinding>()
  for (const m of text.matchAll(IMPORT_RE)) addClause(m[1], m[2], map)
  return map
}
