import { describe, it, expect } from 'vitest'
import { gitlabUnavailableMessage, reconcileMrAvailability, mrTabAction, mrNotFoundReset, mrStateBadge } from './gitlab'

describe('gitlabUnavailableMessage', () => {
  it('explains each reason', () => {
    expect(gitlabUnavailableMessage({ available: false, reason: 'not_installed', message: '' })).toBe('glab이 설치되어 있지 않습니다 (brew install glab)')
    expect(gitlabUnavailableMessage({ available: false, reason: 'auth', message: '', host: 'gitlab.example.com' }))
      .toBe('glab 로그인이 필요합니다. 터미널에서 `glab auth login --hostname gitlab.example.com`를 실행해 주세요')
    expect(gitlabUnavailableMessage({ available: false, reason: 'auth', message: '' }))
      .toBe('glab 로그인이 필요합니다. 터미널에서 `glab auth login`를 실행해 주세요')
    expect(gitlabUnavailableMessage({ available: false, reason: 'not_gitlab', message: '' })).toBe('원격 저장소가 GitLab이 아닙니다')
    expect(gitlabUnavailableMessage({ available: false, reason: 'api', message: 'glab: 500' })).toBe('glab: 500')
  })
})

describe('reconcileMrAvailability', () => {
  const branches = { local: ['feature/x', 'main'], remote: ['origin/main'], current: 'feature/x', defaultTarget: 'origin/main' }
  const branchComparison = { mode: 'branch' as const, source: 'feature/x', target: 'origin/main' }
  const ok = { available: true as const, host: 'h', project: 'p', webUrl: 'w', username: 'u' }

  it('keeps the MR while the status is loading or available', () => {
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, undefined, branches)).toEqual({ comparison: { mode: 'mr', iid: 7 }, notice: null })
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, ok, branches)).toEqual({ comparison: { mode: 'mr', iid: 7 }, notice: null })
  })

  it('returns to the branch comparison with the reason when glab is unavailable', () => {
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, { available: false, reason: 'not_gitlab', message: '' }, branches))
      .toEqual({ comparison: branchComparison, notice: '원격 저장소가 GitLab이 아닙니다' })
  })

  it('ignores other modes', () => {
    expect(reconcileMrAvailability(branchComparison, { available: false, reason: 'auth', message: '' }, branches))
      .toEqual({ comparison: branchComparison, notice: null })
  })
})

describe('mrTabAction', () => {
  it('opens MR mode when GitLab is available', () => {
    expect(mrTabAction({ available: true, host: 'h', project: 'p', webUrl: 'w', username: 'u' })).toBe('open')
  })

  it('rechecks the status when GitLab is unavailable so a later glab login takes effect', () => {
    expect(mrTabAction({ available: false, reason: 'auth', message: '' })).toBe('recheck')
  })

  it('does nothing while the status is loading', () => {
    expect(mrTabAction(undefined)).toBe('none')
  })
})

describe('mrNotFoundReset', () => {
  it('clears the MR selection only when GitLab has no such MR', () => {
    expect(mrNotFoundReset({ mode: 'mr', iid: 100 }, 'mr_not_found')).toEqual({ comparison: { mode: 'mr', iid: null }, notice: 'MR !100을 찾지 못했습니다' })
    expect(mrNotFoundReset({ mode: 'mr', iid: 100 }, 'api')).toBeNull()
    expect(mrNotFoundReset({ mode: 'mr', iid: 100 }, null)).toBeNull()
    expect(mrNotFoundReset({ mode: 'mr', iid: null }, 'mr_not_found')).toBeNull()
    expect(mrNotFoundReset({ mode: 'branch', source: 'a', target: 'b' }, 'mr_not_found')).toBeNull()
  })
})

describe('mrStateBadge', () => {
  it('labels merged and closed MRs only', () => {
    expect(mrStateBadge('merged')).toBe('머지됨')
    expect(mrStateBadge('closed')).toBe('닫힘')
    expect(mrStateBadge('opened')).toBeNull()
  })
})
