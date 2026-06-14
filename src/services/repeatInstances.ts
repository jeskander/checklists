import { db } from '../db/database'
import type { DayInstance } from '../db/types'
import { todayDateString } from '../lib/ids'
import {
  isRepeatDueOnDate,
  repeatScheduledStartMs,
  type TemplateRepeat,
} from '../lib/templateRepeat'
import { deleteInstance } from './days'

export type RepeatSource =
  | { kind: 'taskList'; taskListId: string; defaultDurationMin: number }
  | { kind: 'template'; templateId: string; defaultDurationMin: number }

export type RepeatInstanceRow = {
  instance: DayInstance
  date: string
}

export type RepeatCancelMode = 'all' | 'untouched' | 'keep'

function matchesSource(instance: DayInstance, source: RepeatSource): boolean {
  if (source.kind === 'taskList') return instance.sourceTaskListId === source.taskListId
  return instance.sourceTemplateId === source.templateId
}

/** Upcoming calendar instances linked to a task list or template (today onward). */
export async function listUpcomingInstancesForSource(
  source: RepeatSource,
  fromDate = todayDateString()
): Promise<RepeatInstanceRow[]> {
  const instances = await db.dayInstances.toArray()
  const days = await db.days.toArray()
  const dayDateById = new Map(days.map((d) => [d.id, d.date]))

  return instances
    .filter((inst) => matchesSource(inst, source))
    .map((instance) => ({
      instance,
      date: dayDateById.get(instance.dayId) ?? '',
    }))
    .filter((row) => row.date >= fromDate)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function isRepeatInstanceUntouched(
  instance: DayInstance,
  expected: { scheduledStartMs: number; durationMin: number }
): Promise<boolean> {
  if (instance.timerStartedAt != null) return false
  if (instance.noteJson?.trim()) return false
  if (instance.altGroupId) return false
  if (instance.durationMin !== expected.durationMin) return false
  if (instance.scheduledStartMs !== expected.scheduledStartMs) return false

  const items = await db.dayInstanceItems.where('instanceId').equals(instance.id).toArray()
  return !items.some((item) => item.completed)
}

export async function countUntouchedRepeatInstances(
  source: RepeatSource,
  repeat: TemplateRepeat
): Promise<number> {
  const rows = await listUpcomingInstancesForSource(source)
  let count = 0
  for (const row of rows) {
    if (!row.instance.createdByRepeat) continue
    const expected = {
      scheduledStartMs: repeatScheduledStartMs(repeat, row.date),
      durationMin: source.defaultDurationMin,
    }
    if (await isRepeatInstanceUntouched(row.instance, expected)) count++
  }
  return count
}

/** User-confirmed cleanup when repeat is turned off. */
export async function pruneOnRepeatCancel(
  source: RepeatSource,
  repeat: TemplateRepeat,
  mode: RepeatCancelMode
): Promise<number> {
  if (mode === 'keep') return 0

  const rows = await listUpcomingInstancesForSource(source)
  let removed = 0

  for (const row of rows) {
    if (mode === 'all') {
      await deleteInstance(row.instance.id)
      removed++
      continue
    }

    if (!row.instance.createdByRepeat) continue
    const expected = {
      scheduledStartMs: repeatScheduledStartMs(repeat, row.date),
      durationMin: source.defaultDurationMin,
    }
    if (await isRepeatInstanceUntouched(row.instance, expected)) {
      await deleteInstance(row.instance.id)
      removed++
    }
  }

  return removed
}

/** Remove future repeat-created instances that no longer match an active rule. */
export async function pruneStaleRepeatInstances(
  source: RepeatSource,
  repeat: TemplateRepeat
): Promise<void> {
  const rows = await listUpcomingInstancesForSource(source)
  for (const row of rows) {
    if (!row.instance.createdByRepeat) continue
    if (!isRepeatDueOnDate(repeat, row.date)) {
      await deleteInstance(row.instance.id)
    }
  }
}
