import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Sparkles } from 'lucide-react'
import { MAX_SELECTION_CHARS, type CodeSelection } from '../../review/types'
import { formatSelectionLocation, lineInfoFrom, selectedLines, sideLabel, trimSelectedCode } from '../selection'

interface Picked {
  selection: CodeSelection
  top: number
  right: number
}

type ShadowWithSelection = ShadowRoot & { getSelection?: () => Selection | null }

function pickSelection(event: MouseEvent): Picked | null {
  const path = event.composedPath()
  const card = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains('file-diff-card'))
  const host = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.shadowRoot !== null)
  if (!card || !card.id.startsWith('file-') || !host?.shadowRoot) return null
  const root = host.shadowRoot as ShadowWithSelection
  const sel = root.getSelection?.()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  if (!sel.anchorNode || !sel.focusNode || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null
  const code = trimSelectedCode(sel.toString())
  if (!code.trim()) return null
  const start = lineInfoFrom(sel.anchorNode)
  const end = lineInfoFrom(sel.focusNode)
  if (!start || !end) return null
  const lines = selectedLines(start, end)
  if (!lines) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  return { selection: { path: card.id.slice('file-'.length), ...lines, code }, top: rect.bottom + 4, right: rect.right }
}

export function SelectionAsk({ disabled, resetKey, onAsk }: { disabled: boolean; resetKey: string | null; onAsk: (question: string, selection: CodeSelection) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setPicked(null)
    setOpen(false)
    setText('')
  }

  useEffect(close, [resetKey])

  useEffect(() => {
    const inside = (target: EventTarget | null) => !!boxRef.current && target instanceof Node && boxRef.current.contains(target)
    const handleMouseDown = (e: MouseEvent) => {
      if (!inside(e.target)) close()
    }
    const handleMouseUp = (e: MouseEvent) => {
      if (inside(e.target)) return
      const next = pickSelection(e)
      setPicked(next)
      setOpen(false)
      setText('')
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const handleScroll = (e: Event) => {
      if (!inside(e.target)) close()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  if (!picked) return null
  const { selection } = picked
  const tooLong = selection.code.length > MAX_SELECTION_CHARS
  const canSend = !disabled && !tooLong && text.trim().length > 0
  const width = open ? 420 : 140
  const style = { top: picked.top, left: Math.max(8, Math.min(picked.right - width, window.innerWidth - width - 8)) }

  const send = () => {
    if (!canSend) return
    onAsk(text.trim(), selection)
    close()
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div ref={boxRef} className="sel-ask" style={style}>
      {open ? (
        <div className="sel-ask-popup">
          <div className="sel-ask-location">{formatSelectionLocation(selection)} ({sideLabel(selection.side)})</div>
          {tooLong && <div className="sel-ask-error">선택한 코드가 너무 깁니다 (4000자까지)</div>}
          <div className="sel-ask-row">
            <textarea
              className="sel-ask-input"
              autoFocus
              rows={1}
              maxLength={2000}
              value={text}
              placeholder="선택한 코드에 대해 질문하기"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="sel-ask-send" aria-label="보내기" disabled={!canSend} onClick={send}>
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-sm sel-ask-button"
          disabled={disabled}
          title={disabled ? '진행 중인 질문이 끝난 뒤 다시 보내 주세요' : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
        >
          <Sparkles size={14} />
          AI에게 질문
        </button>
      )}
    </div>
  )
}
