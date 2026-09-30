import { classifyToken } from './token.js'
import { isSourceFile } from './sourceFiles.js'
import { parseImports } from './imports.js'
import { declarationRegex, findDeclarationLines, findExport } from './declarations.js'
import { resolveModule } from './modules.js'
import type { SourceReader } from './reader.js'

export interface DefinitionTarget {
  path: string
  line: number
}

export type DefinitionResult =
  | { kind: 'found'; targets: DefinitionTarget[] }
  | { kind: 'self' }
  | { kind: 'external'; module: string }
  | { kind: 'not_found' }

const MAX_REEXPORT_DEPTH = 5
const MAX_CANDIDATES = 20
const NOT_FOUND: DefinitionResult = { kind: 'not_found' }

function findExportLocation(reader: SourceReader, path: string, name: string, depth: number): DefinitionTarget | null {
  if (depth > MAX_REEXPORT_DEPTH) return null
  const text = reader.readFile(path)
  if (text === null) return null
  const matches = findExport(text, name)
  const direct = matches.find((m) => m.kind === 'line')
  if (direct?.kind === 'line') return { path, line: direct.line }
  for (const m of matches) {
    if (m.kind !== 'reexport') continue
    const target = resolveModule(reader, path, m.specifier)
    if (target.kind !== 'file') continue
    const found = findExportLocation(reader, target.path, m.name, depth + 1)
    if (found) return found
  }
  return null
}

function searchDeclarations(reader: SourceReader, name: string): DefinitionTarget[] {
  const escaped = name.replace(/\$/g, '\\$')
  const prefix = '^[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(declare[[:space:]]+)?(abstract[[:space:]]+)?(async[[:space:]]+)?(const[[:space:]]+)?'
  const pattern = `${prefix}(function|const|let|var|class|interface|type|enum|namespace)[[:space:]*]+${escaped}([^A-Za-z0-9_$]|$)`
  const confirm = declarationRegex(name)
  return reader.grep(pattern)
    .filter((hit) => confirm.test(hit.text))
    .map(({ path, line }) => ({ path, line }))
    .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
}

export function resolveDefinition(reader: SourceReader, filePath: string, line: number, col: number): DefinitionResult {
  if (!isSourceFile(filePath)) return NOT_FOUND
  const text = reader.readFile(filePath)
  if (text === null) return NOT_FOUND
  const lineText = text.split('\n')[line - 1]
  if (lineText === undefined) return NOT_FOUND
  const target = classifyToken(lineText, col, { vue: filePath.endsWith('.vue') })
  if (!target) return NOT_FOUND

  if (target.kind === 'module') {
    const resolved = resolveModule(reader, filePath, target.specifier)
    if (resolved.kind === 'file') return { kind: 'found', targets: [{ path: resolved.path, line: 1 }] }
    if (resolved.kind === 'external') return { kind: 'external', module: target.specifier }
    return NOT_FOUND
  }

  const name = target.name
  const binding = parseImports(text).get(name)
  if (binding) {
    const resolved = resolveModule(reader, filePath, binding.specifier)
    if (resolved.kind === 'external') return { kind: 'external', module: binding.specifier }
    if (resolved.kind === 'missing') return NOT_FOUND
    const location = binding.imported === '*' ? null : findExportLocation(reader, resolved.path, binding.imported, 0)
    return { kind: 'found', targets: [location ?? { path: resolved.path, line: 1 }] }
  }

  const localLines = findDeclarationLines(text, name)
  if (localLines.includes(line)) return { kind: 'self' }
  if (localLines.length > 0) return { kind: 'found', targets: [{ path: filePath, line: localLines[0] }] }

  const hits = searchDeclarations(reader, name).filter((h) => !(h.path === filePath && h.line === line))
  return hits.length > 0 ? { kind: 'found', targets: hits.slice(0, MAX_CANDIDATES) } : NOT_FOUND
}
