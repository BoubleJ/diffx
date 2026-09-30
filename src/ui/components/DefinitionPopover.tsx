import { useEffect, useRef } from 'react'
import type { DefinitionTarget } from '../definition'

export type PopoverContent =
  | { type: 'choose'; targets: DefinitionTarget[]; onPick: (target: DefinitionTarget) => void }
  | { type: 'message'; text: string }

interface DefinitionPopoverProps {
  anchor: DOMRect
  content: PopoverContent
  onClose: () => void
}

export function DefinitionPopover({ anchor, content, onClose }: DefinitionPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (content.type === 'message') {
      const timer = setTimeout(onClose, 2000)
      return () => clearTimeout(timer)
    }
    const handleMouse = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouse)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouse)
      document.removeEventListener('keydown', handleKey)
    }
  }, [content, onClose])

  return (
    <div className="definition-popover" ref={rootRef} style={{ top: anchor.bottom + 4, left: anchor.left }}>
      {content.type === 'message' ? (
        <div className="definition-popover-message">{content.text}</div>
      ) : (
        content.targets.map((t) => (
          <button key={`${t.path}:${t.line}`} className="definition-popover-item" onClick={() => content.onPick(t)}>
            {t.path}:{t.line}
          </button>
        ))
      )}
    </div>
  )
}
