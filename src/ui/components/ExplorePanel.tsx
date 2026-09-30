import { groupByFile, type DefinitionVersion, type ExploreItem, type ExploreState } from '../definition'

interface ExplorePanelProps {
  state: ExploreState
  selected: string | null
  onPick: (item: ExploreItem, version: DefinitionVersion) => void
}

export function ExplorePanel({ state, selected, onPick }: ExplorePanelProps) {
  if (state.status === 'idle') {
    return <div className="explore-panel"><p className="explore-panel-hint">정의 자리나 파일 경로를 Cmd+클릭하면 사용처가 여기에 나옵니다</p></div>
  }
  return (
    <div className="explore-panel">
      <div className="explore-panel-header">
        <span className="explore-panel-title">{state.title}</span>
        {state.status === 'ready' && <span className="explore-panel-count">{state.items.length}곳</span>}
      </div>
      {state.status === 'loading' && <p className="explore-panel-hint">사용처를 찾는 중입니다</p>}
      {state.status === 'error' && <p className="explore-panel-hint">사용처를 찾는 중 오류가 났습니다</p>}
      {state.status === 'ready' && state.items.length === 0 && <p className="explore-panel-hint">사용처를 찾지 못했습니다</p>}
      {state.status === 'ready' && groupByFile(state.items).map((group) => (
        <div key={group.path} className="explore-group">
          <div className="explore-group-path">{group.path}</div>
          {group.items.map((item) => {
            const id = `${item.path}:${item.line}`
            return (
              <button key={id} className={`explore-item ${selected === id ? 'explore-item-selected' : ''}`} onClick={() => onPick(item, state.version)}>
                <span className="explore-item-line">{item.line}</span>
                <span className="explore-item-text">{item.text?.trim() ?? ''}</span>
              </button>
            )
          })}
        </div>
      ))}
      {state.status === 'ready' && state.truncated && <p className="explore-panel-hint">200곳까지만 표시합니다</p>}
    </div>
  )
}
