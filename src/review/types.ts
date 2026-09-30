export type ProviderId = 'claude'

export interface ReviewLocation {
  file: string
  line: number | null
  side: 'old' | 'new'
  title: string
  body: string
}

export interface ReviewResult {
  answer: string
  locations: ReviewLocation[]
}

export interface ReviewContext {
  repoPath: string
  mode: 'branch'
  source: string
  target: string
  mergeBase: string
  sourceCheckedOut: boolean
  files: string[]
  patch: string
}

export interface FinalOutput {
  json?: unknown
  text?: string
  isError?: boolean
}

export interface LineParse {
  progress?: string
  final?: FinalOutput
}

export interface Command {
  bin: string
  args: string[]
  stdin?: string
  outputFile?: string
  cleanup?: () => void
}

export interface ReviewSession {
  id: string
  resume: boolean
}

export interface ReviewRequest {
  prompt: string
  systemPrompt: string
  session: ReviewSession
}

export interface ReviewProvider {
  id: ProviderId
  label: string
  verified: boolean
  installHint: string
  loginHint: string
  authPattern: RegExp
  sessionMissingPattern?: RegExp
  versionArgs: string[]
  buildCommand(ctx: ReviewContext, request: ReviewRequest): Command
  parseLine?(line: string): LineParse | null
  parseFinal?(stdout: string): FinalOutput | null
}

export type FailureKind = 'not_installed' | 'auth' | 'timeout' | 'invalid_output' | 'process' | 'cancelled' | 'session_missing'

export class ReviewFailure extends Error {
  constructor(public kind: FailureKind, message: string, public rawOutput?: string) {
    super(message)
  }
}
