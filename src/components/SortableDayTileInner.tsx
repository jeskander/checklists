import { useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { DayInstance, DayInstanceItem } from '../db/types'
import {
  sideLeftDropId,
  sideRightDropId,
  stackBelowDropId,
} from '../lib/dayTimelineLayout'
import { canStartTimerNow } from '../lib/timer'
import { useSortableHandleMenu } from '../hooks/useSortableHandleMenu'
import { OptionsMenu, type OptionsMenuAction } from './OptionsMenu'
import { DayInstanceTile } from './DayInstanceTile'

export type BlockMenuHandlers = {
  onStartNow: () => void
  onReset: () => void
  onMarkComplete: () => void
  onDuplicate: () => void
  onSaveToLibrary: () => void
  onDetachFromSource: () => void
  onChangeRepeatRule: () => void
  onSplitWithAbove: () => void
  onSplitWithBelow: () => void
  onUnlinkFromSplit: () => void
  onDelete: () => void
  canSplitWithAbove: boolean
  canSplitWithBelow: boolean
  hasTemplateSource: boolean
  hasTaskListSource: boolean
  hasLinkedSource: boolean
}

type Props = {
  instance: DayInstance
  items: DayInstanceItem[]
  variant?: 'default' | 'split'
  minHeightPx?: number
  heightPx?: number
  fillHeight?: boolean
  dropHint: { targetId: string; side: 'left' | 'right' } | null
  stackHintId: string | null
  didDragRef: React.MutableRefObject<boolean>
  onOpen: () => void
  blockMenu: BlockMenuHandlers
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
  didDragRef,
  onOpen,
  blockMenu,
}: Props) {
  const [menuState, setMenuState] = useState<{ anchorRect: DOMRect } | null>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instance.id,
  })
  const { handleProps } = useSortableHandleMenu({
    listeners,
    didDragRef,
    onOpenMenu: (anchor) => setMenuState({ anchorRect: anchor.getBoundingClientRect() }),
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

  const showStartNow = canStartTimerNow(instance)
  const inSplit = Boolean(instance.altGroupId)

  const menuItems: OptionsMenuAction[] = useMemo(() => {
    const items: OptionsMenuAction[] = [
      {
        id: 'timer',
        label: showStartNow ? 'Start now' : 'Reset',
        onSelect: showStartNow ? blockMenu.onStartNow : blockMenu.onReset,
      },
      {
        id: 'complete',
        label: 'Mark as complete',
        onSelect: blockMenu.onMarkComplete,
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        onSelect: blockMenu.onDuplicate,
      },
    ]

    if (!inSplit) {
      items.push(
        {
          id: 'split-above',
          label: 'Split with block above',
          disabled: !blockMenu.canSplitWithAbove,
          onSelect: blockMenu.onSplitWithAbove,
        },
        {
          id: 'split-below',
          label: 'Split with block below',
          disabled: !blockMenu.canSplitWithBelow,
          onSelect: blockMenu.onSplitWithBelow,
        }
      )
    } else {
      items.push({
        id: 'unlink-split',
        label: 'Unlink from split plan',
        onSelect: blockMenu.onUnlinkFromSplit,
      })
    }

    items.push(
      {
        id: 'save-library',
        label: 'Save block to library',
        onSelect: blockMenu.onSaveToLibrary,
      },
      ...(blockMenu.hasTemplateSource
        ? [
            {
              id: 'detach',
              label: 'Detach from template',
              onSelect: blockMenu.onDetachFromSource,
            } satisfies OptionsMenuAction,
          ]
        : blockMenu.hasTaskListSource
          ? [
              {
                id: 'detach',
                label: 'Detach from task list',
                onSelect: blockMenu.onDetachFromSource,
              } satisfies OptionsMenuAction,
            ]
          : []),
      ...(blockMenu.hasLinkedSource
        ? [
            {
              id: 'repeat',
              label: 'Change repeat rule',
              onSelect: blockMenu.onChangeRepeatRule,
            } satisfies OptionsMenuAction,
          ]
        : []),
      {
        id: 'delete',
        label: 'Delete',
        destructive: true,
        onSelect: blockMenu.onDelete,
      }
    )

    return items
  }, [showStartNow, inSplit, blockMenu])

  return (
    <>
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
          aria-label="Block options. Drag to reorder."
          aria-haspopup="menu"
          aria-expanded={menuState != null}
          {...attributes}
          {...handleProps}
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
            onDelete={blockMenu.onDelete}
          />
        </div>
      </div>

      {menuState ? (
        <OptionsMenu
          anchorRect={menuState.anchorRect}
          items={menuItems}
          onClose={() => setMenuState(null)}
        />
      ) : null}
    </>
  )
}
