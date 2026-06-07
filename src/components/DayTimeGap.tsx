import type { TimeGap } from '../lib/dayTimeline'
import { formatGapLabel, gapHeightPx } from '../lib/dayTimeline'
import './DayTimeGap.css'

type Props = {
  gap: TimeGap
  fillHeight?: boolean
}

export function DayTimeGap({ gap, fillHeight }: Props) {
  return (
    <div
      className={['day-time-gap', fillHeight ? 'day-time-gap--fill' : ''].filter(Boolean).join(' ')}
      style={fillHeight ? undefined : { minHeight: `${gapHeightPx(gap.minutes)}px` }}
      aria-label={formatGapLabel(gap)}
    >
      <span className="day-time-gap-label">{formatGapLabel(gap)}</span>
    </div>
  )
}
