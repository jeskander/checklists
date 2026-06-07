import type { DayFreeTime, DayInstance } from '../db/types'
import type { TimeGap } from './dayTimeline'

export type SplitColumnItem =
  | { kind: 'instance'; instance: DayInstance }
  | { kind: 'free'; free: DayFreeTime }

export type SplitColumn = {
  columnIndex: number
  items: SplitColumnItem[]
  totalMinutes: number
}

export type SplitRow = {
  altGroupId: string
  sortOrder: number
  columns: SplitColumn[]
  rowMinutes: number
  rowStartMs: number
}

const MIN_ROW_PX = 52

/** Visual height for blocks in a split column — scales with duration. */
export function blockHeightPx(minutes: number): number {
  const pxPerMin = 1.35
  const minPx = 52
  const maxPx = 320
  return Math.min(maxPx, Math.max(minPx, Math.round(minutes * pxPerMin)))
}

export function columnHeightPx(minutes: number): number {
  return blockHeightPx(minutes)
}

export function splitItemKey(item: SplitColumnItem): string {
  return item.kind === 'instance' ? item.instance.id : item.free.id
}

export type MasterTimeRow = {
  startMs: number
  endMs: number
}

export type SplitItemLayout = {
  startRow: number
  rowSpan: number
  heightPx: number
}

export type SplitVisualLayout = {
  masterColumnIndex: number
  rowCount: number
  totalHeightPx: number
  rowUnitPx: number
  items: Map<string, SplitItemLayout>
}

function splitItemMinutes(item: SplitColumnItem): number {
  return item.kind === 'free' ? item.free.durationMin : item.instance.durationMin
}

export function getSplitItemTimeRange(
  item: SplitColumnItem,
  instanceStarts: Map<string, number>,
  freeGaps: Map<string, TimeGap>
): MasterTimeRow {
  if (item.kind === 'free') {
    const gap = freeGaps.get(item.free.id)
    if (!gap) return { startMs: 0, endMs: 0 }
    return { startMs: gap.startMs, endMs: gap.endMs }
  }
  const startMs = instanceStarts.get(item.instance.id) ?? 0
  return {
    startMs,
    endMs: startMs + item.instance.durationMin * 60_000,
  }
}

/** Master row index where `startMs` falls. */
export function resolveMasterStartRow(startMs: number, rows: MasterTimeRow[]): number {
  for (let i = 0; i < rows.length; i++) {
    if (startMs >= rows[i].startMs && startMs < rows[i].endMs) return i
  }
  if (rows.length && startMs >= rows[rows.length - 1].endMs) return rows.length - 1
  return 0
}

/**
 * End row index for height spanning.
 * Ending mid-row counts through that row; ending exactly on a boundary counts through the next row.
 */
export function resolveMasterEndRow(endMs: number, rows: MasterTimeRow[]): number {
  for (let i = 0; i < rows.length; i++) {
    if (endMs === rows[i].endMs) return i + 1
    if (endMs > rows[i].startMs && endMs < rows[i].endMs) return i
  }
  if (rows.length && endMs > rows[rows.length - 1].startMs) return rows.length - 1
  return 0
}

export function masterRowSpan(startMs: number, endMs: number, rows: MasterTimeRow[]): number {
  const startRow = resolveMasterStartRow(startMs, rows)
  const endRow = resolveMasterEndRow(endMs, rows)
  return Math.max(1, endRow - startRow + 1)
}

function pickMasterColumn(columns: SplitColumn[]): SplitColumn {
  return columns.reduce((best, col) => {
    if (col.items.length > best.items.length) return col
    if (col.items.length === best.items.length && col.totalMinutes > best.totalMinutes) return col
    return best
  })
}

export function computeSplitVisualLayout(
  columns: SplitColumn[],
  rowMinutes: number,
  instanceStarts: Map<string, number>,
  freeGaps: Map<string, TimeGap>
): SplitVisualLayout {
  const masterCol = pickMasterColumn(columns)
  const rowCount = Math.max(1, masterCol.items.length)
  const totalHeightPx = Math.max(blockHeightPx(rowMinutes), rowCount * MIN_ROW_PX)
  const rowUnitPx = totalHeightPx / rowCount
  const masterRows = masterCol.items.map((item) => getSplitItemTimeRange(item, instanceStarts, freeGaps))
  const items = new Map<string, SplitItemLayout>()

  for (const col of columns) {
    const isMaster = col.columnIndex === masterCol.columnIndex
    col.items.forEach((item, index) => {
      const key = splitItemKey(item)
      if (isMaster) {
        items.set(key, {
          startRow: index,
          rowSpan: 1,
          heightPx: rowUnitPx,
        })
        return
      }

      const { startMs, endMs } = getSplitItemTimeRange(item, instanceStarts, freeGaps)
      const startRow = resolveMasterStartRow(startMs, masterRows)
      const rowSpan = masterRowSpan(startMs, endMs, masterRows)
      items.set(key, {
        startRow,
        rowSpan,
        heightPx: rowSpan * rowUnitPx,
      })
    })
  }

  return {
    masterColumnIndex: masterCol.columnIndex,
    rowCount,
    totalHeightPx,
    rowUnitPx,
    items,
  }
}

export function buildSplitColumns(
  instances: DayInstance[],
  freeTimes: DayFreeTime[],
  altGroupId: string
): SplitColumn[] {
  const groupInstances = instances.filter((i) => i.altGroupId === altGroupId)
  const groupFree = freeTimes.filter((f) => f.altGroupId === altGroupId)
  if (!groupInstances.length && !groupFree.length) return []

  const columnIndices = new Set<number>()
  for (const i of groupInstances) columnIndices.add(i.altGroupIndex ?? 0)
  for (const f of groupFree) columnIndices.add(f.altGroupIndex ?? 0)

  const columns: SplitColumn[] = [...columnIndices]
    .sort((a, b) => a - b)
    .map((columnIndex) => {
      const colInstances = groupInstances
        .filter((i) => (i.altGroupIndex ?? 0) === columnIndex)
        .sort((a, b) => (a.altStackIndex ?? 0) - (b.altStackIndex ?? 0))
      const colFree = groupFree
        .filter((f) => (f.altGroupIndex ?? 0) === columnIndex)
        .sort((a, b) => (a.altStackIndex ?? 0) - (b.altStackIndex ?? 0))

      const colItems: SplitColumnItem[] = [
        ...colInstances.map((instance) => ({ kind: 'instance' as const, instance })),
        ...colFree.map((free) => ({ kind: 'free' as const, free })),
      ].sort((a, b) => {
        const aStack =
          a.kind === 'instance' ? (a.instance.altStackIndex ?? 0) : (a.free.altStackIndex ?? 0)
        const bStack =
          b.kind === 'instance' ? (b.instance.altStackIndex ?? 0) : (b.free.altStackIndex ?? 0)
        return aStack - bStack
      })

      const totalMinutes = colItems.reduce((sum, item) => sum + splitItemMinutes(item), 0)
      return { columnIndex, items: colItems, totalMinutes }
    })

  return columns
}

export function splitRowMinutes(columns: SplitColumn[]): number {
  if (!columns.length) return 0
  return Math.max(...columns.map((c) => c.totalMinutes))
}

export type SplitChainResult = {
  instanceStarts: Map<string, number>
  freeGaps: Map<string, TimeGap>
}

export function chainSplitRow(rowStartMs: number, columns: SplitColumn[]): SplitChainResult {
  const instanceStarts = new Map<string, number>()
  const freeGaps = new Map<string, TimeGap>()

  for (const column of columns) {
    let pointer = rowStartMs
    for (const item of column.items) {
      if (item.kind === 'free') {
        const startMs = pointer
        const endMs = pointer + item.free.durationMin * 60_000
        freeGaps.set(item.free.id, { startMs, endMs, minutes: item.free.durationMin })
        pointer = endMs
      } else {
        instanceStarts.set(item.instance.id, pointer)
        pointer += item.instance.durationMin * 60_000
      }
    }
  }

  return { instanceStarts, freeGaps }
}

export function flattenSplitSortableIds(columns: SplitColumn[]): string[] {
  const ids: string[] = []
  for (const col of columns) {
    for (const item of col.items) {
      ids.push(item.kind === 'free' ? `free:${item.free.id}` : item.instance.id)
    }
  }
  return ids
}
