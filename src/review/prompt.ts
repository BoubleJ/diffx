import type { CodeSelection, ReviewContext } from './types.js'

export const MAX_PATCH_CHARS = 200_000

function fileReadingGuide(ctx: ReviewContext): string {
  if (!ctx.sourceCheckedOut) {
    return `소스 브랜치가 체크아웃되어 있지 않아서 작업 트리의 파일은 비교 대상과 다를 수 있습니다. 파일 전체 내용은 \`git show ${ctx.source}:<경로>\`, 파일 목록은 \`git ls-tree -r --name-only ${ctx.source} -- <경로>\`, 코드 검색은 \`git grep -n <패턴> ${ctx.source} -- <경로>\`로 하세요.`
  }
  return '작업 트리의 파일이 리뷰 대상 코드와 같습니다. 파일을 직접 읽어도 됩니다.'
}

function diffCommand(ctx: ReviewContext): string {
  return `git diff ${ctx.mergeBase} ${ctx.source} -- <경로>`
}

export function buildSystemPrompt(ctx: ReviewContext): string {
  return [
    '## 비교 대상',
    `- ${ctx.target}...${ctx.source} (GitLab MR과 같은 방식)`,
    `- 소스 브랜치: ${ctx.source}`,
    `- 타겟 브랜치: ${ctx.target}`,
    `- merge-base 커밋: ${ctx.mergeBase}`,
    `- ${fileReadingGuide(ctx)}`,
    '',
    '## 지켜야 할 것',
    '- 파일을 수정하지 마세요.',
    '- 읽기와 git 조회 명령(git show, git log, git diff, git grep, git ls-tree)만 사용하세요.',
    '- 명령은 작업 디렉토리(저장소 루트)에서 하나씩 실행하세요. cd, git -C, 변수 대입을 쓰지 말고 ;나 &&로 여러 명령을 묶지 마세요. 이런 명령은 권한 확인에서 거부됩니다.',
    '- 모든 문장은 한국어로 쓰세요.',
    '- 답변에서 코드 위치를 언급하면 그 위치를 locations에 넣으세요. file은 저장소 루트 기준 경로, line은 줄 번호(파일 전체면 null), side는 새 코드면 new, 삭제된 코드면 old입니다.',
    '- 질문에 맞는 형식으로 답하세요. 사용자가 리뷰를 요청하지 않았으면 리뷰하지 마세요.',
    '- answer는 markdown으로 써도 됩니다.',
  ].join('\n')
}

export function buildReviewPrompt(ctx: ReviewContext): string {
  const patchSection = ctx.patch.length > MAX_PATCH_CHARS
    ? `diff가 커서 본문을 싣지 않았습니다. 파일별 diff는 \`${diffCommand(ctx)}\`로 직접 확인하세요.`
    : ['```diff', ctx.patch, '```'].join('\n')

  return [
    '아래 변경사항을 리뷰하세요.',
    '',
    '- 버그, 보안 문제, 잘못된 동작, 누락된 예외 처리를 우선 찾으세요. 취향 차이인 스타일 지적은 하지 마세요.',
    '- answer에는 무엇을 바꿨고 머지 전에 확인할 점이 무엇인지 쓰세요.',
    '- 지적할 코드 위치는 locations에 넣으세요. 지적할 것이 없으면 locations를 빈 배열로 두세요.',
    `- 파일별 변경 내용은 \`${diffCommand(ctx)}\`로 확인할 수 있습니다.`,
    '- 변경된 코드를 호출하는 곳이나 관련 타입 정의가 필요하면 저장소 파일을 찾아 읽으세요.',
    '',
    '## 변경된 파일',
    ...ctx.files.map((f) => `- ${f}`),
    '',
    '## diff',
    patchSection,
  ].join('\n')
}

function codeFence(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

export function buildQuestionPrompt(question: string, selection?: CodeSelection): string {
  if (!selection) return question
  const lines = selection.startLine === selection.endLine ? `${selection.startLine}줄` : `${selection.startLine}-${selection.endLine}줄`
  const side = selection.side === 'additions' ? '변경 후 코드' : '변경 전 코드'
  const fence = codeFence(selection.code)
  return `사용자가 diff에서 선택한 코드: ${selection.path} ${lines} (${side})\n${fence}\n${selection.code}\n${fence}\n\n질문: ${question}`
}
