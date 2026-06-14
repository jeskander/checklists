import { db } from '../db/database'
import type { DayInstanceItem } from '../db/types'
import { countLeaves } from '../lib/completion'

export type DayCalendarStatus = 'neutral' | 'complete' | 'incomplete' | 'urgent'

type BlockStatus = 'neutral' | 'complete' | 'incomplete'

function blockStatusForDay(hasInstances: boolean, items: DayInstanceItem[]): BlockStatus {
  if (!hasInstances) return 'neutral'
  const { total, completed } = countLeaves(items)
  if (total === 0 || completed === total) return 'complete'
  return 'incomplete'
}

function mergeStatus(
  block: BlockStatus,
  hasUrgentDue: boolean,
  hasOpenDue: boolean
): DayCalendarStatus {
  if (hasUrgentDue) return 'urgent'
  if (block === 'incomplete' || hasOpenDue) return 'incomplete'
  if (block === 'complete') return 'complete'
  return 'neutral'
}

/** Color-coded status for each date in [startDate, endDate] (inclusive). */
export async function getDayStatusesForRange(
  startDate: string,
  endDate: string
): Promise<Map<string, DayCalendarStatus>> {
  const days = await db.days.where('date').between(startDate, endDate, true, true).toArray()
  const dayIdToDate = new Map(days.map((d) => [d.id, d.date]))
  const dayIds = days.map((d) => d.id)

  const instances = dayIds.length
    ? await db.dayInstances.where('dayId').anyOf(dayIds).toArray()
    : []
  const instanceIds = instances.map((i) => i.id)

  const allItems = instanceIds.length
    ? await db.dayInstanceItems.where('instanceId').anyOf(instanceIds).toArray()
    : []

  const itemsByDayId = new Map<string, DayInstanceItem[]>()
  const instanceCountByDayId = new Map<string, number>()

  for (const inst of instances) {
    instanceCountByDayId.set(inst.dayId, (instanceCountByDayId.get(inst.dayId) ?? 0) + 1)
  }

  const itemsByInstanceId = new Map<string, DayInstanceItem[]>()
  for (const item of allItems) {
    if (!itemsByInstanceId.has(item.instanceId)) itemsByInstanceId.set(item.instanceId, [])
    itemsByInstanceId.get(item.instanceId)!.push(item)
  }

  for (const inst of instances) {
    const date = dayIdToDate.get(inst.dayId)
    if (!date) continue
    const bucket = itemsByDayId.get(date) ?? []
    bucket.push(...(itemsByInstanceId.get(inst.id) ?? []))
    itemsByDayId.set(date, bucket)
  }

  const dueTasks = await db.taskListItems
    .filter(
      (i) =>
        i.completedAt == null &&
        i.parentItemId == null &&
        i.deadline != null &&
        i.deadline >= startDate &&
        i.deadline <= endDate
    )
    .toArray()

  const urgentDueDates = new Set<string>()
  const openDueDates = new Set<string>()
  for (const task of dueTasks) {
    if (!task.deadline) continue
    openDueDates.add(task.deadline)
    if (task.importance === 1) urgentDueDates.add(task.deadline)
  }

  const result = new Map<string, DayCalendarStatus>()

  const walk = (dateStr: string) => {
    const day = days.find((d) => d.date === dateStr)
    const hasInstances = day ? (instanceCountByDayId.get(day.id) ?? 0) > 0 : false
    const items = day ? (itemsByDayId.get(dateStr) ?? []) : []
    const block = blockStatusForDay(hasInstances, items)
    const hasUrgent = urgentDueDates.has(dateStr)
    const hasOpenDue = openDueDates.has(dateStr)
    result.set(dateStr, mergeStatus(block, hasUrgent, hasOpenDue))
  }

  let cursor = startDate
  while (cursor <= endDate) {
    walk(cursor)
    cursor = shiftDateByOne(cursor)
  }

  return result
}

function shiftDateByOne(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
