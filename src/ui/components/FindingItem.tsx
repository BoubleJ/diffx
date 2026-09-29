import type { Finding } from '../hooks/useReview'

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  critical: '치명',
  major: '중요',
  minor: '경미',
  info: '참고',
}

export function FindingItem({ finding, onClick }: { finding: Finding; onClick: (f: Finding) => void }) {
  return (
    <button className="finding-item" onClick={() => onClick(finding)}>
      <div className="finding-head">
        <span className={`finding-severity finding-severity-${finding.severity}`}>{SEVERITY_LABEL[finding.severity]}</span>
        <span className="finding-location">
          {finding.file}
          {finding.line !== null && `:${finding.line}`}
        </span>
      </div>
      <div className="finding-title">{finding.title}</div>
      <div className="finding-body">{finding.body}</div>
    </button>
  )
}
