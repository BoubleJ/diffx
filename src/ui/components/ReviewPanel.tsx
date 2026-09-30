import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { Finding, ProviderInfo, ReviewRecord, ReviewState } from '../hooks/useReview'
import { FindingItem } from './FindingItem'

const SEVERITY_ORDER: Record<Finding['severity'], number> = { critical: 0, major: 1, minor: 2, info: 3 }

interface ReviewPanelProps {
  provider: ProviderInfo | undefined
  record: ReviewRecord | null
  stale: boolean
  state: ReviewState
  instruction: string
  onInstructionChange: (value: string) => void
  onStart: () => void
  onCancel: () => void
  onFindingClick: (f: Finding) => void
  onClose: () => void
}

function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (startedAt === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  if (startedAt === null) return ''
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(s / 60)}분 ${s % 60}초`
}

function errorText(state: Extract<ReviewState, { status: 'error' }>, provider: ProviderInfo | undefined) {
  if (state.kind === 'not_installed') return `${provider?.label ?? 'Claude Code'}가 설치돼 있지 않습니다`
  return state.message
}

export function ReviewPanel(props: ReviewPanelProps) {
  const { provider, record, stale, state, instruction, onInstructionChange, onStart, onCancel, onFindingClick, onClose } = props
  const elapsed = useElapsed(state.status === 'running' ? state.startedAt : null)
  const findings = useMemo(
    () => [...(record?.result.findings ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [record],
  )
  const running = state.status === 'running'

  return (
    <div className="review-panel">
      <div className="review-panel-header">
        <span className="review-panel-title">AI 리뷰</span>
        <button className="btn btn-sm" onClick={onClose} title="닫기">
          <X size={14} />
        </button>
      </div>

      <textarea
        className="review-panel-instruction"
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        placeholder="리뷰 방향을 적어 주세요 (예: 성능 문제 위주로 봐줘)"
        rows={3}
        maxLength={2000}
        disabled={running}
      />

      <div className="review-panel-controls">
        <span className="review-panel-meta">
          {provider ? `${provider.label}${provider.installed ? '' : ' (설치 안 됨)'}` : 'Claude Code 확인 중'}
        </span>
        {running ? (
          <button className="btn btn-sm" onClick={onCancel}>취소</button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onStart} disabled={!provider?.installed}>
            {record ? '다시 리뷰' : '리뷰 요청'}
          </button>
        )}
      </div>
      {provider && !provider.installed && (
        <a className="review-panel-hint" href={provider.installHint} target="_blank" rel="noreferrer">
          {provider.label} 설치 방법 보기
        </a>
      )}

      {running && (
        <div className="review-panel-status">
          <div>{state.progress ?? '리뷰를 준비하는 중'}</div>
          <div className="review-panel-elapsed">경과 시간 {elapsed}</div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="review-panel-error">
          <div>{errorText(state, provider)}</div>
          {state.rawOutput && <pre className="review-panel-raw">{state.rawOutput}</pre>}
        </div>
      )}

      {record && !running && (
        <div className="review-panel-result">
          <div className="review-panel-meta">{record.providerLabel}로 리뷰</div>
          <div className="review-panel-meta">{new Date(record.createdAt).toLocaleString()}</div>
          {record.excluded && record.excluded.length > 0 && (
            <div className="review-panel-meta">제외한 파일 {record.excluded.length}개를 빼고 리뷰</div>
          )}
          {record.instruction && <div className="review-panel-meta review-panel-instruction-used">추가 지시: {record.instruction}</div>}
          {stale && <div className="review-panel-stale">리뷰 이후 코드가 바뀌었습니다</div>}
          <p className="review-panel-summary">{record.result.summary}</p>
          <div className="review-panel-count">지적 사항 {findings.length}건</div>
          {findings.map((f, i) => (
            <FindingItem key={`${f.file}:${f.line}:${i}`} finding={f} onClick={onFindingClick} />
          ))}
        </div>
      )}
    </div>
  )
}
