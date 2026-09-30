import { hasCommit, fetchRefs, type RemoteInfo } from '../git.js'
import { GlabError, type GlabClient, type GlabErrorKind } from './glab.js'

export type GitlabStatus =
  | { available: true; host: string; project: string; webUrl: string; username: string }
  | { available: false; reason: GlabErrorKind; message: string; host?: string }

export type MrState = 'opened' | 'merged' | 'all'

export interface MrListQuery {
  state: MrState
  mine: boolean
  search: string
}

export interface MrSummary {
  iid: number
  title: string
  state: string
  sourceBranch: string
  targetBranch: string
  author: string
  webUrl: string
  updatedAt: string
}

export interface ApiMr {
  iid: number
  title: string
  state: string
  source_branch: string
  target_branch: string
  author: { name: string }
  web_url: string
  updated_at: string
  diff_refs: { base_sha: string; start_sha: string; head_sha: string } | null
}

export function parseRemoteUrl(url: string): { host: string; path: string } | null {
  let host: string
  let path: string
  const scp = url.match(/^[^@/\s]+@([^:/\s]+):(.+)$/)
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    try {
      const parsed = new URL(url)
      if (!parsed.hostname) return null
      host = parsed.hostname
      path = parsed.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/, '')
  return path ? { host: host.toLowerCase(), path } : null
}

export function findGitlabRemote(remotes: RemoteInfo[], host: string, project: string): string | null {
  const match = remotes.find((r) => {
    const parsed = parseRemoteUrl(r.url)
    return parsed !== null && parsed.host === host.toLowerCase() && parsed.path === project
  })
  return match?.name ?? null
}

export async function getGitlabStatus(glab: GlabClient, remotes: RemoteInfo[]): Promise<GitlabStatus> {
  try {
    const project = await glab('projects/:fullpath') as { path_with_namespace: string; web_url: string }
    const user = await glab('user') as { username: string }
    return {
      available: true,
      host: new URL(project.web_url).hostname,
      project: project.path_with_namespace,
      webUrl: project.web_url,
      username: user.username,
    }
  } catch (err) {
    if (!(err instanceof GlabError)) throw err
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
    const host = origin ? parseRemoteUrl(origin.url)?.host : undefined
    return { available: false, reason: err.kind, message: err.message, ...(host ? { host } : {}) }
  }
}

export function parseMrListQuery(get: (name: string) => string | undefined): MrListQuery {
  const state = get('state')
  return {
    state: state === 'merged' || state === 'all' ? state : 'opened',
    mine: get('mine') === 'true',
    search: get('search') ?? '',
  }
}

export function mrListPath(q: MrListQuery): string {
  const params = new URLSearchParams({ state: q.state, order_by: 'updated_at', sort: 'desc', per_page: '50' })
  if (q.mine) params.set('scope', 'assigned_to_me')
  const search = q.search.trim()
  if (search) {
    params.set('search', search)
    params.set('in', 'title')
  }
  return `projects/:fullpath/merge_requests?${params}`
}

export async function listMrs(glab: GlabClient, q: MrListQuery): Promise<MrSummary[]> {
  const list = await glab(mrListPath(q)) as ApiMr[]
  return list.map((m) => ({
    iid: m.iid,
    title: m.title,
    state: m.state,
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    author: m.author.name,
    webUrl: m.web_url,
    updatedAt: m.updated_at,
  }))
}

export interface MrDetail {
  iid: number
  title: string
  state: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  baseSha: string
  startSha: string
  headSha: string
}

export class MrNotFoundError extends Error {}

function isMissingMr(err: unknown): boolean {
  return err instanceof GlabError && err.kind === 'api' && /\b404\b/.test(err.message) && !/Project Not Found/i.test(err.message)
}

export async function getMrDetail(glab: GlabClient, iid: number): Promise<MrDetail> {
  let m: ApiMr
  try {
    m = await glab(`projects/:fullpath/merge_requests/${iid}`) as ApiMr
  } catch (err) {
    if (isMissingMr(err)) throw new MrNotFoundError(`MR !${iid}을 찾지 못했습니다`)
    throw err
  }
  if (!m.diff_refs) throw new GlabError('api', 'MR의 diff 정보를 찾지 못했습니다')
  return {
    iid: m.iid,
    title: m.title,
    state: m.state,
    webUrl: m.web_url,
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    baseSha: m.diff_refs.base_sha,
    startSha: m.diff_refs.start_sha,
    headSha: m.diff_refs.head_sha,
  }
}

export class MrFetchError extends Error {}

export interface MrGitDeps {
  hasCommit: (repo: string, sha: string) => boolean
  fetchRefs: (repo: string, remote: string, refspecs: string[]) => Promise<{ ok: true } | { ok: false; error: string }>
}

export async function ensureMrCommits(repo: string, remote: string, mr: MrDetail, deps: MrGitDeps = { hasCommit, fetchRefs }): Promise<void> {
  const present = () => deps.hasCommit(repo, mr.baseSha) && deps.hasCommit(repo, mr.headSha)
  if (present()) return
  const mrRef = `refs/merge-requests/${mr.iid}/head`
  let result = await deps.fetchRefs(repo, remote, [mrRef, `refs/heads/${mr.targetBranch}`])
  if (!result.ok) result = await deps.fetchRefs(repo, remote, [mrRef, mr.baseSha])
  if (!result.ok) throw new MrFetchError(result.error)
  if (!present()) throw new MrFetchError('MR 기준 커밋을 가져오지 못했습니다')
}
