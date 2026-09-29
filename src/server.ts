import { readFile } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getRepoName, getBranchName, getFileContent, getBlobContent, getWorktreeFileContent, getTabSizeForFiles, getUntrackedFilePaths, listBranches, fetchAll, getFileAtCommit, getHeadSha } from './git.js'
import { resolveComparison, resolveBranchRefs, createRangeDiffCache, comparisonKey, queryFromSearch, ComparisonError, type ResolvedComparison, type BranchRefs } from './comparison.js'
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
import type { ReviewProvider } from './review/types.js'

export interface AppOptions {
  repoPath: string
  clientDir: string
  customDiffArgs?: string[]
  // CLI에서 custom 모드 인자의 pathspec을 사용자가 실행한 디렉터리 기준으로 해석하려고 쓴다.
  diffCwd?: string
  commentStore?: CommentStore
  reviewJobs?: ReviewJobs
  reviewStore?: ReviewStore
  providers?: ReviewProvider[]
  token?: string
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
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
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

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
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
  const { repoPath: repo, clientDir, customDiffArgs, commentStore, diffCwd = repo } = options
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
  const isCustomMode = !!customDiffArgs
  const store = commentStore ?? new InMemoryCommentStore()
  const viewedByKey = new Map<string, Map<string, string>>()
  let activeKey = isCustomMode ? comparisonKey({ mode: 'custom', customArgs: customDiffArgs }) : 'worktree'
  const keyFrom = (value: string | undefined) => value || activeKey
  const viewedFor = (key: string) => {
    let map = viewedByKey.get(key)
    if (!map) {
      map = new Map()
      viewedByKey.set(key, map)
    }
    return map
  }

  const resolveOptions = { diffCwd, rangeDiff: createRangeDiffCache() }
  const resolveFromRequest = (c: Context): ResolvedComparison => {
    const q = queryFromSearch((name) => c.req.query(name))
    return resolveComparison(repo, customDiffArgs, q, resolveOptions)
  }

  const comparisonErrorResponse = (c: Context, err: unknown) => {
    if (err instanceof ComparisonError) {
      return c.json({ error: err.code, message: err.message }, err.code === 'no_merge_base' ? 422 : 400)
    }
    throw err
  }

  const reviewStore = options.reviewStore ?? new ReviewStore()
  const reviewJobs = options.reviewJobs ?? new ReviewJobs(reviewStore)
  const providers = options.providers ?? PROVIDERS

  app.get('/api/diff', (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = resolveFromRequest(c)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    activeKey = resolved.key
    const { patch } = resolved
    const untracked = resolved.mode === 'worktree' && c.req.query('untracked') === 'true'
    const untrackedFiles = untracked ? getUntrackedFilePaths(repo) : []
    const binaryFiles = parseBinaryFiles(patch, new Set(untrackedFiles))
    const tabSizeMap = getTabSizeForFiles(repo, parseFilePaths(patch))
    return c.json({
      patch,
      repoName: getRepoName(repo),
      branch: getBranchName(repo),
      customMode: isCustomMode,
      binaryFiles,
      tabSizeMap,
      untrackedFiles,
      key: resolved.key,
      mode: resolved.mode,
      sourceSha: resolved.sourceSha,
      targetSha: resolved.targetSha,
      mergeBase: resolved.mergeBase,
      identical: resolved.mode === 'branch' && resolved.sourceSha === resolved.targetSha,
    })
  })

  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    let content: Buffer | null
    if (c.req.query('mode') === 'branch' && !isCustomMode) {
      let refs: BranchRefs
      try {
        refs = resolveBranchRefs(repo, { source: c.req.query('source'), target: c.req.query('target') })
      } catch (err) {
        return comparisonErrorResponse(c, err)
      }
      content = getFileAtCommit(repo, version === 'old' ? refs.mergeBase : refs.sourceSha, path)
    } else {
      content = getFileContent(repo, path, version)
    }
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  // Full old/new file contents for a diffed file, so the client can build a
  // non-partial diff that supports expanding context around hunks.
  // `oldOid`/`newOid` are blob ids from the patch's `index` line. The diff is
  // regenerated and the requested oids must match its `index` line for the
  // requested path: this keeps arbitrary repository blobs unreachable, and
  // rejects requests whose patch no longer matches the worktree (git recomputes
  // the worktree blob hash on every diff, so any edit changes the new oid).
  app.get('/api/file-versions', (c) => {
    const path = c.req.query('path')
    const oldOid = c.req.query('oldOid')
    const newOid = c.req.query('newOid')
    if (!path || !oldOid || !newOid) {
      return c.json({ error: 'Missing path or oids' }, 400)
    }
    let patch: string
    try {
      patch = resolveFromRequest(c).patch
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    if (!diffContainsFileVersion(patch, path, oldOid, newOid)) {
      return c.json({ error: 'File version not in current diff' }, 404)
    }
    // A zero oid is git's `/dev/null` — an absent side (creation/deletion), so
    // its content is empty. A non-zero oid that is missing from the object
    // database is the worktree blob of an unstaged change (git computes its
    // hash without storing it), so fall back to reading the worktree.
    const oldContent = /^0+$/.test(oldOid) ? '' : getBlobContent(repo, oldOid)
    const newContent = /^0+$/.test(newOid) ? '' : getBlobContent(repo, newOid) ?? getWorktreeFileContent(repo, path)
    if (oldContent == null || newContent == null) {
      return c.json({ error: 'Content unavailable' }, 404)
    }
    return c.json({ old: oldContent, new: newContent })
  })

  app.get('/api/repo', (c) => {
    return c.json({ root: repo, name: getRepoName(repo), customMode: isCustomMode })
  })

  app.get('/api/branches', (c) => {
    return c.json(listBranches(repo))
  })

  app.post('/api/fetch', async (c) => {
    const result = await fetchAll(repo)
    return c.json(result, result.ok ? 200 : 500)
  })

  app.get('/api/review/providers', async (c) => {
    const list = await Promise.all(providers.map(async (p) => {
      const status = await detectProvider(p)
      return { id: p.id, label: p.label, ...status, verified: p.verified, installHint: p.installHint, loginHint: p.loginHint }
    }))
    return c.json(list)
  })

  app.get('/api/review', (c) => {
    let resolved: ResolvedComparison
    try {
      resolved = resolveFromRequest(c)
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
    let body: { provider: string; mode?: string; source?: string; target?: string; staged?: boolean; untracked?: boolean }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    const provider = providers.find((p) => p.id === body.provider)
    if (!provider) return c.json({ error: 'unknown_provider' }, 400)
    let resolved: ResolvedComparison
    try {
      resolved = resolveComparison(repo, customDiffArgs, { mode: body.mode, source: body.source, target: body.target, staged: body.staged, untracked: body.untracked }, resolveOptions)
    } catch (err) {
      return comparisonErrorResponse(c, err)
    }
    const id = reviewJobs.start({
      provider,
      key: resolved.key,
      fingerprint: fingerprint(resolved),
      ctx: {
        repoPath: repo,
        mode: resolved.mode,
        source: resolved.source,
        target: resolved.target,
        mergeBase: resolved.mergeBase,
        customArgs: customDiffArgs,
        staged: resolved.mode === 'worktree' && body.staged === true,
        sourceCheckedOut: resolved.mode !== 'branch' || getHeadSha(repo) === resolved.sourceSha,
        files: parseFilePaths(resolved.patch),
        patch: resolved.patch,
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
    return c.json(Object.fromEntries(viewedFor(keyFrom(c.req.query('key')))))
  })

  app.put('/api/viewed', async (c) => {
    const { key, filePath, viewed, contentHash } = await c.req.json<{ key?: string; filePath: string; viewed: boolean; contentHash?: string }>()
    const map = viewedFor(keyFrom(key))
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
    const comments = await store.getAll(keyFrom(c.req.query('key')))
    return c.json(comments)
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const comment = {
      id: crypto.randomUUID(),
      key: keyFrom(body.key),
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
