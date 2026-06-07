import type { TaskImportance } from '../db/types'
import './ImportanceInput.css'

type Props = {
  value: TaskImportance
  onChange: (value: TaskImportance) => void
  className?: string
  'aria-label'?: string
}

const LEVELS: TaskImportance[] = [1, 2, 3, 4]

export function ImportanceInput({ value, onChange, className, 'aria-label': ariaLabel }: Props) {
  return (
    <div
      className={className ? `importance-input ${className}` : 'importance-input'}
      role="group"
      aria-label={ariaLabel ?? 'Importance level'}
    >
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          className={`importance-input-btn${value === level ? ' importance-input-btn--active' : ''}`}
          aria-pressed={value === level}
          title={`Importance ${level}${level === 1 ? ' (highest)' : ''}`}
          onClick={() => onChange(level)}
        >
          {level}
        </button>
      ))}
    </div>
  )
}
