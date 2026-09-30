import { describe, it, expect } from 'vitest'
import { classifyToken } from './token'
import { isSourceFile } from './sourceFiles'

const at = (line: string, text: string, offset = 0) => classifyToken(line, line.indexOf(text) + offset)

describe('isSourceFile', () => {
  it('accepts script and vue files only', () => {
    expect(['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.vue'].every(isSourceFile)).toBe(true)
    expect(isSourceFile('README.md')).toBe(false)
    expect(isSourceFile('style.css')).toBe(false)
  })
})

describe('classifyToken module specifiers', () => {
  it('reads import, export, dynamic import and require paths', () => {
    expect(at("import { a } from './utils'", "'./utils'")).toEqual({ kind: 'module', specifier: './utils' })
    expect(at("export * from './re'", "'./re'", 2)).toEqual({ kind: 'module', specifier: './re' })
    expect(at("const p = await import('./page')", "'./page'")).toEqual({ kind: 'module', specifier: './page' })
    expect(at('const y = require("../x")', '"../x"')).toEqual({ kind: 'module', specifier: '../x' })
    expect(at("import './side.css'", "'./side.css'")).toEqual({ kind: 'module', specifier: './side.css' })
  })

  it('ignores other strings', () => {
    expect(at("console.log('hello')", "'hello'")).toBeNull()
  })
})

describe('classifyToken identifiers', () => {
  it('returns the identifier under the cursor', () => {
    expect(at('const total = sum(a, b)', 'sum', 1)).toEqual({ kind: 'identifier', name: 'sum' })
    expect(at('user.name', 'user')).toEqual({ kind: 'identifier', name: 'user' })
    expect(at('f(...args)', 'args')).toEqual({ kind: 'identifier', name: 'args' })
    expect(at('const s = $fetch(url)', '$fetch')).toEqual({ kind: 'identifier', name: '$fetch' })
  })

  it('skips leading whitespace of the token', () => {
    expect(classifyToken('return  formatDate(d)', 6)).toEqual({ kind: 'identifier', name: 'formatDate' })
  })

  it('does not link member names, keywords or comments', () => {
    expect(at('user.name', 'name')).toBeNull()
    expect(at('obj?.prop', 'prop')).toBeNull()
    expect(at('return value', 'return')).toBeNull()
    expect(at('foo() // call bar', 'bar')).toBeNull()
    expect(at('x = 1 /* bar */ + y', 'bar')).toBeNull()
    expect(at('const n = 123', '123')).toBeNull()
  })
})
