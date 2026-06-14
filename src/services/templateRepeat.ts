import { db } from '../db/database'
import { todayDateString } from '../lib/ids'
import {
  addDaysToDateString,
  isRepeatDueOnDate,
  normalizeTemplateRepeat,
  repeatHorizonDays,
  repeatScheduledStartMs,
  type TemplateRepeat,
} from '../lib/templateRepeat'
import {
  addInstanceFromTemplate,
  applyInstanceScheduledStartChange,
  getOrCreateDay,
} from './days'
import { processTaskListRepeats } from './taskListRepeat'
import { pruneStaleRepeatInstances, type RepeatSource } from './repeatInstances'

async function findInstanceFromTemplate(dayId: string, templateId: string) {
  return db.dayInstances
    .where('dayId')
    .equals(dayId)
    .filter((i) => i.sourceTemplateId === templateId)
    .first()
}

/** Add recurring template instances from today through each rule's horizon. */
export async function processTemplateRepeats(): Promise<void> {
  const templates = await db.checklistTemplates.toArray()
  const withRepeat = templates.filter((t) => t.repeat != null)
  if (!withRepeat.length) return

  const today = todayDateString()
  for (const template of withRepeat) {
    const repeat = template.repeat
    if (!repeat) continue
    const normalized = normalizeTemplateRepeat(repeat)
    const horizonDays = repeatHorizonDays(normalized)
    await applyRepeatForTemplate(
      template.id,
      normalized,
      today,
      horizonDays,
      template.defaultDurationMin
    )
  }
}

/** Run template and task-list repeat rules. */
export async function processCalendarRepeats(): Promise<void> {
  await processTemplateRepeats()
  await processTaskListRepeats()
}

async function applyRepeatForTemplate(
  templateId: string,
  repeat: TemplateRepeat,
  fromDate: string,
  horizonDays: number,
  defaultDurationMin: number
): Promise<void> {
  const source: RepeatSource = { kind: 'template', templateId, defaultDurationMin }
  await pruneStaleRepeatInstances(source, repeat)

  for (let offset = 0; offset <= horizonDays; offset++) {
    const dateStr = addDaysToDateString(fromDate, offset)
    if (!isRepeatDueOnDate(repeat, dateStr)) continue

    const day = await getOrCreateDay(dateStr)
    const scheduledStartMs = repeatScheduledStartMs(repeat, dateStr)
    const existing = await findInstanceFromTemplate(day.id, templateId)

    if (existing) {
      await applyInstanceScheduledStartChange(existing.id, scheduledStartMs)
      continue
    }

    const instanceId = await addInstanceFromTemplate(templateId, day.id, undefined, {
      createdByRepeat: true,
    })
    await applyInstanceScheduledStartChange(instanceId, scheduledStartMs)
  }
}
