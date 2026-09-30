import { posix } from 'node:path'
import { classifyToken } from './token.js'
import { findDeclarationLines, findExport } from './declarations.js'
import { parseImports } from './imports.js'
import { resolveModule } from './modules.js'
import type { SourceReader } from './reader.js'

export interface Reference {
  path: string
  line: number
  text: string
}

export type ReferencesResult =
  | { kind: 'found'; name: string; references: Reference[]; truncated: boolean }
  | { kind: 'not_declaration' }

export const MAX_REFERENCES = 200
const MAX_REEXPORT_DEPTH = 5
const IDENT = 'A-Za-z0-9_$'
const SPECIFIER_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g

const escapeJs = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function wordRegex(word: string): RegExp {
  return new RegExp(`(^|[^${IDENT}])${escapeJs(word)}(?![${IDENT}])`)
}

function matchingLines(path: string, text: string, re: RegExp): Reference[] {
  const out: Reference[] = []
  text.split('\n').forEach((lineText, i) => {
    if (re.test(lineText)) out.push({ path, line: i + 1, text: lineText })
  })
  return out
}

function moduleName(path: string): string {
  const base = posix.basename(path).replace(/\.[^.]+$/, '')
  return base === 'index' ? posix.basename(posix.dirname(path)) : base
}

interface Importer {
  path: string
  text: string
  specifierLines: Reference[]
  specifiers: Set<string>
}

function createResolver(reader: SourceReader) {
  const cache = new Map<string, string | null>()
  return (from: string, specifier: string): string | null => {
    const key = `${from}\n${specifier}`
    if (!cache.has(key)) {
      const r = resolveModule(reader, from, specifier)
      cache.set(key, r.kind === 'file' ? r.path : null)
    }
    return cache.get(key)!
  }
}

function findImporters(reader: SourceReader, target: string, resolve: ReturnType<typeof createResolver>): Importer[] {
  const name = moduleName(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hits = reader.grep(`['"/]${name}(/index)?(\\.[A-Za-z]+)?['"]`)
  const paths = [...new Set(hits.map((h) => h.path))].filter((p) => p !== target)
  const importers: Importer[] = []
  for (const path of paths) {
    const text = reader.readFile(path)
    if (text === null) continue
    const specifierLines: Reference[] = []
    const specifiers = new Set<string>()
    text.split('\n').forEach((lineText, i) => {
      for (const m of lineText.matchAll(SPECIFIER_RE)) {
        if (resolve(path, m[1]) !== target) continue
        specifiers.add(m[1])
        if (!specifierLines.some((r) => r.line === i + 1)) specifierLines.push({ path, line: i + 1, text: lineText })
      }
    })
    if (specifierLines.length > 0) importers.push({ path, text, specifierLines, specifiers })
  }
  return importers
}

function reexportedNames(text: string, specifiers: Set<string>, exported: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!specifiers.has(m[2])) continue
    for (const part of m[1].split(',')) {
      const pm = part.trim().replace(/^type\s+/, '').match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
      if (pm && pm[1] === exported) names.push(pm[2] ?? pm[1])
    }
  }
  if (exported !== 'default') {
    for (const m of text.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
      if (specifiers.has(m[1])) names.push(exported)
    }
  }
  return names
}

function finish(name: string, list: Reference[]): ReferencesResult {
  const seen = new Set<string>()
  const unique = list.filter((r) => {
    const key = `${r.path}:${r.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
  return { kind: 'found', name, references: unique.slice(0, MAX_REFERENCES), truncated: unique.length > MAX_REFERENCES }
}

export function findSymbolReferences(reader: SourceReader, filePath: string, line: number, col: number): ReferencesResult {
  const text = reader.readFile(filePath)
  const lineText = text?.split('\n')[line - 1]
  if (text === null || lineText === undefined) return { kind: 'not_declaration' }
  const token = classifyToken(lineText, col, { vue: filePath.endsWith('.vue') })
  if (token?.kind !== 'identifier' || !findDeclarationLines(text, token.name).includes(line)) return { kind: 'not_declaration' }
  const name = token.name

  const found = matchingLines(filePath, text, wordRegex(name)).filter((r) => r.line !== line)
  const exported = /^\s*export\s+default\b/.test(lineText)
    ? 'default'
    : findExport(text, name).some((m) => m.kind === 'line') ? name : null
  if (!exported) return finish(name, found)

  const resolve = createResolver(reader)
  const visited = new Set<string>()
  const queue: { file: string; exported: string; depth: number }[] = [{ file: filePath, exported, depth: 0 }]
  while (queue.length > 0) {
    const current = queue.shift()!
    const key = `${current.file}#${current.exported}`
    if (visited.has(key)) continue
    visited.add(key)
    for (const importer of findImporters(reader, current.file, resolve)) {
      for (const [local, binding] of parseImports(importer.text)) {
        if (!importer.specifiers.has(binding.specifier)) continue
        if (binding.imported === '*') {
          if (current.exported === 'default') continue
          found.push(...importer.specifierLines, ...matchingLines(importer.path, importer.text, wordRegex(`${local}.${current.exported}`)))
        } else if (binding.imported === current.exported) {
          found.push(...importer.specifierLines, ...matchingLines(importer.path, importer.text, wordRegex(local)))
        }
      }
      if (current.depth >= MAX_REEXPORT_DEPTH) continue
      for (const next of reexportedNames(importer.text, importer.specifiers, current.exported)) {
        found.push(...importer.specifierLines)
        queue.push({ file: importer.path, exported: next, depth: current.depth + 1 })
      }
    }
  }
  return finish(name, found)
}

export function findFileReferences(reader: SourceReader, filePath: string): ReferencesResult {
  const importers = findImporters(reader, filePath, createResolver(reader))
  return finish(posix.basename(filePath).replace(/\.[^.]+$/, ''), importers.flatMap((i) => i.specifierLines))
}
