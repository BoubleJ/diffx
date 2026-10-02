import { posix } from 'node:path'
import type { SourceReader } from './reader.js'

export type ModuleResolution = { kind: 'file'; path: string } | { kind: 'external' } | { kind: 'missing' }

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.d.ts']

export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += ch
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

async function tryFile(reader: SourceReader, base: string): Promise<string | null> {
  const norm = posix.normalize(base)
  if (norm.startsWith('..') || posix.isAbsolute(norm)) return null
  const candidates = [norm, ...EXTENSIONS.map((e) => norm + e), ...EXTENSIONS.map((e) => posix.join(norm, `index${e}`))]
  const jsLike = norm.match(/^(.*)\.(?:m?js|cjs|jsx)$/)
  if (jsLike) candidates.push(`${jsLike[1]}.ts`, `${jsLike[1]}.tsx`)
  for (const candidate of candidates) {
    if (await reader.exists(candidate)) return candidate
  }
  return null
}

async function findConfig(reader: SourceReader, fromFile: string): Promise<string | null> {
  let dir = posix.dirname(fromFile)
  for (;;) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const file = dir === '.' ? name : posix.join(dir, name)
      if (await reader.exists(file)) return file
    }
    if (dir === '.') return null
    dir = posix.dirname(dir)
  }
}

interface PathConfig {
  baseUrl?: string
  paths?: Record<string, unknown>
  pathsDir?: string
}

async function readConfig(reader: SourceReader, file: string, depth: number): Promise<PathConfig | null> {
  const text = await reader.readFile(file)
  if (text === null) return null
  let json: { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } }
  try {
    json = parseJsonc(text) as typeof json
  } catch {
    return null
  }
  const dir = posix.dirname(file)
  let inherited: PathConfig = {}
  if (typeof json.extends === 'string' && json.extends.startsWith('.') && depth < 5) {
    const target = posix.join(dir, json.extends)
    inherited = (await readConfig(reader, target.endsWith('.json') ? target : `${target}.json`, depth + 1)) ?? {}
  }
  const options = json.compilerOptions ?? {}
  const hasPaths = options.paths !== null && typeof options.paths === 'object'
  return {
    baseUrl: typeof options.baseUrl === 'string' ? posix.join(dir, options.baseUrl) : inherited.baseUrl,
    paths: hasPaths ? (options.paths as Record<string, unknown>) : inherited.paths,
    pathsDir: hasPaths ? dir : inherited.pathsDir,
  }
}

function matchPaths(paths: Record<string, unknown>, specifier: string): string[] {
  const entries = Object.entries(paths)
    .filter((e): e is [string, string[]] => Array.isArray(e[1]))
    .sort((a, b) => b[0].indexOf('*') - a[0].indexOf('*'))
  for (const [pattern, targets] of entries) {
    const star = pattern.indexOf('*')
    if (star === -1) {
      if (pattern === specifier) return targets
      continue
    }
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
      const middle = specifier.slice(prefix.length, specifier.length - suffix.length)
      return targets.map((t) => t.replace('*', middle))
    }
  }
  return []
}

export async function resolveModule(reader: SourceReader, fromFile: string, specifier: string): Promise<ModuleResolution> {
  const found = (path: string | null): ModuleResolution => (path ? { kind: 'file', path } : { kind: 'missing' })
  if (specifier.startsWith('.')) return found(await tryFile(reader, posix.join(posix.dirname(fromFile), specifier)))

  const configFile = await findConfig(reader, fromFile)
  const config = configFile ? await readConfig(reader, configFile, 0) : null
  if (config?.paths) {
    const base = config.baseUrl ?? config.pathsDir ?? '.'
    for (const target of matchPaths(config.paths, specifier)) {
      const path = await tryFile(reader, posix.join(base, target))
      if (path) return { kind: 'file', path }
    }
  }
  if (config?.baseUrl) {
    const path = await tryFile(reader, posix.join(config.baseUrl, specifier))
    if (path) return { kind: 'file', path }
  }
  if (/^[@~]\//.test(specifier)) {
    const root = configFile ? posix.dirname(configFile) : '.'
    const rest = specifier.slice(2)
    return found((await tryFile(reader, posix.join(root, 'src', rest))) ?? (await tryFile(reader, posix.join(root, rest))))
  }
  return { kind: 'external' }
}
