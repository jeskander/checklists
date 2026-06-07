import { useSortable } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { DayInstance, DayInstanceItem } from '../db/types'
import {
  sideLeftDropId,
  sideRightDropId,
  stackBelowDropId,
} from '../lib/dayTimelineLayout'
import { DayInstanceTile } from './DayInstanceTile'

type Props = {
  instance: DayInstance
  items: DayInstanceItem[]
  variant?: 'default' | 'split'
  minHeightPx?: number
  heightPx?: number
  fillHeight?: boolean
  dropHint: { targetId: string; side: 'left' | 'right' } | null
  stackHintId: string | null
  onOpen: () => void
  onDelete: () => void
}

export function SortableDayTileInner({
  instance,
  items,
  variant = 'default',
  minHeightPx,
  heightPx,
  fillHeight,
  dropHint,
  stackHintId,
  onOpen,
  onDelete,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instance.id,
  })
  const { setNodeRef: setLeftRef, isOver: isOverLeft } = useDroppable({
    id: sideLeftDropId(instance.id),
  })
  const { setNodeRef: setRightRef, isOver: isOverRight } = useDroppable({
    id: sideRightDropId(instance.id),
  })
  const { setNodeRef: setStackRef, isOver: isOverStack } = useDroppable({
    id: stackBelowDropId(instance.id),
  })

  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  }
  const hintLeft = dropHint?.targetId === instance.id && dropHint.side === 'left'
  const hintRight = dropHint?.targetId === instance.id && dropHint.side === 'right'
  const hintStack = stackHintId === instance.id || isOverStack
  const sizeStyle = fillHeight
    ? undefined
    : heightPx != null
      ? { height: `${heightPx}px`, minHeight: `${heightPx}px` }
      : minHeightPx
        ? { minHeight: `${minHeightPx}px` }
        : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'sortable-day-wrap',
        variant === 'split' ? 'sortable-day-wrap--split' : '',
        fillHeight ? 'sortable-day-wrap--split-fill' : '',
        isDragging ? 'sortable-day-wrap--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="day-drag day-drag--handle"
        {...attributes}
        {...listeners}
        aria-label="Move block"
      >
        ⋮⋮
      </button>
      <div
        className={[
          'sortable-day-card',
          hintLeft ? 'sortable-day-card--drop-left' : '',
          hintRight ? 'sortable-day-card--drop-right' : '',
          hintStack ? 'sortable-day-card--drop-stack' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={sizeStyle}
      >
        <div className="day-tile-side-zones" aria-hidden="true">
          <div
            ref={setLeftRef}
            className={['day-tile-side-zone day-tile-side-zone--left', isOverLeft || hintLeft ? 'day-tile-side-zone--active' : '']
              .filter(Boolean)
              .join(' ')}
          />
          <div
            ref={setRightRef}
            className={['day-tile-side-zone day-tile-side-zone--right', isOverRight || hintRight ? 'day-tile-side-zone--active' : '']
              .filter(Boolean)
              .join(' ')}
          />
        </div>
        <div
          ref={setStackRef}
          className={['day-tile-stack-zone', hintStack ? 'day-tile-stack-zone--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />
        <DayInstanceTile
          instance={instance}
          items={items}
          variant={variant}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
