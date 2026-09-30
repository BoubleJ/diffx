import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getRepoName, getBranchName, getBlobContent, getTabSizeForFiles, listBranches, fetchAll, getFileAtCommit, getHeadSha, listRemotes } from './git.js'
import { resolveComparison, resolveBranchRefs, createRangeDiffCache, queryFromSearch, ComparisonError, type ResolvedComparison, type BranchRefs } from './comparison.js'
import type { Context } from 'hono'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore } from './comments.js'
import type { CommentStore } from './comments.js'
import { isSafePath } from './path.js'
import { ReviewJobs } from './review/jobs.js'
import { ReviewStore } from './review/store.js'
import { PROVIDERS } from './review/providers/index.js'
import { detectProvider } from './review/runner.js'
import { fingerprint } from './review/fingerprint.js'
import { excludeFilesFromPatch } from './review/filterPatch.js'
import type { ReviewProvider } from './review/types.js'
import { createGlabClient, GlabError, type GlabClient } from './gitlab/glab.js'
import { getGitlabStatus, listMrs, parseMrListQuery, MrFetchError, MrNotFoundError, type GitlabStatus } from './gitlab/mr.js'
import { MrComparisons, MrRequestError, parseIid, type MrResolved } from './gitlab/mrComparison.js'
import { DEFAULT_WORKTREE_ROOT, WorktreeGitError, checkoutReviewWorktree, getReviewWorktree, listChangedFiles, openWithApp, removeReviewWorktree, reviewWorktreePath } from './gitlab/reviewWorktree.js'
import { buildPosition } from './gitlab/position.js'
import { buildThreads, type ApiDiscussion, type ApiDraftNote } from './gitlab/notes.js'
import { commitReader, type SourceReader } from './definition/reader.js'
import { resolveDefinition } from './definition/resolve.js'

export interface AppOptions {
  repoPath: string
  clientDir: string
  commentStore?: CommentStore
  reviewJobs?: ReviewJobs
  reviewStore?: ReviewStore
  providers?: ReviewProvider[]
  token?: string
  glab?: GlabClient
  reviewWorktreeRoot?: string
  openApp?: (args: string[]) => Promise<void>
}

export interface StartOptions extends AppOptions {
  port: number
  host: string
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed'
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('Binary files ') || !line.includes(' differ')) continue

    // Find the file path from the preceding diff --git line
    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const match = lines[j].match(/^diff --git a\/.+ b\/(.+)$/)
      if (match) {
        filePath = match[1]
        break
      }
    }
    if (!filePath) continue

    // Determine change type from surrounding lines
    let changeType: BinaryFileInfo['type'] = 'changed'
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].startsWith('diff --git')) break
      if (lines[j].startsWith('new file mode')) {
        changeType = 'added'
        break
      }
      if (lines[j].startsWith('deleted file mode')) {
        changeType = 'deleted'
        break
      }
    }

    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

function diffContainsFileVersion(patch: string, path: string, oldOid: string, newOid: string): boolean {
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    // Match the new-file path from the `+++ b/<path>` header (as the client
    // does); the `diff --git` line is ambiguous for paths containing ` b/`.
    const nameMatch = chunk.match(/^\+\+\+ [ab]\/([^\t\r\n]+)/m)
    if (!nameMatch || nameMatch[1].trim() !== path) continue
    const indexMatch = chunk.match(/^index ([0-9a-f]+)\.\.([0-9a-f]+)/m)
    if (indexMatch && indexMatch[1] === oldOid && indexMatch[2] === newOid) return true
  }
  return false
}

export function createApp(options: AppOptions) {
  const { repoPath: repo, clientDir, commentStore } = options
  const app = new Hono()
  if (options.token) {
    const token = options.token
    app.use('/api/*', async (c, next) => {
      if (c.req.header('X-Diffx-Token') !== token) {
        return c.json({ error: 'forbidden' }, 403)
      }
      await next()
    })
  }
  // 토큰이 없는 CLI 서버에 다른 웹페이지가 form이나 text/plain 요청으로 리뷰 실행, 코멘트 변경을 보내지 못하게 한다.
  app.on(['POST', 'PUT', 'DELETE'], '/api/*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin !== undefined && origin !== new URL(c.req.url).origin) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const contentType = c.req.header('Content-Type')
    if (contentType !== undefined && contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return c.json({ error: 'unsupported_media_type' }, 415)
    }
    await next()
  })
  const store = commentStore ?? new InMemoryCommentStore()
  const viewedByKey = new Map<string, Map<string, string>>()
  let activeKey: string | null = null
  const keyFrom = (value: string | undefined) => value || activeKey
  const viewedFor = (key: string) => {
    let map = viewedByKey.get(key)
    if (!map) {
      map = new Map()
      viewedByKey.set(key, map)
    }
    return map
  }

  const glab = options.glab ?? createGlabClient(repo)
  let gitlabStatus: Promise<GitlabStatus> | null = null
  const getStatus = (refresh = false) => {
    if (refresh || !gitlabStatus) gitlabStatus = getGitlabStatus(glab, listRemotes(repo))
    return gitlabStatus
  }

  const resolveOptions = { rangeDiff: createRangeDiffCache() }
  const mrComparisons = new MrComparisons(repo, glab, () => getStatus(), resolveOptions.rangeDiff)
  const resolveFromRequest = async (c: Context, refresh = false): Promise<ResolvedComparison> => {
    const q = queryFromSearch((name) => c.req.query(name))
    if (q.mode === 'mr') return mrComparisons.resolve(parseIid(q.iid), { refresh })
    return resolveComparison(repo, q, resolveOptions)
  }

  const comparisonErrorResponse = (c: Context, err: unknown) => {
    if (err instanceof ComparisonError) {
      return c.json({ error: err.code, message: err.message }, err.code === 'no_merge_base' ? 422 : 400)
    }
    if (err instanceof MrRequestError) {
      return c.json({ error: 'invalid_iid', message: err.message }, 400)
    }
    if (err instanceof MrNotFoundError) {
      return c.json({ error: 'mr_not_found', message: err.message }, 404)
    }
    if (err instanceof MrFetchError) {
      return c.json({ error: 'mr_fetch_failed', message: err.message }, 502)
    }
    if (err instanceof GlabError) {
      return c.json({ error: err.kind, message: err.message }, 502)
    }
    if (err instanceof WorktreeGitError) {
      return c.json({ error: 'git', message: err.message }, 502)
    }
    throw err
  }

  const reviewStore = options.reviewStore ?? new ReviewStore()
  const reviewJobs = options.reviewJobs ?? new ReviewJobs(reviewStore)
  const providers = options.providers ?? PROVIDERS

  app.get('/api/diff', async (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = await resolveFromRequest(c, true)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    activeKey = resolved.key
    const { patch } = resolved
    const binaryFiles = parseBinaryFiles(patch)
    const tabSizeMap = getTabSizeForFiles(repo, parseFilePaths(patch))
    return c.json({
      patch,
      repoName: getRepoName(repo),
      branch: getBranchName(repo),
      binaryFiles,
      tabSizeMap,
      key: resolved.key,
      mode: resolved.mode,
      sourceSha: resolved.sourceSha,
      targetSha: resolved.targetSha,
      mergeBase: resolved.mergeBase,
      mr: resolved.mode === 'mr' ? (resolved as MrResolved).mr : undefined,
      identical: (resolved.mode === 'branch' || resolved.mode === 'mr') && resolved.sourceSha === resolved.targetSha,
    })
  })

  app.get('/api/file-content', async (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const mode = c.req.query('mode')
    if (mode !== 'branch' && mode !== 'mr') {
      return comparisonErrorResponse(c, new ComparisonError('missing_mode', '비교 방식을 선택해 주세요'))
    }
    let refs: { mergeBase: string; sourceSha: string }
    try {
      if (mode === 'mr') {
        const resolved = await mrComparisons.resolve(parseIid(c.req.query('iid')), { refresh: false })
        refs = { mergeBase: resolved.mergeBase!, sourceSha: resolved.sourceSha! }
      } else {
        refs = resolveBranchRefs(repo, { source: c.req.query('source'), target: c.req.query('target') })
      }
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const content = getFileAtCommit(repo, version === 'old' ? refs.mergeBase : refs.sourceSha, path)
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  const readerFor = async (c: Context, side: 'additions' | 'deletions'): Promise<SourceReader> => {
    const mode = c.req.query('mode')
    if (mode === 'branch') {
      const refs = resolveBranchRefs(repo, { source: c.req.query('source'), target: c.req.query('target') })
      return commitReader(repo, side === 'additions' ? refs.sourceSha : refs.mergeBase)
    }
    if (mode === 'mr') {
      const resolved = await mrComparisons.resolve(parseIid(c.req.query('iid')), { refresh: false })
      return commitReader(repo, side === 'additions' ? resolved.sourceSha! : resolved.mergeBase!)
    }
    throw new ComparisonError('missing_mode', '비교 방식을 선택해 주세요')
  }

  app.get('/api/definition', async (c) => {
    const path = c.req.query('path')
    const side = c.req.query('side')
    const line = c.req.query('line') ?? ''
    const col = c.req.query('col') ?? ''
    if (!path || !isSafePath(path, repo) || (side !== 'additions' && side !== 'deletions') || !/^[1-9]\d*$/.test(line) || !/^\d+$/.test(col)) {
      return c.json({ error: 'invalid_query' }, 400)
    }
    let reader: SourceReader
    try {
      reader = await readerFor(c, side)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const result = resolveDefinition(reader, path, Number(line), Number(col))
    return c.json(result.kind === 'found' ? { kind: 'found', version: side === 'additions' ? 'new' : 'old', targets: result.targets } : result)
  })

  // Full old/new file contents for a diffed file, so the client can build a
  // non-partial diff that supports expanding context around hunks.
  // `oldOid`/`newOid` are blob ids from the patch's `index` line. The diff is
  // regenerated and the requested oids must match its `index` line for the
  // requested path: this keeps arbitrary repository blobs unreachable.
  app.get('/api/file-versions', async (c) => {
    const path = c.req.query('path')
    const oldOid = c.req.query('oldOid')
    const newOid = c.req.query('newOid')
    if (!path || !oldOid || !newOid) {
      return c.json({ error: 'Missing path or oids' }, 400)
    }
    let patch: string
    try {
      patch = (await resolveFromRequest(c)).patch
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    if (!diffContainsFileVersion(patch, path, oldOid, newOid)) {
      return c.json({ error: 'File version not in current diff' }, 404)
    }
    // A zero oid is git's `/dev/null` — an absent side (creation/deletion), so
    // its content is empty.
    const oldContent = /^0+$/.test(oldOid) ? '' : getBlobContent(repo, oldOid)
    const newContent = /^0+$/.test(newOid) ? '' : getBlobContent(repo, newOid)
    if (oldContent == null || newContent == null) {
      return c.json({ error: 'Content unavailable' }, 404)
    }
    return c.json({ old: oldContent, new: newContent })
  })

  app.get('/api/repo', (c) => {
    return c.json({ root: repo, name: getRepoName(repo) })
  })

  app.get('/api/branches', (c) => {
    return c.json(listBranches(repo))
  })

  app.post('/api/fetch', async (c) => {
    const result = await fetchAll(repo)
    return c.json(result, result.ok ? 200 : 500)
  })

  app.get('/api/gitlab/status', async (c) => {
    return c.json(await getStatus(c.req.query('refresh') === 'true'))
  })

  app.get('/api/gitlab/mrs', async (c) => {
    try {
      return c.json(await listMrs(glab, parseMrListQuery((name) => c.req.query(name))))
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  const mrPath = (iid: number) => `projects/:fullpath/merge_requests/${iid}`

  app.get('/api/gitlab/mrs/:iid/threads', async (c) => {
    try {
      const iid = parseIid(c.req.param('iid'))
      const mr = await mrComparisons.detail(iid, { headSha: c.req.query('head') })
      const [discussions, drafts] = await Promise.all([
        glab(`${mrPath(iid)}/discussions?per_page=100`, { paginate: true }) as Promise<ApiDiscussion[]>,
        glab(`${mrPath(iid)}/draft_notes?per_page=100`, { paginate: true }) as Promise<ApiDraftNote[]>,
      ])
      return c.json(buildThreads(`mr:${iid}`, mr.headSha, discussions, drafts))
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/gitlab/mrs/:iid/drafts', async (c) => {
    let body: { filePath?: unknown; side?: unknown; lineNumber?: unknown; discussionId?: unknown; body?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    if (typeof body.body !== 'string' || !body.body.trim()) {
      return c.json({ error: 'invalid_body', message: '코멘트 내용을 입력해 주세요' }, 400)
    }
    try {
      const iid = parseIid(c.req.param('iid'))
      const path = `${mrPath(iid)}/draft_notes`
      if (typeof body.discussionId === 'string' && body.discussionId) {
        await glab(path, { method: 'POST', body: { note: body.body, in_reply_to_discussion_id: body.discussionId } })
        return c.json({ ok: true }, 201)
      }
      const resolved = await mrComparisons.resolve(iid, { refresh: false })
      const position = typeof body.filePath === 'string' && (body.side === 'additions' || body.side === 'deletions') && Number.isInteger(body.lineNumber)
        ? buildPosition(resolved.patch, body.filePath, body.side, body.lineNumber as number, resolved.mr)
        : null
      if (!position) {
        return c.json({ error: 'invalid_position', message: '이 줄에는 GitLab 코멘트를 달 수 없습니다' }, 400)
      }
      await glab(path, { method: 'POST', body: { note: body.body, position } })
      return c.json({ ok: true }, 201)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.delete('/api/gitlab/mrs/:iid/drafts/:id', async (c) => {
    const id = c.req.param('id')
    if (!/^\d+$/.test(id)) return c.json({ error: 'invalid_id' }, 400)
    try {
      await glab(`${mrPath(parseIid(c.req.param('iid')))}/draft_notes/${id}`, { method: 'DELETE' })
      return c.json({ ok: true })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/gitlab/mrs/:iid/publish', async (c) => {
    try {
      await glab(`${mrPath(parseIid(c.req.param('iid')))}/draft_notes/bulk_publish`, { method: 'POST' })
      return c.json({ ok: true })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  const worktreeRoot = options.reviewWorktreeRoot ?? DEFAULT_WORKTREE_ROOT
  const openApp = options.openApp ?? openWithApp

  app.get('/api/review-worktree', async (c) => {
    try {
      return c.json(await getReviewWorktree(worktreeRoot, repo))
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.get('/api/review-worktree/changes', async (c) => {
    try {
      return c.json({ files: await listChangedFiles(worktreeRoot, repo) })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/gitlab/mrs/:iid/checkout', async (c) => {
    let body: { force?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    try {
      const mr = await mrComparisons.prepare(parseIid(c.req.param('iid')), { refresh: true })
      const result = await checkoutReviewWorktree(worktreeRoot, repo, mr.headSha, { force: body.force === true })
      if (result.kind === 'dirty') return c.json({ error: 'dirty', files: result.files }, 409)
      return c.json({ path: result.path, headSha: result.headSha, copiedEnvFiles: result.copiedEnvFiles })
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
  })

  app.post('/api/review-worktree/open-terminal', async (c) => {
    const path = reviewWorktreePath(worktreeRoot, repo)
    if (!existsSync(path)) {
      return c.json({ error: 'not_found', message: '리뷰용 worktree가 없습니다. 먼저 체크아웃해 주세요' }, 404)
    }
    try {
      await openApp(['-a', loadSettings().terminalApp || 'Terminal', path])
    } catch (err) {
      return c.json({ error: 'open_failed', message: (err as Error).message }, 502)
    }
    return c.body(null, 204)
  })

  app.delete('/api/review-worktree', async (c) => {
    try {
      await removeReviewWorktree(worktreeRoot, repo)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    return c.body(null, 204)
  })

  app.get('/api/review/providers', async (c) => {
    const list = await Promise.all(providers.map(async (p) => {
      const status = await detectProvider(p)
      return { id: p.id, label: p.label, ...status, verified: p.verified, installHint: p.installHint, loginHint: p.loginHint }
    }))
    return c.json(list)
  })

  app.get('/api/review', async (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = await resolveFromRequest(c)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const record = reviewStore.load(repo, resolved.key)
    return c.json({
      key: resolved.key,
      record,
      stale: record ? record.fingerprint !== fingerprint(resolved) : false,
      running: reviewJobs.runningFor(repo, resolved.key),
    })
  })

  app.post('/api/review', async (c) => {
    let body: { provider: string; mode?: string; source?: string; target?: string; iid?: unknown; exclude?: unknown; instruction?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    const provider = providers.find((p) => p.id === body.provider)
    if (!provider) return c.json({ error: 'unknown_provider' }, 400)
    const instruction = typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction.trim() : undefined
    if (instruction && instruction.length > 2000) {
      return c.json({ error: 'instruction_too_long', message: '추가 지시는 2000자까지 입력할 수 있습니다' }, 400)
    }
    let resolved: ResolvedComparison
    try {
      resolved = body.mode === 'mr'
        ? await mrComparisons.resolve(parseIid(body.iid), { refresh: false })
        : resolveComparison(repo, { mode: body.mode, source: body.source, target: body.target }, resolveOptions)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const exclude = Array.isArray(body.exclude) && body.exclude.every((p) => typeof p === 'string') ? (body.exclude as string[]) : []
    const patch = excludeFilesFromPatch(resolved.patch, exclude)
    const id = reviewJobs.start({
      provider,
      key: resolved.key,
      excluded: exclude,
      instruction,
      fingerprint: fingerprint(resolved),
      ctx: {
        repoPath: repo,
        mode: 'branch',
        source: resolved.source!,
        target: resolved.target!,
        mergeBase: resolved.mergeBase!,
        sourceCheckedOut: getHeadSha(repo) === resolved.sourceSha,
        files: parseFilePaths(patch),
        patch,
        instruction,
      },
    })
    return c.json({ id })
  })

  app.get('/api/review/:id/events', (c) => {
    const id = c.req.param('id')
    return streamSSE(c, async (stream) => {
      let unsubscribe = null as (() => void) | null
      try {
        await new Promise<void>((done) => {
          const finish = (event: string, data: string) => {
            stream.writeSSE({ event, data }).catch(() => {}).finally(done)
          }
          stream.onAbort(done)
          unsubscribe = reviewJobs.subscribe(id, (e) => {
            if (e.type === 'progress') {
              stream.writeSSE({ event: 'progress', data: e.text }).catch(() => {})
            } else if (e.type === 'done') {
              finish('done', JSON.stringify(e.record))
            } else {
              finish('error', JSON.stringify({ kind: e.kind, message: e.message, rawOutput: e.rawOutput }))
            }
          })
          if (!unsubscribe) finish('error', JSON.stringify({ kind: 'process', message: '리뷰 작업을 찾지 못했습니다' }))
        })
      } finally {
        unsubscribe?.()
      }
    })
  })

  app.delete('/api/review/:id', (c) => {
    return c.json({ ok: reviewJobs.cancel(c.req.param('id')) })
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/api/viewed', (c) => {
    const key = keyFrom(c.req.query('key'))
    if (!key) return c.json({})
    return c.json(Object.fromEntries(viewedFor(key)))
  })

  app.put('/api/viewed', async (c) => {
    const { key, filePath, viewed, contentHash } = await c.req.json<{ key?: string; filePath: string; viewed: boolean; contentHash?: string }>()
    const activeOrGiven = keyFrom(key)
    if (!activeOrGiven) return c.json({ error: 'missing_key' }, 400)
    const map = viewedFor(activeOrGiven)
    if (viewed) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) {
        return c.json({ error: 'non-empty contentHash required when marking viewed' }, 400)
      }
      map.set(filePath, contentHash)
    } else {
      map.delete(filePath)
    }
    return c.json({ ok: true })
  })

  app.get('/api/comments', async (c) => {
    const key = keyFrom(c.req.query('key'))
    if (!key) return c.json([])
    const comments = await store.getAll(key)
    return c.json(comments)
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const key = keyFrom(body.key)
    if (!key) return c.json({ error: 'missing_key' }, 400)
    const comment = {
      id: crypto.randomUUID(),
      key,
      origin: 'local' as const,
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const updated = await store.update(id, { body, status })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    const { body } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      createdAt: Date.now(),
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
    return c.json({ ok: true })
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const relativePath = filePath.slice(1)
    if (!isSafePath(relativePath, clientDir)) {
      return c.text('Forbidden', 403)
    }
    const fullPath = resolve(clientDir, relativePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export function startServer(options: StartOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const reviewStore = options.reviewStore ?? new ReviewStore()
  const reviewJobs = options.reviewJobs ?? new ReviewJobs(reviewStore)
  const app = createApp({ ...options, reviewStore, reviewJobs })

  return new Promise((resolve, reject) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      server.off('error', reject)
      resolve({
        port: info.port,
        close: () => {
          reviewJobs.cancelAll({ immediate: true })
          return new Promise<void>((done) => server.close(() => done()))
        },
      })
    })
    server.once('error', reject)
  })
}
