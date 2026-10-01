import { Fragment, memo, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { questionToRefill, type MessageKind, type ProviderInfo, type ReviewLocation, type ReviewMessage, type ReviewState } from '../hooks/useReview'
import { AnswerMarkdown } from './AnswerMarkdown'
import { LocationItem } from './LocationItem'

interface ReviewPanelProps {
  provider: ProviderInfo | undefined
  messages: ReviewMessage[]
  state: ReviewState
  onAsk: (question: string) => void
  onReview: () => void
  onCancel: () => void
  onRemove: (id: string) => void
  onNewConversation: () => void
  onOpenLocation: (l: ReviewLocation) => void
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return <>{`${Math.floor(s / 60)}분 ${s % 60}초`}</>
}

function errorText(state: Extract<ReviewState, { status: 'error' }>, provider: ProviderInfo | undefined) {
  if (state.kind === 'not_installed') return `${provider?.label ?? 'Claude Code'}가 설치돼 있지 않습니다`
  return state.message
}

function QuestionCard({ kind, question, excluded, onRemove }: { kind: MessageKind; question: string | null; excluded?: string[]; onRemove?: () => void }) {
  return (
    <div className="review-question">
      <div className="review-question-text">{kind === 'review' ? '전체 리뷰' : question}</div>
      {excluded && excluded.length > 0 && <div className="review-panel-meta">제외한 파일 {excluded.length}개를 빼고 리뷰</div>}
      {onRemove && (
        <button className="review-question-remove" onClick={onRemove} title="삭제" aria-label="삭제">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

const AnswerCard = memo(function AnswerCard({ message, onOpenLocation }: { message: ReviewMessage; onOpenLocation: (l: ReviewLocation) => void }) {
  const { answer, locations } = message.result
  return (
    <div className="review-answer">
      <AnswerMarkdown text={answer} />
      {locations.length > 0 && (
        <>
          <div className="review-panel-count">관련 위치 {locations.length}건</div>
          {locations.map((l, i) => (
            <LocationItem key={`${l.file}:${l.line}:${i}`} location={l} onOpen={onOpenLocation} />
          ))}
        </>
      )}
      <div className="review-panel-meta">{new Date(message.createdAt).toLocaleString()}</div>
      {message.stale && <div className="review-panel-stale">이 답변 이후 코드가 바뀌었습니다</div>}
    </div>
  )
})

export function ReviewPanel(props: ReviewPanelProps) {
  const { provider, messages, state, onAsk, onReview, onCancel, onRemove, onNewConversation, onOpenLocation } = props
  const [input, setInput] = useState('')
  const inputRef = useRef(input)
  inputRef.current = input
  const listRef = useRef<HTMLDivElement>(null)
  const running = state.status === 'running'
  const installed = provider?.installed === true
  const canSend = installed && !running

  useEffect(() => {
    const text = questionToRefill(state, inputRef.current)
    if (text !== null) setInput(text)
  }, [state])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.at(-1)?.id, state.status])

  const send = () => {
    const question = input.trim()
    if (!question || !canSend) return
    setInput('')
    onAsk(question)
  }

  const confirmNewConversation = () => {
    if (window.confirm('이 비교의 모든 질문과 답변을 삭제할까요?')) onNewConversation()
  }

  const pending = state.status === 'idle' ? null : state.pending

  return (
    <div className="review-panel">
      <div className="review-panel-header">
        <span className="review-panel-title">AI 리뷰</span>
        <button className="btn btn-sm" onClick={confirmNewConversation} disabled={running || messages.length === 0}>대화 삭제</button>
      </div>

      <div className="review-panel-list" ref={listRef}>
        {messages.map((m) => (
          <Fragment key={m.id}>
            <QuestionCard kind={m.kind} question={m.question} excluded={m.excluded} onRemove={() => onRemove(m.id)} />
            <AnswerCard message={m} onOpenLocation={onOpenLocation} />
          </Fragment>
        ))}
        {pending && <QuestionCard kind={pending.kind} question={pending.question} excluded={pending.excluded} />}
        {state.status === 'running' && (
          <div className="review-panel-status">
            <div>{state.progress ?? '답변을 준비하는 중'}</div>
            <div className="review-panel-elapsed">경과 시간 <Elapsed startedAt={state.startedAt} /></div>
          </div>
        )}
        {state.status === 'error' && (
          <div className="review-panel-error">
            <div>{errorText(state, provider)}</div>
            {state.rawOutput && <pre className="review-panel-raw">{state.rawOutput}</pre>}
          </div>
        )}
      </div>

      <div className="review-panel-composer">
        <textarea
          className="review-panel-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="질문을 입력하세요 (Cmd+Enter로 보내기)"
          rows={3}
          maxLength={2000}
          disabled={!installed}
        />
        {provider && !provider.installed && (
          <a className="review-panel-hint" href={provider.installHint} target="_blank" rel="noreferrer">
            {provider.label} 설치 방법 보기
          </a>
        )}
        <div className="review-panel-controls">
          <span className="review-panel-meta">
            {provider ? `${provider.label}${provider.installed ? '' : ' (설치 안 됨)'}` : 'Claude Code 확인 중'}
          </span>
          {running ? (
            <button className="btn btn-sm" onClick={onCancel}>취소</button>
          ) : (
            <div className="review-panel-actions">
              <button className="btn btn-sm" onClick={onReview} disabled={!canSend}>전체 리뷰</button>
              <button className="btn btn-primary btn-sm" onClick={send} disabled={!canSend || !input.trim()}>보내기</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
