import type { ReactNode } from 'react'

interface SidePanelProps {
  tab: 'review' | 'explore'
  onTabChange: (tab: 'review' | 'explore') => void
  review: ReactNode
  explore: ReactNode
}

export function SidePanel({ tab, onTabChange, review, explore }: SidePanelProps) {
  return (
    <div className="side-panel">
      <div className="toolbar-toggle side-panel-tabs">
        <button className={`btn btn-sm ${tab === 'review' ? 'btn-active' : ''}`} onClick={() => onTabChange('review')}>AI 리뷰</button>
        <button className={`btn btn-sm ${tab === 'explore' ? 'btn-active' : ''}`} onClick={() => onTabChange('explore')}>코드 탐색</button>
      </div>
      <div className="side-panel-body" style={{ display: tab === 'review' ? 'flex' : 'none' }}>{review}</div>
      <div className="side-panel-body" style={{ display: tab === 'explore' ? 'flex' : 'none' }}>{explore}</div>
    </div>
  )
}
