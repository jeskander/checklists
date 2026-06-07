import { useEffect, useRef, useState } from 'react'
import { isValidHhMm } from '../lib/scheduleTime'
import './TimeInput.css'

type Props = {
  value: string
  onChange: (value: string) => void
  /** 23 for clock times; up to 99 for long durations */
  hoursMax?: number
  className?: string
  id?: string
  autoFocus?: boolean
  'aria-label'?: string
}

/** Native time field (HH:mm segments) with local draft so typing does not reset mid-edit. */
export function HhMmField({
  value,
  onChange,
  hoursMax = 23,
  className,
  id,
  autoFocus,
  'aria-label': ariaLabel,
}: Props) {
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  const valid = (next: string) => isValidHhMm(next, hoursMax)

  return (
    <input
      id={id}
      type="time"
      autoFocus={autoFocus}
      className={className ? `${className} time-input` : 'time-input'}
      value={draft}
      aria-label={ariaLabel ?? 'Time (hours and minutes)'}
      onFocus={() => {
        focusedRef.current = true
        setDraft(value)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focusedRef.current = false
        if (valid(draft)) onChange(draft)
        else setDraft(value)
      }}
    />
  )
}
