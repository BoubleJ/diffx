import { randomUUID } from 'node:crypto'
import { buildReviewPrompt, buildSystemPrompt } from './prompt.js'
import { runReview, STOP_IMMEDIATELY, type RunOptions } from './runner.js'
import type { MessageKind, ReviewMessage, ReviewStore } from './store.js'
import { ReviewFailure, type FailureKind, type ProviderId, type ReviewContext, type ReviewProvider, type ReviewRequest, type ReviewResult, type ReviewSession } from './types.js'

export type JobEvent =
  | { type: 'progress'; text: string }
  | { type: 'done'; message: ReviewMessage }
  | { type: 'error'; kind: FailureKind; message: string; rawOutput?: string }

export interface StartInput {
  provider: ReviewProvider
  ctx: ReviewContext
  key: string
  fingerprint: string
  kind: MessageKind
  question: string | null
  excluded?: string[]
}

export type RunFn = (provider: ReviewProvider, ctx: ReviewContext, request: ReviewRequest, options: RunOptions) => Promise<ReviewResult>

interface Job {
  id: string
  repoPath: string
  key: string
  provider: ProviderId
  kind: MessageKind
  question: string | null
  startedAt: number
  events: JobEvent[]
  listeners: Set<(e: JobEvent) => void>
  controller: AbortController
  finished: boolean
  aborted: boolean
}

export class ReviewJobs {
  private jobs = new Map<string, Job>()

  constructor(private store: ReviewStore, private run: RunFn = runReview) {}

  start({ provider, ctx, key, fingerprint, kind, question, excluded }: StartInput): string {
    const existing = [...this.jobs.values()].find((j) => this.isActive(j) && j.repoPath === ctx.repoPath && j.key === key && j.provider === provider.id)
    if (existing) return existing.id

    const job: Job = {
      id: randomUUID(),
      repoPath: ctx.repoPath,
      key,
      provider: provider.id,
      kind,
      question: kind === 'question' ? question : null,
      startedAt: Date.now(),
      events: [],
      listeners: new Set(),
      controller: new AbortController(),
      finished: false,
      aborted: false,
    }
    this.jobs.set(job.id, job)

    const emit = (e: JobEvent) => {
      job.events.push(e)
      for (const l of job.listeners) {
        try {
          l(e)
        } catch {
        }
      }
    }
    const finish = (e: JobEvent) => {
      if (job.finished) return
      job.finished = true
      emit(e)
    }
    const fail = (err: unknown) => {
      if (err instanceof ReviewFailure) finish({ type: 'error', kind: err.kind, message: err.message, rawOutput: err.rawOutput })
      else finish({ type: 'error', kind: 'process', message: String((err as Error)?.message ?? err) })
    }

    const prompt = kind === 'review' ? buildReviewPrompt(ctx) : job.question ?? ''
    const systemPrompt = buildSystemPrompt(ctx)
    const runWith = (session: ReviewSession) =>
      this.run(provider, ctx, { prompt, systemPrompt, session }, { signal: job.controller.signal, onProgress: (text) => emit({ type: 'progress', text }) })
        .then((result) => ({ result, sessionId: session.id }))
    const newSession = (): ReviewSession => ({ id: randomUUID(), resume: false })

    let savedSessionId: string | null = null
    try {
      savedSessionId = this.store.load(ctx.repoPath, key)?.sessionId ?? null
    } catch {
    }

    runWith(savedSessionId ? { id: savedSessionId, resume: true } : newSession())
      .catch((err) => {
        if (err instanceof ReviewFailure && err.kind === 'session_missing' && !job.aborted) return runWith(newSession())
        throw err
      })
      .then(({ result, sessionId }) => {
        const message: ReviewMessage = {
          id: randomUUID(),
          createdAt: Date.now(),
          kind,
          question: job.question,
          fingerprint,
          ...(kind === 'review' && excluded && excluded.length > 0 ? { excluded } : {}),
          result,
        }
        try {
          this.store.append(ctx.repoPath, key, { provider: provider.id, providerLabel: provider.label, sessionId, message })
        } catch (err) {
          return fail(err)
        }
        finish({ type: 'done', message })
      }, fail)

    return job.id
  }

  private isActive(job: Job): boolean {
    return !job.finished && !job.aborted
  }

  runningFor(repoPath: string, key: string): { id: string; provider: ProviderId; startedAt: number; kind: MessageKind; question: string | null } | null {
    const job = [...this.jobs.values()].find((j) => this.isActive(j) && j.repoPath === repoPath && j.key === key)
    return job ? { id: job.id, provider: job.provider, startedAt: job.startedAt, kind: job.kind, question: job.question } : null
  }

  subscribe(id: string, listener: (e: JobEvent) => void): (() => void) | null {
    const job = this.jobs.get(id)
    if (!job) return null
    for (const e of job.events) listener(e)
    job.listeners.add(listener)
    return () => job.listeners.delete(listener)
  }

  listenerCount(id: string): number {
    return this.jobs.get(id)?.listeners.size ?? 0
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job || job.finished) return false
    job.aborted = true
    job.controller.abort()
    return true
  }

  cancelAll({ immediate = false }: { immediate?: boolean } = {}): void {
    for (const job of this.jobs.values()) {
      if (!job.finished) {
        job.aborted = true
        job.controller.abort(immediate ? STOP_IMMEDIATELY : undefined)
      }
    }
  }
}
