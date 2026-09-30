import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeRepo, commit, git } from './gitRepo'

// 원격 저장소의 MR 커밋은 refs/merge-requests/7/head로만 가리키고 브랜치가 없어서 clone에는 들어오지 않는다.
export function makeMrRepo() {
  const remote = makeRepo()
  const base = commit(remote, { 'a.txt': 'one\ntwo\nthree\n' }, 'base')
  git(remote, 'switch', '-q', '-c', 'feature')
  const head = commit(remote, { 'a.txt': 'one\nTWO\nthree\n', 'b.png': 'NEWPNG' }, 'feature')
  git(remote, 'update-ref', 'refs/merge-requests/7/head', head)
  git(remote, 'switch', '-q', 'main')
  git(remote, 'branch', '-q', '-D', 'feature')
  const local = realpathSync(mkdtempSync(join(tmpdir(), 'diffx-clone-')))
  git(local, 'clone', '-q', '--no-local', remote, '.')
  return { remote, local, base, head }
}

export function apiMr(iid: number, base: string, head: string, targetBranch = 'main') {
  return {
    iid,
    title: '로그인 수정',
    state: 'opened',
    source_branch: 'feature',
    target_branch: targetBranch,
    author: { name: '김개발' },
    web_url: `https://gitlab.example.com/team/app/-/merge_requests/${iid}`,
    updated_at: '2026-09-30T00:00:00Z',
    diff_refs: { base_sha: base, start_sha: base, head_sha: head },
  }
}

export function pushMrCommit(remote: string, iid: number, parent: string, files: Record<string, string>): string {
  git(remote, 'switch', '-q', '--detach', parent)
  const sha = commit(remote, files, `mr ${iid}`)
  git(remote, 'update-ref', `refs/merge-requests/${iid}/head`, sha)
  git(remote, 'switch', '-q', 'main')
  return sha
}
