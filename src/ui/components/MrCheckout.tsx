import { useEffect, useState, type ReactNode } from 'react'
import { Check, GitCommitHorizontal, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { useReviewWorktree } from '../hooks/useReviewWorktree'
import { checkoutOutcome, checkoutState } from '../reviewWorktree'

type Busy = 'checkout' | 'terminal' | 'delete' | null
type Popover = { kind: 'dirty' | 'delete'; files: string[] } | null

function FileList({ files }: { files: string[] }) {
  if (files.length === 0) return null
  return (
    <ul className="mr-checkout-files">
      {files.map((file) => <li key={file}>{file}</li>)}
    </ul>
  )
}

export function MrCheckout({ iid, headSha, onReloadDiff }: { iid: number; headSha: string; onReloadDiff: () => void }) {
  const { worktree, error: statusError, checkout, openTerminal, listChanges, remove } = useReviewWorktree()
  const [busy, setBusy] = useState<Busy>(null)
  const [popover, setPopover] = useState<Popover>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setPopover(null)
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doCheckout = (force: boolean) => run('checkout', async () => {
    setPopover(null)
    const result = await checkout(iid, force)
    if (result.kind === 'dirty') {
      setPopover({ kind: 'dirty', files: result.files })
      return
    }
    const outcome = checkoutOutcome(result, headSha)
    setNotice(outcome.notice)
    if (outcome.reloadDiff) onReloadDiff()
  })
  const askRemove = () => run('delete', async () => setPopover({ kind: 'delete', files: await listChanges() }))
  const doRemove = () => run('delete', async () => {
    await remove()
    setPopover(null)
  })

  const state = checkoutState(worktree, headSha)
  if (state === 'loading') {
    return statusError ? <div className="mr-checkout"><span className="mr-checkout-danger">{statusError}</span></div> : null
  }
  const path = worktree?.exists ? worktree.path : undefined
  const icon = (kind: Busy, idle: ReactNode) => (busy === kind ? <RefreshCw size={14} className="spin" /> : idle)

  return (
    <div className="mr-checkout">
      {state === 'current' ? (
        <span className="mr-checkout-done" title={path}><Check size={14} /> 체크아웃됨</span>
      ) : (
        <button className="btn btn-sm" onClick={() => void doCheckout(false)} disabled={busy !== null}>
          {icon('checkout', <GitCommitHorizontal size={14} />)} 체크아웃
        </button>
      )}
      {state !== 'none' && (
        <>
          <button className="btn btn-sm" title={path} onClick={() => void run('terminal', openTerminal)} disabled={busy !== null}>
            {icon('terminal', <Terminal size={14} />)} 터미널에서 열기
          </button>
          <button className="btn btn-sm" onClick={() => void askRemove()} disabled={busy !== null}>
            {icon('delete', <Trash2 size={14} />)} worktree 삭제
          </button>
        </>
      )}
      {popover?.kind === 'dirty' && (
        <div className="mr-checkout-popover">
          <p>리뷰용 worktree에 커밋하지 않은 변경사항이 있습니다</p>
          <FileList files={popover.files} />
          <div className="mr-checkout-actions">
            <button className="btn btn-sm mr-checkout-danger" onClick={() => void doCheckout(true)} disabled={busy !== null}>변경사항을 버리고 체크아웃</button>
            <button className="btn btn-sm" onClick={() => setPopover(null)} disabled={busy !== null}>취소</button>
          </div>
        </div>
      )}
      {popover?.kind === 'delete' && (
        <div className="mr-checkout-popover">
          <p>리뷰용 worktree를 삭제합니다. 이 폴더에서 실행 중인 개발서버가 있으면 먼저 종료해 주세요</p>
          <FileList files={popover.files} />
          <div className="mr-checkout-actions">
            <button className="btn btn-sm mr-checkout-danger" onClick={() => void doRemove()} disabled={busy !== null}>삭제</button>
            <button className="btn btn-sm" onClick={() => setPopover(null)} disabled={busy !== null}>취소</button>
          </div>
        </div>
      )}
      {notice && <div className="mr-checkout-message">{notice}</div>}
      {error && <div className="mr-checkout-message mr-checkout-error">{error}</div>}
    </div>
  )
}
