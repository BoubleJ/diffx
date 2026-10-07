import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { File as CodeFile } from '@pierre/diffs/react'
import { findLineElement } from '../findLine'
import { isSourceFile } from '../../definition/sourceFiles'
import type { DefinitionRequest, DefinitionVersion } from '../definition'
import { tokenLinkHover } from '../tokenLinkHover'

interface OverlayEntry {
  path: string
  line: number
  version: DefinitionVersion
}

interface FileViewerOverlayProps {
  entries: OverlayEntry[]
  contentQuery: string
  leftInset: number
  rightInset: number
  onBack: () => void
  onClose: () => void
  onDefinition: (req: DefinitionRequest, anchor: DOMRect) => void
  onFileReferences: (path: string, side: 'additions' | 'deletions') => void
}

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; contents: string }

export function FileViewerOverlay({ entries, contentQuery, leftInset, rightInset, onBack, onClose, onDefinition, onFileReferences }: FileViewerOverlayProps) {
  const current = entries[entries.length - 1]
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    const q = new URLSearchParams(contentQuery)
    q.set('path', current.path)
    q.set('version', current.version)
    fetch(`/api/file-content?${q}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((contents) => { if (!cancelled) setState({ status: 'ready', contents }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [current.path, current.version, contentQuery])

  useEffect(() => {
    if (state.status !== 'ready' || current.line < 1) return
    let frames = 0
    let handle = 0
    const tryScroll = () => {
      const el = bodyRef.current && findLineElement(bodyRef.current, current.line, 'additions')
      if (el) {
        el.scrollIntoView({ block: 'center' })
        return
      }
      if (frames++ < 60) handle = requestAnimationFrame(tryScroll)
    }
    handle = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(handle)
  }, [state, current.line])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const side = current.version === 'new' ? 'additions' : 'deletions'
  const linkable = isSourceFile(current.path)

  return (
    <div className="file-overlay-backdrop" style={{ left: leftInset, right: rightInset }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="file-overlay">
        <div className="file-overlay-header">
          <span
            className="file-overlay-path"
            onClick={(e) => { if (linkable && e.metaKey) onFileReferences(current.path, side) }}
            onPointerOver={(e) => { if (linkable) tokenLinkHover.enter(e.currentTarget, e.metaKey) }}
            onPointerOut={() => tokenLinkHover.leave()}
          >
            {current.path}
          </span>
          <span className="file-overlay-version">{current.version === 'new' ? '소스' : '기준'}</span>
          <button className="btn btn-sm" onClick={onBack} disabled={entries.length <= 1} title="뒤로">
            <ArrowLeft size={14} /> 뒤로
          </button>
          <button className="btn btn-sm" onClick={onClose} title="닫기">
            <X size={14} />
          </button>
        </div>
        <div className="file-overlay-body" ref={bodyRef}>
          {state.status === 'loading' && <div className="empty-state"><p>Loading...</p></div>}
          {state.status === 'error' && <div className="empty-state"><p>파일을 읽지 못했습니다</p></div>}
          {state.status === 'ready' && (
            <CodeFile
              file={{ name: current.path, contents: state.contents }}
              selectedLines={current.line > 0 ? { start: current.line, end: current.line } : null}
              options={{
                disableFileHeader: true,
                theme: { dark: 'github-dark', light: 'github-light' },
                themeType: 'system',
                overflow: 'scroll',
                ...(linkable ? {
                  useTokenTransformer: true,
                  onTokenEnter: (props, event) => tokenLinkHover.enter(props.tokenElement, event.metaKey),
                  onTokenLeave: () => tokenLinkHover.leave(),
                  onTokenClick: (props, event) => {
                    if (!event.metaKey) return
                    event.preventDefault()
                    onDefinition({ path: current.path, side, line: props.lineNumber, col: props.lineCharStart, name: props.tokenElement.textContent ?? '' }, props.tokenElement.getBoundingClientRect())
                  },
                } : {}),
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
