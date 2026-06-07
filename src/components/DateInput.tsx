import { useEffect, useRef, useState } from 'react'
import { isValidIsoDate } from '../lib/dateInput'
import './DateInput.css'

type Props = {
  value?: string
  onChange: (value: string | undefined) => void
  className?: string
  'aria-label'?: string
}

export function DateInput({ value, onChange, className, 'aria-label': ariaLabel }: Props) {
  const [draft, setDraft] = useState(value ?? '')
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setDraft(value ?? '')
  }, [value])

  return (
    <div className="date-input">
      <input
        type="date"
        className={className ? `field date-input-field ${className}` : 'field date-input-field'}
        value={draft}
        aria-label={ariaLabel ?? 'Due date (optional)'}
        onFocus={() => {
          focusedRef.current = true
          setDraft(value ?? '')
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focusedRef.current = false
          if (!draft) {
            onChange(undefined)
            setDraft('')
          } else if (isValidIsoDate(draft)) {
            onChange(draft)
          } else {
            setDraft(value ?? '')
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="date-input-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setDraft('')
            onChange(undefined)
          }}
          aria-label="Clear date"
          title="Clear date"
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
