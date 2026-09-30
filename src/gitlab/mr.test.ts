import { describe, it, expect } from 'vitest'
import { parseRemoteUrl, findGitlabRemote, getGitlabStatus, mrListPath, listMrs, parseMrListQuery, getMrDetail, ensureMrCommits, MrFetchError, type MrDetail } from './mr'
import { GlabError } from './glab'
import { fakeGlab } from '../test/fakeGlab'

describe('parseRemoteUrl', () => {
  it('reads https, scp-style ssh and ssh urls', () => {
    expect(parseRemoteUrl('https://gitlab.mrblue.com/mrblue/app.git')).toEqual({ host: 'gitlab.mrblue.com', path: 'mrblue/app' })
    expect(parseRemoteUrl('https://user@GitLab.example.com/group/sub/app/')).toEqual({ host: 'gitlab.example.com', path: 'group/sub/app' })
    expect(parseRemoteUrl('git@gitlab.mrblue.com:mrblue/app.git')).toEqual({ host: 'gitlab.mrblue.com', path: 'mrblue/app' })
    expect(parseRemoteUrl('ssh://git@gitlab.mrblue.com:2222/mrblue/app.git')).toEqual({ host: 'gitlab.mrblue.com', path: 'mrblue/app' })
  })

  it('returns null for local paths', () => {
    expect(parseRemoteUrl('/tmp/remote')).toBeNull()
    expect(parseRemoteUrl('file:///tmp/remote')).toBeNull()
  })
})

describe('findGitlabRemote', () => {
  const remotes = [
    { name: 'github', url: 'https://github.com/me/app.git' },
    { name: 'company', url: 'git@gitlab.mrblue.com:mrblue/app.git' },
  ]
  it('picks the remote matching host and project', () => {
    expect(findGitlabRemote(remotes, 'gitlab.mrblue.com', 'mrblue/app')).toBe('company')
  })
  it('returns null when nothing matches', () => {
    expect(findGitlabRemote(remotes, 'gitlab.mrblue.com', 'mrblue/other')).toBeNull()
  })
})

describe('getGitlabStatus', () => {
  it('returns project and user info', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath': { path_with_namespace: 'mrblue/app', web_url: 'https://gitlab.mrblue.com/mrblue/app' },
      'GET user': { username: 'jung.j.dev' },
    })
    expect(await getGitlabStatus(glab, [])).toEqual({ available: true, host: 'gitlab.mrblue.com', project: 'mrblue/app', webUrl: 'https://gitlab.mrblue.com/mrblue/app', username: 'jung.j.dev' })
  })

  it('reports the failure kind with the origin host', async () => {
    const { glab } = fakeGlab({ 'GET projects/:fullpath': new GlabError('auth', 'Unauthenticated.') })
    const status = await getGitlabStatus(glab, [{ name: 'origin', url: 'https://gitlab.mrblue.com/mrblue/app.git' }])
    expect(status).toEqual({ available: false, reason: 'auth', message: 'Unauthenticated.', host: 'gitlab.mrblue.com' })
  })
})

describe('MR list', () => {
  it('builds the list path from the filter', () => {
    expect(mrListPath({ state: 'opened', mine: false, search: '' }))
      .toBe('projects/:fullpath/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50')
    expect(mrListPath({ state: 'merged', mine: true, search: ' 로그인 ' }))
      .toBe('projects/:fullpath/merge_requests?state=merged&order_by=updated_at&sort=desc&per_page=50&scope=assigned_to_me&search=%EB%A1%9C%EA%B7%B8%EC%9D%B8&in=title')
  })

  it('parses the query with defaults', () => {
    expect(parseMrListQuery(() => undefined)).toEqual({ state: 'opened', mine: false, search: '' })
    const q: Record<string, string> = { state: 'all', mine: 'true', search: 'x' }
    expect(parseMrListQuery((n) => q[n])).toEqual({ state: 'all', mine: true, search: 'x' })
    expect(parseMrListQuery((n) => (n === 'state' ? 'closed' : undefined)).state).toBe('opened')
  })

  it('maps GitLab fields', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath/merge_requests': [{
        iid: 12, title: '로그인 수정', state: 'merged', source_branch: 'feat/login', target_branch: 'main',
        author: { name: '김개발' }, web_url: 'https://gitlab.mrblue.com/mrblue/app/-/merge_requests/12', updated_at: '2026-09-29T07:58:41.879Z', diff_refs: null,
      }],
    })
    expect(await listMrs(glab, { state: 'all', mine: false, search: '' })).toEqual([{
      iid: 12, title: '로그인 수정', state: 'merged', sourceBranch: 'feat/login', targetBranch: 'main',
      author: '김개발', webUrl: 'https://gitlab.mrblue.com/mrblue/app/-/merge_requests/12', updatedAt: '2026-09-29T07:58:41.879Z',
    }])
  })
})

describe('getMrDetail', () => {
  it('reads diff_refs', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath/merge_requests/7': {
        iid: 7, title: 't', state: 'opened', source_branch: 's', target_branch: 'main', author: { name: 'a' },
        web_url: 'u', updated_at: 'd', diff_refs: { base_sha: 'b'.repeat(40), start_sha: 'c'.repeat(40), head_sha: 'd'.repeat(40) },
      },
    })
    expect(await getMrDetail(glab, 7)).toEqual({
      iid: 7, title: 't', webUrl: 'u', sourceBranch: 's', targetBranch: 'main',
      baseSha: 'b'.repeat(40), startSha: 'c'.repeat(40), headSha: 'd'.repeat(40),
    })
  })

  it('fails when GitLab has no diff refs', async () => {
    const { glab } = fakeGlab({ 'GET projects/:fullpath/merge_requests/7': { iid: 7, diff_refs: null } })
    await expect(getMrDetail(glab, 7)).rejects.toMatchObject({ kind: 'api', message: 'MR의 diff 정보를 찾지 못했습니다' })
  })
})

describe('ensureMrCommits', () => {
  const mr: MrDetail = { iid: 7, title: 't', webUrl: 'u', sourceBranch: 's', targetBranch: 'release/1.0', baseSha: 'b'.repeat(40), startSha: 'b'.repeat(40), headSha: 'h'.repeat(40) }

  function deps(present: boolean[], results: ({ ok: true } | { ok: false; error: string })[]) {
    const fetches: string[][] = []
    let checks = 0
    return {
      fetches,
      deps: {
        hasCommit: () => present[Math.min(checks++, present.length - 1)],
        fetchRefs: async (_repo: string, remote: string, refspecs: string[]) => {
          fetches.push([remote, ...refspecs])
          return results.shift() ?? { ok: true as const }
        },
      },
    }
  }

  it('does not fetch when both commits exist', async () => {
    const d = deps([true], [])
    await ensureMrCommits('/repo', 'origin', mr, d.deps)
    expect(d.fetches).toEqual([])
  })

  it('fetches the MR ref and the target branch', async () => {
    const d = deps([false, true, true], [{ ok: true }])
    await ensureMrCommits('/repo', 'company', mr, d.deps)
    expect(d.fetches).toEqual([['company', 'refs/merge-requests/7/head', 'refs/heads/release/1.0']])
  })

  it('falls back to fetching the base sha when the target branch is gone', async () => {
    const d = deps([false, true, true], [{ ok: false, error: "couldn't find remote ref refs/heads/release/1.0" }, { ok: true }])
    await ensureMrCommits('/repo', 'origin', mr, d.deps)
    expect(d.fetches).toEqual([
      ['origin', 'refs/merge-requests/7/head', 'refs/heads/release/1.0'],
      ['origin', 'refs/merge-requests/7/head', 'b'.repeat(40)],
    ])
  })

  it('throws the git error when both fetches fail', async () => {
    const d = deps([false], [{ ok: false, error: 'first' }, { ok: false, error: 'second' }])
    const err = await ensureMrCommits('/repo', 'origin', mr, d.deps).catch((e) => e)
    expect(err).toBeInstanceOf(MrFetchError)
    expect(err.message).toBe('second')
  })

  it('throws when commits are still missing after fetch', async () => {
    const d = deps([false, false], [{ ok: true }])
    await expect(ensureMrCommits('/repo', 'origin', mr, d.deps)).rejects.toThrow('MR 기준 커밋을 가져오지 못했습니다')
  })
})
