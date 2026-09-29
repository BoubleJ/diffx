import { relative, isAbsolute } from 'node:path'
import { REVIEW_JSON_SCHEMA } from '../schema.js'
import type { ReviewProvider } from '../types.js'

export function describeTool(name: string, input: Record<string, unknown>, repoPath?: string): string {
  const path = (input.file_path ?? input.path) as string | undefined
  const shown = path && repoPath && isAbsolute(path) ? relative(repoPath, path) : path
  const fallback = `${name} 사용 중`
  switch (name) {
    case 'Read':
      return shown ? `${shown} 읽는 중` : fallback
    case 'Grep':
      return input.pattern ? `"${input.pattern}" 검색 중` : fallback
    case 'Glob':
      return input.pattern ? `${input.pattern} 파일 찾는 중` : fallback
    case 'Bash':
      return input.command ? `${input.command} 실행 중` : fallback
    case 'StructuredOutput':
      return '결과 정리 중'
    default:
      return fallback
  }
}

export const claudeProvider: ReviewProvider = {
  id: 'claude',
  label: 'Claude Code',
  verified: true,
  installHint: 'https://docs.anthropic.com/claude-code',
  loginHint: 'claude',
  authPattern: /\/login|log ?in|invalid api key|authenticat|unauthori[sz]ed/i,
  versionArgs: ['--version'],
  buildCommand(ctx, prompt) {
    return {
      bin: 'claude',
      args: [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--no-session-persistence',
        '--restricted',
        '--strict-mcp-config',
        '--permission-mode', 'dontAsk',
        '--tools', 'Read', 'Grep', 'Glob', 'Bash',
        '--json-schema', JSON.stringify(REVIEW_JSON_SCHEMA),
        '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git diff:*)',
        '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(git * --output*)',
      ],
      stdin: prompt,
    }
  },
  parseLine(line) {
    const ev = JSON.parse(line)
    if (ev.type === 'assistant') {
      const tool = ev.message?.content?.find((c: { type: string }) => c.type === 'tool_use')
      return tool ? { progress: describeTool(tool.name, tool.input ?? {}) } : null
    }
    if (ev.type === 'result') {
      return { final: { json: ev.structured_output, text: ev.result, isError: ev.is_error === true } }
    }
    return null
  },
}
