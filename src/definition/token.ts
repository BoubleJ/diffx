export type TokenTarget = { kind: 'module'; specifier: string } | { kind: 'identifier'; name: string } | null

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await', 'async', 'as',
  'from', 'of', 'type', 'declare', 'abstract', 'readonly', 'keyof', 'infer', 'is', 'namespace', 'module',
  'satisfies', 'undefined', 'get', 'set', 'constructor', 'any', 'unknown', 'never', 'string', 'number', 'boolean',
  'symbol', 'object', 'bigint',
])

interface StringSpan {
  start: number
  end: number
  value: string
  holes: [number, number][]
}

function interpolationEnd(line: string, from: number): number {
  let depth = 1
  for (let i = from; i < line.length; i++) {
    if (line[i] === '{') depth++
    else if (line[i] === '}' && --depth === 0) return i
  }
  return line.length
}

function scanLine(line: string): { strings: StringSpan[]; comments: [number, number][] } {
  const strings: StringSpan[] = []
  const comments: [number, number][] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '/' && line[i + 1] === '/') {
      comments.push([i, line.length])
      break
    }
    if (ch === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2)
      const end = close === -1 ? line.length : close + 2
      comments.push([i, end])
      i = end
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const holes: [number, number][] = []
      let j = i + 1
      while (j < line.length && line[j] !== ch) {
        if (ch === '`' && line[j] === '$' && line[j + 1] === '{') {
          const close = interpolationEnd(line, j + 2)
          holes.push([j + 2, close])
          j = close + 1
          continue
        }
        j += line[j] === '\\' ? 2 : 1
      }
      const end = Math.min(j + 1, line.length)
      strings.push({ start: i, end, value: line.slice(i + 1, j), holes })
      i = end
      continue
    }
    i++
  }
  return { strings, comments }
}

const IDENT_CHAR = /[A-Za-z0-9_$]/

function isModuleString(line: string, span: StringSpan): boolean {
  if (span.value.includes('${')) return false
  const before = line.slice(0, span.start)
  return /\bfrom\s*$/.test(before) || /\bimport\s*\(\s*$/.test(before) || /\brequire\s*\(\s*$/.test(before) || /^\s*import\s*$/.test(before)
}

const VUE_BINDING_ATTR = /(?:^|\s)(?:v-[\w-]+(?::[\w.-]+)?|[:@#][\w.-]*)(?:\.[\w-]+)*\s*=\s*$/

function isVueBinding(line: string, span: StringSpan): boolean {
  return line[span.start] !== '`' && VUE_BINDING_ATTR.test(line.slice(0, span.start))
}

export function classifyToken(line: string, col: number, options: { vue?: boolean } = {}): TokenTarget {
  const { strings, comments } = scanLine(line)
  if (comments.some(([s, e]) => col >= s && col < e)) return null
  const span = strings.find((s) => col >= s.start && col < s.end)
  if (span) {
    const inCode = span.holes.some(([s, e]) => col >= s && col < e) || (options.vue === true && col > span.start && col < span.end - 1 && isVueBinding(line, span))
    if (!inCode) return isModuleString(line, span) ? { kind: 'module', specifier: span.value } : null
  }

  let pos = col
  while (pos < line.length && /\s/.test(line[pos])) pos++
  if (pos >= line.length || !IDENT_CHAR.test(line[pos])) return null
  let start = pos
  while (start > 0 && IDENT_CHAR.test(line[start - 1])) start--
  let end = pos
  while (end < line.length && IDENT_CHAR.test(line[end])) end++
  const name = line.slice(start, end)
  if (/^\d/.test(name) || KEYWORDS.has(name)) return null

  let prev = start - 1
  while (prev >= 0 && /\s/.test(line[prev])) prev--
  if (prev >= 0 && line[prev] === '.' && line.slice(Math.max(0, prev - 2), prev + 1) !== '...') return null
  return { kind: 'identifier', name }
}
