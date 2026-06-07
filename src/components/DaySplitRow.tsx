import type { DayInstance, DayInstanceItem } from '../db/types'
import {
  computeSplitVisualLayout,
  splitItemKey,
  type SplitColumn,
} from '../lib/daySplitLayout'
import type { TimeGap } from '../lib/dayTimeline'
import { SortableDayFreeTime } from './SortableDayFreeTime'
import { SortableDayTileInner } from './SortableDayTileInner'

type Props = {
  altGroupId: string
  columns: SplitColumn[]
  rowMinutes: number
  instanceStarts: Map<string, number>
  allItems: Record<string, DayInstanceItem[]>
  freeGaps: Map<string, TimeGap>
  dropHint: { targetId: string; side: 'left' | 'right' } | null
  stackHintId: string | null
  instanceHandlers: (inst: DayInstance) => {
    onOpen: () => void
    onDelete: () => void
  }
}

export function DaySplitRow({
  columns,
  rowMinutes,
  instanceStarts,
  allItems,
  freeGaps,
  dropHint,
  stackHintId,
  instanceHandlers,
}: Props) {
  const layout = computeSplitVisualLayout(columns, rowMinutes, instanceStarts, freeGaps)
  const gridRows = `repeat(${layout.rowCount}, minmax(${Math.round(layout.rowUnitPx)}px, 1fr))`

  return (
    <div className="day-split" style={{ minHeight: `${layout.totalHeightPx}px` }}>
      {columns.map((col) => (
        <div
          key={col.columnIndex}
          className="day-split-column day-split-column--grid"
          style={{
            gridTemplateRows: gridRows,
            minHeight: `${layout.totalHeightPx}px`,
          }}
        >
          {col.items.map((item) => {
            const itemLayout = layout.items.get(splitItemKey(item))!
            const gridStyle = {
              gridRow: `${itemLayout.startRow + 1} / span ${itemLayout.rowSpan}`,
            }

            return (
              <div key={splitItemKey(item)} className="day-split-item-slot" style={gridStyle}>
                {item.kind === 'free' ? (
                  <SortableDayFreeTime
                    freeId={item.free.id}
                    gap={freeGaps.get(item.free.id)!}
                    variant="split"
                    fillHeight
                  />
                ) : (
                  <SortableDayTileInner
                    instance={item.instance}
                    items={allItems[item.instance.id] ?? []}
                    variant="split"
                    fillHeight
                    dropHint={dropHint}
                    stackHintId={stackHintId}
                    {...instanceHandlers(item.instance)}
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
