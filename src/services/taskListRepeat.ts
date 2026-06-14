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
import { pruneStaleRepeatInstances, type RepeatSource } from './repeatInstances'

async function findInstanceFromTaskList(dayId: string, taskListId: string) {
  return db.dayInstances
    .where('dayId')
    .equals(dayId)
    .filter((i) => i.sourceTaskListId === taskListId)
    .first()
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
  const source: RepeatSource = { kind: 'taskList', taskListId, defaultDurationMin }
  await pruneStaleRepeatInstances(source, repeat)

  for (let offset = 0; offset <= horizonDays; offset++) {
    const dateStr = addDaysToDateString(fromDate, offset)
    if (!isRepeatDueOnDate(repeat, dateStr)) continue

    const day = await getOrCreateDay(dateStr)
    const scheduledStartMs = repeatScheduledStartMs(repeat, dateStr)
    const existing = await findInstanceFromTaskList(day.id, taskListId)

    if (existing) {
      await applyInstanceScheduledStartChange(existing.id, scheduledStartMs)
      continue
    }

    const instanceId = await addInstanceFromTaskList(taskListId, day.id, defaultDurationMin, undefined, {
      createdByRepeat: true,
    })
    await applyInstanceScheduledStartChange(instanceId, scheduledStartMs)
  }
}
