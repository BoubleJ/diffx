import { useEffect } from 'react'

export type PopoverContent = { type: 'message'; text: string }

interface DefinitionPopoverProps {
  anchor: DOMRect
  content: PopoverContent
  onClose: () => void
}

export function DefinitionPopover({ anchor, content, onClose }: DefinitionPopoverProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2000)
    return () => clearTimeout(timer)
  }, [content, onClose])

  return (
    <div className="definition-popover" style={{ top: anchor.bottom + 4, left: anchor.left }}>
      <div className="definition-popover-message">{content.text}</div>
    </div>
  )
}
