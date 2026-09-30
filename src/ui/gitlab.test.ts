import { describe, it, expect } from 'vitest'
import { gitlabUnavailableMessage, reconcileMrAvailability, mrTabAction } from './gitlab'

describe('gitlabUnavailableMessage', () => {
  it('explains each reason', () => {
    expect(gitlabUnavailableMessage({ available: false, reason: 'not_installed', message: '' })).toBe('glab이 설치되어 있지 않습니다 (brew install glab)')
    expect(gitlabUnavailableMessage({ available: false, reason: 'auth', message: '', host: 'gitlab.mrblue.com' }))
      .toBe('glab 로그인이 필요합니다. 터미널에서 `glab auth login --hostname gitlab.mrblue.com`를 실행해 주세요')
    expect(gitlabUnavailableMessage({ available: false, reason: 'auth', message: '' }))
      .toBe('glab 로그인이 필요합니다. 터미널에서 `glab auth login`를 실행해 주세요')
    expect(gitlabUnavailableMessage({ available: false, reason: 'not_gitlab', message: '' })).toBe('원격 저장소가 GitLab이 아닙니다')
    expect(gitlabUnavailableMessage({ available: false, reason: 'api', message: 'glab: 500' })).toBe('glab: 500')
  })
})

describe('reconcileMrAvailability', () => {
  const ok = { available: true as const, host: 'h', project: 'p', webUrl: 'w', username: 'u' }

  it('keeps the MR while the status is loading or available', () => {
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, undefined)).toEqual({ comparison: { mode: 'mr', iid: 7 }, notice: null })
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, ok)).toEqual({ comparison: { mode: 'mr', iid: 7 }, notice: null })
  })

  it('returns to worktree with the reason when glab is unavailable', () => {
    expect(reconcileMrAvailability({ mode: 'mr', iid: 7 }, { available: false, reason: 'not_gitlab', message: '' }))
      .toEqual({ comparison: { mode: 'worktree' }, notice: '원격 저장소가 GitLab이 아닙니다' })
  })

  it('ignores other modes', () => {
    expect(reconcileMrAvailability({ mode: 'worktree' }, { available: false, reason: 'auth', message: '' }))
      .toEqual({ comparison: { mode: 'worktree' }, notice: null })
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
