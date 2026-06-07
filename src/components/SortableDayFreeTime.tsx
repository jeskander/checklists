import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { freeTimelineDragId } from '../lib/dayTimelineLayout'
import { formatTime24h } from '../lib/scheduleTime'
import type { TimeGap } from '../lib/dayTimeline'
import { DayTimeGap } from './DayTimeGap'

type Props = {
  freeId: string
  gap: TimeGap
  variant?: 'default' | 'split'
  onSlotClick?: () => void
  fillHeight?: boolean
}

export function SortableDayFreeTime({ freeId, gap, variant = 'default', onSlotClick, fillHeight }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: freeTimelineDragId(freeId),
  })
  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  const wrapClass = [
    'sortable-day-wrap sortable-day-wrap--gap',
    variant === 'split' ? 'sortable-day-wrap--split-gap' : '',
    fillHeight ? 'sortable-day-wrap--split-fill' : '',
    isDragging ? 'sortable-day-wrap--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const handle = (
    <button
      type="button"
      className="day-drag day-drag--handle"
      {...attributes}
      {...listeners}
      aria-label="Move free time"
    >
      ⋮⋮
    </button>
  )

  if (variant === 'split') {
    return (
      <div ref={setNodeRef} style={style} className={wrapClass}>
        {handle}
        <div className="sortable-day-card sortable-day-card--gap">
          <DayTimeGap gap={gap} fillHeight={fillHeight} />
        </div>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style} className={wrapClass}>
      {handle}
      <button
        type="button"
        className="sortable-day-card sortable-day-card--gap"
        onClick={(e) => {
          e.stopPropagation()
          onSlotClick?.()
        }}
        aria-label={`Add block at ${formatTime24h(new Date(gap.startMs))}`}
      >
        <DayTimeGap gap={gap} />
      </button>
    </div>
  )
}
