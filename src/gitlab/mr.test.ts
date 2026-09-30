import { describe, it, expect } from 'vitest'
import { parseRemoteUrl, findGitlabRemote, getGitlabStatus, mrListPath, listMrs, parseMrListQuery } from './mr'
import { GlabError } from './glab'
import { fakeGlab } from '../test/fakeGlab'

describe('parseRemoteUrl', () => {
  it('reads https, scp-style ssh and ssh urls', () => {
    expect(parseRemoteUrl('https://gitlab.example.com/acme/app.git')).toEqual({ host: 'gitlab.example.com', path: 'acme/app' })
    expect(parseRemoteUrl('https://user@GitLab.example.com/group/sub/app/')).toEqual({ host: 'gitlab.example.com', path: 'group/sub/app' })
    expect(parseRemoteUrl('git@gitlab.example.com:acme/app.git')).toEqual({ host: 'gitlab.example.com', path: 'acme/app' })
    expect(parseRemoteUrl('ssh://git@gitlab.example.com:2222/acme/app.git')).toEqual({ host: 'gitlab.example.com', path: 'acme/app' })
  })

  it('returns null for local paths', () => {
    expect(parseRemoteUrl('/tmp/remote')).toBeNull()
    expect(parseRemoteUrl('file:///tmp/remote')).toBeNull()
  })
})

describe('findGitlabRemote', () => {
  const remotes = [
    { name: 'github', url: 'https://github.com/me/app.git' },
    { name: 'company', url: 'git@gitlab.example.com:acme/app.git' },
  ]
  it('picks the remote matching host and project', () => {
    expect(findGitlabRemote(remotes, 'gitlab.example.com', 'acme/app')).toBe('company')
  })
  it('returns null when nothing matches', () => {
    expect(findGitlabRemote(remotes, 'gitlab.example.com', 'acme/other')).toBeNull()
  })
})

describe('getGitlabStatus', () => {
  it('returns project and user info', async () => {
    const { glab } = fakeGlab({
      'GET projects/:fullpath': { path_with_namespace: 'acme/app', web_url: 'https://gitlab.example.com/acme/app' },
      'GET user': { username: 'dev.user' },
    })
    expect(await getGitlabStatus(glab, [])).toEqual({ available: true, host: 'gitlab.example.com', project: 'acme/app', webUrl: 'https://gitlab.example.com/acme/app', username: 'dev.user' })
  })

  it('reports the failure kind with the origin host', async () => {
    const { glab } = fakeGlab({ 'GET projects/:fullpath': new GlabError('auth', 'Unauthenticated.') })
    const status = await getGitlabStatus(glab, [{ name: 'origin', url: 'https://gitlab.example.com/acme/app.git' }])
    expect(status).toEqual({ available: false, reason: 'auth', message: 'Unauthenticated.', host: 'gitlab.example.com' })
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
        author: { name: '김개발' }, web_url: 'https://gitlab.example.com/acme/app/-/merge_requests/12', updated_at: '2026-09-29T07:58:41.879Z', diff_refs: null,
      }],
    })
    expect(await listMrs(glab, { state: 'all', mine: false, search: '' })).toEqual([{
      iid: 12, title: '로그인 수정', state: 'merged', sourceBranch: 'feat/login', targetBranch: 'main',
      author: '김개발', webUrl: 'https://gitlab.example.com/acme/app/-/merge_requests/12', updatedAt: '2026-09-29T07:58:41.879Z',
    }])
  })
})
