import type { ReactNode } from 'react'
import type { ReviewPanelTab } from '../reviewPanelStorage'

interface SidePanelProps {
  tab: ReviewPanelTab
  onTabChange: (tab: ReviewPanelTab) => void
  review: ReactNode
  explore: ReactNode
  conversations: ReactNode
}

export function SidePanel({ tab, onTabChange, review, explore, conversations }: SidePanelProps) {
  return (
    <div className="side-panel">
      <div className="toolbar-toggle side-panel-tabs">
        <button className={`btn btn-sm ${tab === 'review' ? 'btn-active' : ''}`} onClick={() => onTabChange('review')}>AI 리뷰</button>
        <button className={`btn btn-sm ${tab === 'explore' ? 'btn-active' : ''}`} onClick={() => onTabChange('explore')}>코드 탐색</button>
        <button className={`btn btn-sm ${tab === 'conversations' ? 'btn-active' : ''}`} onClick={() => onTabChange('conversations')}>대화 목록</button>
      </div>
      <div className="side-panel-body" style={{ display: tab === 'review' ? 'flex' : 'none' }}>{review}</div>
      <div className="side-panel-body" style={{ display: tab === 'explore' ? 'flex' : 'none' }}>{explore}</div>
      <div className="side-panel-body" style={{ display: tab === 'conversations' ? 'flex' : 'none' }}>{conversations}</div>
    </div>
  )
}
