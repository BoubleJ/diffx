import type { ReviewLocation } from '../hooks/useReview'

export function LocationItem({ location, onOpen }: { location: ReviewLocation; onOpen: (l: ReviewLocation) => void }) {
  return (
    <div className="location-item">
      <div className="location-section">
        <div className="location-label">파일 위치</div>
        <div className="location-file-row">
          <span className="location-path">
            {location.file}
            {location.line === null ? ' (파일 전체)' : `:${location.line}`}
          </span>
          <button className="btn btn-sm" onClick={() => onOpen(location)}>코드 보기</button>
        </div>
      </div>
      <div className="location-section">
        <div className="location-label">요약</div>
        <div className="location-title">{location.title}</div>
      </div>
      <div className="location-section">
        <div className="location-label">내용</div>
        <div className="location-body">{location.body}</div>
      </div>
    </div>
  )
}
