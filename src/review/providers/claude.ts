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
  sessionMissingPattern: /No conversation found with session ID/,
  versionArgs: ['--version'],
  buildCommand(_ctx, request) {
    return {
      bin: 'claude',
      args: [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        ...(request.session.resume ? ['--resume', request.session.id] : ['--session-id', request.session.id]),
        '--append-system-prompt', request.systemPrompt,
        '--restricted',
        '--strict-mcp-config',
        '--permission-mode', 'dontAsk',
        '--tools', 'Read', 'Grep', 'Glob', 'Bash',
        '--json-schema', JSON.stringify(REVIEW_JSON_SCHEMA),
        '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git grep:*)', 'Bash(git ls-tree:*)',
        '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Bash(git * --output*)', 'Bash(git * --no-index*)', 'Bash(git grep*-O*)', 'Bash(git grep*--open-files-in-pager*)',
      ],
      stdin: request.prompt,
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
