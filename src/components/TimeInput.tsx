import { applyTimeOnDate, msToTimeInputValue } from '../lib/scheduleTime'
import { HhMmField } from './HhMmField'

type Props = {
  dayDate: string
  scheduledStartMs: number
  onChange: (ms: number) => void
  className?: string
  autoFocus?: boolean
  ariaLabel?: string
}

export function TimeInput({
  dayDate,
  scheduledStartMs,
  onChange,
  className,
  autoFocus,
  ariaLabel = 'Start time (24-hour)',
}: Props) {
  return (
    <HhMmField
      autoFocus={autoFocus}
      className={className}
      value={msToTimeInputValue(scheduledStartMs)}
      aria-label={ariaLabel}
      onChange={(value) => onChange(applyTimeOnDate(dayDate, value))}
    />
  )
}
