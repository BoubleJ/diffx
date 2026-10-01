import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { conversationLabel, formatLastAt, type ConversationItem } from '../reviewConversations'

interface ConversationRowsProps {
  items: ConversationItem[]
  currentKey: string | null
  onOpen: (key: string) => void
  onDelete: (key: string) => void
}

export function ConversationRows({ items, currentKey, onOpen, onDelete }: ConversationRowsProps) {
  if (items.length === 0) return <div className="conv-empty">저장된 대화가 없습니다</div>
  return (
    <ul className="conv-list">
      {items.map((item) => (
        <li key={item.key} className={`conv-item${item.key === currentKey ? ' conv-item-current' : ''}`}>
          <button type="button" className="conv-open" onClick={() => onOpen(item.key)}>
            <span className="conv-label">{conversationLabel(item.key)}</span>
            <span className="conv-meta">질문 {item.questionCount}개 · {formatLastAt(item.lastAt)}</span>
          </button>
          <button type="button" className="btn btn-sm" disabled={item.running} onClick={() => onDelete(item.key)}>삭제</button>
        </li>
      ))}
    </ul>
  )
}

export function ConversationList({ active, currentKey, onOpen }: { active: boolean; currentKey: string | null; onOpen: (key: string) => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data, isError } = useQuery({
    queryKey: ['review', 'conversations'],
    queryFn: async (): Promise<ConversationItem[]> => {
      const res = await fetch('/api/review/conversations')
      if (!res.ok) throw new Error(`대화 목록 응답 ${res.status}`)
      return res.json()
    },
    enabled: active,
  })

  const remove = async (key: string) => {
    if (!window.confirm('이 대화의 모든 질문과 답변을 삭제할까요?')) return
    setError(null)
    try {
      const res = await fetch(`/api/review/conversation?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (res.status === 409) setError('답변을 만드는 중인 대화는 삭제할 수 없습니다')
    } catch {}
    queryClient.invalidateQueries({ queryKey: ['review'] })
  }

  return (
    <div className="conv-panel">
      {error && <div className="conv-error">{error}</div>}
      {isError ? (
        <div className="conv-empty">대화 목록을 불러오지 못했습니다</div>
      ) : (
        data && <ConversationRows items={data} currentKey={currentKey} onOpen={onOpen} onDelete={remove} />
      )}
    </div>
  )
}
