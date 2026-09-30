import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { claudeProvider, describeTool } from './claude'
import { validateResult } from '../schema'
import type { ReviewContext } from '../types'

const ctx: ReviewContext = { repoPath: '/repo', mode: 'branch', source: 'feature/x', target: 'main', mergeBase: 'abc123', sourceCheckedOut: true, files: [], patch: '' }

describe('claudeProvider.buildCommand', () => {
  it('runs claude headless with read-only tools and the schema', () => {
    const cmd = claudeProvider.buildCommand(ctx, 'PROMPT')
    expect(cmd.bin).toBe('claude')
    expect(cmd.stdin).toBe('PROMPT')
    expect(cmd.args.slice(0, 9)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk'])
    expect(cmd.args.slice(cmd.args.indexOf('--tools') + 1, cmd.args.indexOf('--json-schema'))).toEqual(['Read', 'Grep', 'Glob', 'Bash'])
    const allowed = cmd.args.slice(cmd.args.indexOf('--allowedTools') + 1, cmd.args.indexOf('--disallowedTools'))
    expect(allowed).toEqual(['Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git diff:*)'])
    const denied = cmd.args.slice(cmd.args.indexOf('--disallowedTools') + 1)
    expect(denied).toEqual(['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(git * --output*)', 'Bash(git * --no-index*)'])
    expect(JSON.parse(cmd.args[cmd.args.indexOf('--json-schema') + 1]).required).toEqual(['answer', 'locations'])
  })
})

describe('claudeProvider.parseLine', () => {
  it('parses the recorded stream into progress and a valid final result', () => {
    const lines = readFileSync(fileURLToPath(new URL('../__fixtures__/claude-stream.jsonl', import.meta.url)), 'utf-8').split('\n').filter(Boolean)
    const parsed = lines.map((l) => claudeProvider.parseLine!(l)).filter(Boolean)
    expect(parsed.map((p) => p!.progress).filter(Boolean)).toEqual(['git diff a.ts 실행 중', '/repo/a.ts 읽는 중', '결과 정리 중'])
    const final = parsed.find((p) => p!.final)!.final!
    expect(final.isError).toBe(false)
    const candidate = final.json ?? JSON.parse(final.text!)
    expect(validateResult(candidate)).not.toBeNull()
  })

  it('marks error results', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' })
    expect(claudeProvider.parseLine!(line)).toEqual({ final: { json: undefined, text: 'Invalid API key · Please run /login', isError: true } })
    expect(claudeProvider.authPattern.test('Invalid API key · Please run /login')).toBe(true)
  })
})

describe('describeTool', () => {
  it('describes common tools in Korean', () => {
    expect(describeTool('Read', { file_path: '/repo/src/a.ts' }, '/repo')).toBe('src/a.ts 읽는 중')
    expect(describeTool('Grep', { pattern: 'foo' })).toBe('"foo" 검색 중')
    expect(describeTool('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts 파일 찾는 중')
    expect(describeTool('Bash', { command: 'git show main:a.ts' })).toBe('git show main:a.ts 실행 중')
    expect(describeTool('Other', {})).toBe('Other 사용 중')
    expect(describeTool('StructuredOutput', { summary: 'x' })).toBe('결과 정리 중')
  })

  it('falls back to the tool name when the input field is missing', () => {
    expect(describeTool('Read', {})).toBe('Read 사용 중')
    expect(describeTool('Grep', {})).toBe('Grep 사용 중')
    expect(describeTool('Glob', {})).toBe('Glob 사용 중')
    expect(describeTool('Bash', {})).toBe('Bash 사용 중')
  })
})
