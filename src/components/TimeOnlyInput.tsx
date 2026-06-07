import { HhMmField } from './HhMmField'

type Props = {
  timeHHMM: string
  onChange: (timeHHMM: string) => void
  className?: string
}

export function TimeOnlyInput({ timeHHMM, onChange, className }: Props) {
  return (
    <HhMmField
      className={className}
      value={timeHHMM}
      aria-label="Repeat time (24-hour)"
      onChange={onChange}
    />
  )
}
