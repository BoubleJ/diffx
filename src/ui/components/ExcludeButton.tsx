import { EyeOff } from 'lucide-react'

export function ExcludeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="exclude-btn"
      title="제외"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <EyeOff size={14} />
      제외
    </button>
  )
}
