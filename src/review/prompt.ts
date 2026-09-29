import type { ReviewContext } from './types.js'

export const MAX_PATCH_CHARS = 200_000

function describeComparison(ctx: ReviewContext): string {
  if (ctx.mode === 'branch') {
    return [
      `비교 대상: ${ctx.target}...${ctx.source} (GitLab MR과 같은 방식)`,
      `- 소스 브랜치: ${ctx.source}`,
      `- 타겟 브랜치: ${ctx.target}`,
      `- merge-base 커밋: ${ctx.mergeBase}`,
    ].join('\n')
  }
  if (ctx.mode === 'custom') return `비교 대상: 사용자가 지정한 git diff 인자(${(ctx.customArgs ?? []).join(' ')})의 결과`
  return '비교 대상: 작업 트리의 커밋하지 않은 변경사항'
}

function fileReadingGuide(ctx: ReviewContext): string {
  if (ctx.mode === 'branch' && !ctx.sourceCheckedOut) {
    return `소스 브랜치가 체크아웃되어 있지 않아서 작업 트리의 파일은 리뷰 대상과 다를 수 있습니다. 파일 전체 내용은 \`git show ${ctx.source}:<경로>\`로 읽으세요.`
  }
  if (ctx.mode === 'custom') {
    return '사용자가 지정한 git diff 인자로 만든 diff라서 작업 트리의 파일은 리뷰 대상과 다를 수 있습니다. 변경 내용은 아래 diff 명령으로 확인하세요.'
  }
  return '작업 트리의 파일이 리뷰 대상 코드와 같습니다. 파일을 직접 읽어도 됩니다.'
}

function diffCommand(ctx: ReviewContext): string {
  if (ctx.mode === 'branch') return `git diff ${ctx.mergeBase} ${ctx.source} -- <경로>`
  if (ctx.mode === 'custom') {
    const args = ctx.customArgs ?? []
    const separator = args.indexOf('--')
    const revisionArgs = separator === -1 ? args : args.slice(0, separator)
    return ['git diff', ...revisionArgs, '-- <경로>'].join(' ')
  }
  return ctx.staged ? 'git diff HEAD -- <경로>' : 'git diff -- <경로>'
}

export function buildPrompt(ctx: ReviewContext): string {
  const patchSection = ctx.patch.length > MAX_PATCH_CHARS
    ? `diff가 커서 본문을 싣지 않았습니다. 파일별 diff는 \`${diffCommand(ctx)}\`로 직접 확인하세요.`
    : ['```diff', ctx.patch, '```'].join('\n')

  return [
    '당신은 시니어 코드 리뷰어입니다. 아래 변경사항을 리뷰하세요.',
    '',
    describeComparison(ctx),
    '',
    '## 지켜야 할 것',
    '- 파일을 수정하지 마세요. 읽기와 git 조회 명령(git show, git log, git diff)만 사용하세요.',
    `- ${fileReadingGuide(ctx)}`,
    `- 파일별 변경 내용은 \`${diffCommand(ctx)}\`로 확인할 수 있습니다.`,
    '- 변경된 코드를 호출하는 곳이나 관련 타입 정의가 필요하면 저장소 파일을 찾아 읽으세요.',
    '- 버그, 보안 문제, 잘못된 동작, 누락된 예외 처리를 우선 찾으세요. 취향 차이인 스타일 지적은 info로만 남기세요.',
    '- 모든 문장은 한국어로 쓰세요.',
    '',
    '## 응답 형식',
    '다른 설명 없이 아래 형식의 JSON 객체 하나만 응답하세요.',
    '```json',
    '{',
    '  "summary": "MR 전체 요약. 무엇을 바꿨고 머지 전에 확인할 점이 무엇인지 3~6문장",',
    '  "findings": [',
    '    {',
    '      "severity": "critical | major | minor | info 중 하나",',
    '      "file": "저장소 루트 기준 파일 경로",',
    '      "line": "지적하는 줄 번호(정수). 파일 전체에 대한 지적이면 null",',
    '      "side": "새 코드의 줄이면 new, 삭제된 코드의 줄이면 old",',
    '      "title": "한 줄 요약",',
    '      "body": "문제 설명과 수정 제안"',
    '    }',
    '  ]',
    '}',
    '```',
    '지적할 것이 없으면 findings를 빈 배열로 두세요.',
    '',
    '## 변경된 파일',
    ...ctx.files.map((f) => `- ${f}`),
    '',
    '## diff',
    patchSection,
  ].join('\n')
}
