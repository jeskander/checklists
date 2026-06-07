import type { DayFreeTime, DayInstance } from '../db/types'
import {
  buildSplitColumns,
  chainSplitRow,
  splitRowMinutes,
  type SplitColumn,
} from './daySplitLayout'
import {
  dayWindowEndMs,
  dayWindowStartMs,
  type TimeGap,
} from './dayTimeline'
import { defaultFirstSlotOnDay } from './scheduleTime'

export const FREE_TIMELINE_PREFIX = 'free:'
export const ALT_TIMELINE_PREFIX = 'alt:'
export const SIDE_LEFT_PREFIX = 'side-left:'
export const SIDE_RIGHT_PREFIX = 'side-right:'
export const STACK_BELOW_PREFIX = 'stack-below:'

export function stackBelowDropId(instanceId: string): string {
  return `${STACK_BELOW_PREFIX}${instanceId}`
}

export function parseStackBelowDropId(id: string): string | null {
  if (!id.startsWith(STACK_BELOW_PREFIX)) return null
  return id.slice(STACK_BELOW_PREFIX.length)
}

export function isSideOrStackDropId(id: string): boolean {
  return isSideDropId(id) || id.startsWith(STACK_BELOW_PREFIX)
}

export function sideLeftDropId(instanceId: string): string {
  return `${SIDE_LEFT_PREFIX}${instanceId}`
}

export function sideRightDropId(instanceId: string): string {
  return `${SIDE_RIGHT_PREFIX}${instanceId}`
}

export function parseSideDropId(id: string): { side: 'left' | 'right'; instanceId: string } | null {
  if (id.startsWith(SIDE_LEFT_PREFIX)) {
    return { side: 'left', instanceId: id.slice(SIDE_LEFT_PREFIX.length) }
  }
  if (id.startsWith(SIDE_RIGHT_PREFIX)) {
    return { side: 'right', instanceId: id.slice(SIDE_RIGHT_PREFIX.length) }
  }
  return null
}

export function isSideDropId(id: string): boolean {
  return id.startsWith(SIDE_LEFT_PREFIX) || id.startsWith(SIDE_RIGHT_PREFIX)
}

export type TimelineEntry =
  | { kind: 'instance'; instance: DayInstance }
  | { kind: 'free'; free: DayFreeTime }

export type DisplayTimelineEntry =
  | { kind: 'instance'; instance: DayInstance }
  | { kind: 'free'; free: DayFreeTime }
  | { kind: 'split'; altGroupId: string; columns: SplitColumn[]; rowMinutes: number }

export function freeTimelineDragId(freeId: string): string {
  return `${FREE_TIMELINE_PREFIX}${freeId}`
}

export function altTimelineDragId(altGroupId: string): string {
  return `${ALT_TIMELINE_PREFIX}${altGroupId}`
}

export function isFreeTimelineDragId(id: string): boolean {
  return id.startsWith(FREE_TIMELINE_PREFIX)
}

export function isAltTimelineDragId(id: string): boolean {
  return id.startsWith(ALT_TIMELINE_PREFIX)
}

export function parseTimelineDragId(id: string): { kind: 'instance' | 'free' | 'alternative'; id: string } {
  if (isFreeTimelineDragId(id)) {
    return { kind: 'free', id: id.slice(FREE_TIMELINE_PREFIX.length) }
  }
  if (isAltTimelineDragId(id)) {
    return { kind: 'alternative', id: id.slice(ALT_TIMELINE_PREFIX.length) }
  }
  return { kind: 'instance', id }
}

export function timelineDragId(entry: DisplayTimelineEntry): string {
  if (entry.kind === 'free') return freeTimelineDragId(entry.free.id)
  if (entry.kind === 'split') return altTimelineDragId(entry.altGroupId)
  return entry.instance.id
}

export function groupTimelineForDisplay(
  timeline: TimelineEntry[],
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): DisplayTimelineEntry[] {
  const result: DisplayTimelineEntry[] = []
  let i = 0

  while (i < timeline.length) {
    const entry = timeline[i]
    if (entry.kind === 'free') {
      if (entry.free.altGroupId) {
        i++
        continue
      }
      result.push(entry)
      i++
      continue
    }

    const altGroupId = entry.instance.altGroupId
    if (!altGroupId) {
      result.push(entry)
      i++
      continue
    }

    const columns = buildSplitColumns(instances, freeTimes, altGroupId)
    result.push({
      kind: 'split',
      altGroupId,
      columns,
      rowMinutes: splitRowMinutes(columns),
    })

    while (i < timeline.length) {
      const next = timeline[i]
      if (next.kind === 'free' && next.free.altGroupId === altGroupId) {
        i++
        continue
      }
      if (next.kind === 'instance' && next.instance.altGroupId === altGroupId) {
        i++
        continue
      }
      if (next.kind === 'free' && !next.free.altGroupId) break
      if (next.kind === 'instance' && !next.instance.altGroupId) break
      if (next.kind === 'free') {
        i++
        continue
      }
      break
    }
  }

  return result
}

function displayEntryMinutes(entry: DisplayTimelineEntry): number {
  if (entry.kind === 'free') return entry.free.durationMin
  if (entry.kind === 'split') return entry.rowMinutes
  return entry.instance.durationMin
}

export function timelineTotalMinutes(
  timeline: TimelineEntry[],
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): number {
  return groupTimelineForDisplay(timeline, instances, freeTimes).reduce(
    (sum, entry) => sum + displayEntryMinutes(entry),
    0
  )
}

export function buildTimeline(
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): TimelineEntry[] {
  const merged: Array<TimelineEntry & { sortOrder: number }> = [
    ...instances.map((instance) => ({ kind: 'instance' as const, instance, sortOrder: instance.sortOrder })),
    ...freeTimes.map((free) => ({ kind: 'free' as const, free, sortOrder: free.sortOrder })),
  ]
  merged.sort((a, b) => a.sortOrder - b.sortOrder)
  return merged.map(({ sortOrder: _s, ...entry }) => entry)
}

export function flattenTimelineSortableIds(
  timeline: TimelineEntry[],
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): string[] {
  const display = groupTimelineForDisplay(timeline, instances, freeTimes)
  const ids: string[] = []
  for (const entry of display) {
    if (entry.kind === 'free') ids.push(freeTimelineDragId(entry.free.id))
    else if (entry.kind === 'split') {
      for (const col of entry.columns) {
        for (const item of col.items) {
          ids.push(item.kind === 'free' ? freeTimelineDragId(item.free.id) : item.instance.id)
        }
      }
    } else ids.push(entry.instance.id)
  }
  return ids
}

export function timelineToDragRows(
  timeline: TimelineEntry[],
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): { id: string }[] {
  return groupTimelineForDisplay(timeline, instances, freeTimes).map((e) => ({ id: timelineDragId(e) }))
}

/** Merge consecutive free-time drag ids (same pass also returns merged duration map). */
export function mergeAdjacentFreeDragIds(
  dragIds: string[],
  freeById: Map<string, DayFreeTime>
): { dragIds: string[]; mergedAway: string[]; durationUpdates: Map<string, number> } {
  const mergedAway: string[] = []
  const durationUpdates = new Map<string, number>()
  const result: string[] = []

  for (const id of dragIds) {
    if (!isFreeTimelineDragId(id)) {
      result.push(id)
      continue
    }
    const freeId = parseTimelineDragId(id).id
    const free = freeById.get(freeId)
    if (!free) continue

    const prev = result[result.length - 1]
    if (prev && isFreeTimelineDragId(prev)) {
      const prevId = parseTimelineDragId(prev).id
      const prevFree = freeById.get(prevId)
      if (prevFree) {
        const combined = prevFree.durationMin + free.durationMin
        durationUpdates.set(prevId, combined)
        mergedAway.push(freeId)
        continue
      }
    }
    result.push(id)
  }

  return { dragIds: result, mergedAway, durationUpdates }
}

export type ChainedTimeline = {
  entries: TimelineEntry[]
  /** startMs for each instance in timeline order */
  instanceStarts: Map<string, number>
  /** display gap for each free block in timeline order */
  freeGaps: Map<string, TimeGap>
}

/** Schedule every entry back-to-back from 06:00 in list order. */
export function chainTimelineFromDayStart(
  dateStr: string,
  timeline: TimelineEntry[],
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): ChainedTimeline {
  let pointer = dayWindowStartMs(dateStr)
  const instanceStarts = new Map<string, number>()
  const freeGaps = new Map<string, TimeGap>()
  const display = groupTimelineForDisplay(timeline, instances, freeTimes)

  for (const entry of display) {
    if (entry.kind === 'free') {
      const startMs = pointer
      const endMs = pointer + entry.free.durationMin * 60_000
      freeGaps.set(entry.free.id, {
        startMs,
        endMs,
        minutes: entry.free.durationMin,
      })
      pointer = endMs
    } else if (entry.kind === 'split') {
      const startMs = pointer
      const chained = chainSplitRow(startMs, entry.columns)
      for (const [id, ms] of chained.instanceStarts) instanceStarts.set(id, ms)
      for (const [id, gap] of chained.freeGaps) freeGaps.set(id, gap)
      pointer += entry.rowMinutes * 60_000
    } else {
      instanceStarts.set(entry.instance.id, pointer)
      pointer += entry.instance.durationMin * 60_000
    }
  }

  return { entries: timeline, instanceStarts, freeGaps }
}

/** Block whose scheduled range contains `startMs` (same start or mid-block). */
export function findInstanceContainingStartTime(
  instanceId: string,
  startMs: number,
  instances: DayInstance[],
  instanceStarts: Map<string, number>
): DayInstance | undefined {
  for (const other of instances) {
    if (other.id === instanceId) continue
    const otherStart = instanceStarts.get(other.id)
    if (otherStart == null) continue
    const otherEnd = otherStart + other.durationMin * 60_000
    if (startMs >= otherStart && startMs < otherEnd) return other
  }
  return undefined
}

export function timelineEndMs(
  dateStr: string,
  timeline: TimelineEntry[],
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): number {
  const { instanceStarts, freeGaps } = chainTimelineFromDayStart(dateStr, timeline, instances, freeTimes)
  if (timeline.length === 0) return defaultFirstSlotOnDay(dateStr)

  const display = groupTimelineForDisplay(timeline, instances, freeTimes)
  const last = display[display.length - 1]
  if (last.kind === 'free') {
    const gap = freeGaps.get(last.free.id)
    return gap?.endMs ?? dayWindowStartMs(dateStr)
  }
  if (last.kind === 'split') {
    const start = instanceStarts.get(
      last.columns[0]?.items.find((i) => i.kind === 'instance')?.instance.id ?? ''
    ) ?? dayWindowStartMs(dateStr)
    return start + last.rowMinutes * 60_000
  }
  const start = instanceStarts.get(last.instance.id) ?? dayWindowStartMs(dateStr)
  return start + last.instance.durationMin * 60_000
}

const MIN_MATERIALIZE_GAP_MIN = 10

type MaterializedRow =
  | { kind: 'free'; durationMin: number }
  | { kind: 'instance'; instanceId: string }

/** Build initial free blocks + unified sort order from existing instance times. */
export function materializeTimelineRows(
  dateStr: string,
  instances: DayInstance[]
): MaterializedRow[] {
  const sorted = [...instances].sort((a, b) => a.sortOrder - b.sortOrder)
  if (sorted.length === 0) return []

  const rows: MaterializedRow[] = []
  const dayStart = dayWindowStartMs(dateStr)
  const dayEnd = dayWindowEndMs(dateStr)

  const beforeMin = Math.round((sorted[0].scheduledStartMs - dayStart) / 60_000)
  if (beforeMin >= MIN_MATERIALIZE_GAP_MIN) {
    rows.push({ kind: 'free', durationMin: beforeMin })
  }

  for (let i = 0; i < sorted.length; i++) {
    rows.push({ kind: 'instance', instanceId: sorted[i].id })
    if (i < sorted.length - 1) {
      const prevEnd =
        sorted[i].scheduledStartMs + sorted[i].durationMin * 60_000
      const betweenMin = Math.round((sorted[i + 1].scheduledStartMs - prevEnd) / 60_000)
      if (betweenMin >= MIN_MATERIALIZE_GAP_MIN) {
        rows.push({ kind: 'free', durationMin: betweenMin })
      }
    }
  }

  const last = sorted[sorted.length - 1]
  const lastEnd = last.scheduledStartMs + last.durationMin * 60_000
  const afterMin = Math.round((dayEnd - lastEnd) / 60_000)
  if (afterMin >= MIN_MATERIALIZE_GAP_MIN) {
    rows.push({ kind: 'free', durationMin: afterMin })
  }

  return rows
}

export type DayTimelineSnapshot = {
  instances: Array<{ id: string; sortOrder: number; scheduledStartMs: number }>
  freeTimes: Array<{ id: string; sortOrder: number; durationMin: number }>
}

export function snapshotDayTimeline(
  instances: DayInstance[],
  freeTimes: DayFreeTime[]
): DayTimelineSnapshot {
  return {
    instances: instances.map((i) => ({
      id: i.id,
      sortOrder: i.sortOrder,
      scheduledStartMs: i.scheduledStartMs,
    })),
    freeTimes: freeTimes.map((f) => ({
      id: f.id,
      sortOrder: f.sortOrder,
      durationMin: f.durationMin,
    })),
  }
}
