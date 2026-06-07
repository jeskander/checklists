import { db } from '../db/database'
import { todayDateString } from '../lib/ids'
import { isInboxList } from '../lib/inbox'
import {
  addDaysToDateString,
  isRepeatDueOnDate,
  normalizeTemplateRepeat,
  repeatHorizonDays,
  repeatScheduledStartMs,
  type TemplateRepeat,
} from '../lib/templateRepeat'
import {
  addInstanceFromTaskList,
  applyInstanceScheduledStartChange,
  getOrCreateDay,
} from './days'

async function hasInstanceFromTaskList(dayId: string, taskListId: string): Promise<boolean> {
  const count = await db.dayInstances
    .where('dayId')
    .equals(dayId)
    .filter((i) => i.sourceTaskListId === taskListId)
    .count()
  return count > 0
}

/** Add recurring task-list blocks from today through each rule's horizon. */
export async function processTaskListRepeats(): Promise<void> {
  const lists = await db.taskLists.toArray()
  const withRepeat = lists.filter((l) => l.repeat != null && !isInboxList(l))
  if (!withRepeat.length) return

  const today = todayDateString()
  for (const list of withRepeat) {
    const repeat = list.repeat
    if (!repeat) continue
    const normalized = normalizeTemplateRepeat(repeat)
    const horizonDays = repeatHorizonDays(normalized)
    await applyRepeatForTaskList(list.id, list.defaultDurationMin, normalized, today, horizonDays)
  }
}

async function applyRepeatForTaskList(
  taskListId: string,
  defaultDurationMin: number,
  repeat: TemplateRepeat,
  fromDate: string,
  horizonDays: number
): Promise<void> {
  for (let offset = 0; offset <= horizonDays; offset++) {
    const dateStr = addDaysToDateString(fromDate, offset)
    if (!isRepeatDueOnDate(repeat, dateStr)) continue

    const day = await getOrCreateDay(dateStr)
    if (await hasInstanceFromTaskList(day.id, taskListId)) continue

    const instanceId = await addInstanceFromTaskList(taskListId, day.id, defaultDurationMin)
    const scheduledStartMs = repeatScheduledStartMs(repeat, dateStr)
    await applyInstanceScheduledStartChange(instanceId, scheduledStartMs)
  }
}
