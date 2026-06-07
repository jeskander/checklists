import { minutesToDurationValue, parseDurationInput } from '../lib/duration'
import { HhMmField } from './HhMmField'
import './DurationInput.css'

type Props = {
  minutes: number
  onChange: (minutes: number) => void
  className?: string
  id?: string
  autoFocus?: boolean
}

export function DurationInput({ minutes, onChange, className, id, autoFocus }: Props) {
  return (
    <HhMmField
      id={id}
      autoFocus={autoFocus}
      className={className ? `${className} duration-input` : 'duration-input'}
      value={minutesToDurationValue(minutes)}
      hoursMax={24}
      aria-label="Duration (hours and minutes)"
      onChange={(value) => onChange(parseDurationInput(value, minutes))}
    />
  )
}
