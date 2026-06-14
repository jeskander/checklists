import { db } from '../db/database'
import type { DayInstance, DayInstanceItem } from '../db/types'
import { todayDateString } from '../lib/ids'
import { formatScheduleSubtitle } from '../lib/schedule'
import { normalizeTemplateRepeat, type TemplateRepeat } from '../lib/templateRepeat'
import { deleteInstance } from './days'
import { listUpcomingInstancesForSource, type RepeatSource } from './repeatInstances'
import { updateTaskList } from './taskLists'
import { updateTemplate } from './templates'

export type RepeatDeletePrompt = {
  blockTitle: string
  subtitle: string
  source: RepeatSource
  futureCount: number
  showFutureOption: boolean
}

export type EndRepeatSeriesSnapshot = {
  repeat: TemplateRepeat
  deleted: Array<{ instance: DayInstance; items: DayInstanceItem[] }>
}

async function loadRepeat(source: RepeatSource): Promise<TemplateRepeat | undefined> {
  if (source.kind === 'taskList') {
    return (await db.taskLists.get(source.taskListId))?.repeat
  }
  return (await db.checklistTemplates.get(source.templateId))?.repeat
}

async function updateRepeatOnSource(
  source: RepeatSource,
  repeat: TemplateRepeat | undefined
): Promise<void> {
  if (source.kind === 'taskList') {
    await updateTaskList(source.taskListId, { repeat })
  } else {
    await updateTemplate(source.templateId, { repeat })
  }
}

export async function getRepeatDeletePrompt(
  instance: DayInstance,
  dayDate: string,
  formatDayLabel: (dateStr: string) => string
): Promise<RepeatDeletePrompt | null> {
  let source: RepeatSource | null = null
  let blockTitle = instance.title

  if (instance.sourceTaskListId) {
    const list = await db.taskLists.get(instance.sourceTaskListId)
    if (!list?.repeat) return null
    blockTitle = list.title
    source = { kind: 'taskList', taskListId: list.id, defaultDurationMin: list.defaultDurationMin }
  } else if (instance.sourceTemplateId) {
    const template = await db.checklistTemplates.get(instance.sourceTemplateId)
    if (!template?.repeat) return null
    blockTitle = template.title
    source = { kind: 'template', templateId: template.id, defaultDurationMin: template.defaultDurationMin }
  } else {
    return null
  }

  const rows = await listUpcomingInstancesForSource(source, dayDate)
  const timeLabel = formatScheduleSubtitle(instance.durationMin, instance.scheduledStartMs)

  return {
    blockTitle,
    subtitle: `${formatDayLabel(dayDate)} · ${timeLabel}`,
    source,
    futureCount: rows.length,
    showFutureOption: dayDate >= todayDateString(),
  }
}

export async function skipRepeatOnDate(
  source: RepeatSource,
  date: string
): Promise<TemplateRepeat | undefined> {
  const repeat = await loadRepeat(source)
  if (!repeat) return undefined
  const normalized = normalizeTemplateRepeat(repeat)
  const skippedDates = [...new Set([...(normalized.skippedDates ?? []), date])]
  const next = normalizeTemplateRepeat({ ...normalized, skippedDates })
  await updateRepeatOnSource(source, next)
  return next
}

export async function removeSkipOnDate(source: RepeatSource, date: string): Promise<void> {
  const repeat = await loadRepeat(source)
  if (!repeat) return
  const normalized = normalizeTemplateRepeat(repeat)
  if (!normalized.skippedDates?.includes(date)) return
  const skippedDates = normalized.skippedDates.filter((d) => d !== date)
  const next = normalizeTemplateRepeat({ ...normalized, skippedDates })
  await updateRepeatOnSource(source, next)
}

export async function endRepeatSeriesFromDate(
  source: RepeatSource,
  fromDate: string
): Promise<EndRepeatSeriesSnapshot | null> {
  const repeat = await loadRepeat(source)
  if (!repeat) return null

  const normalized = normalizeTemplateRepeat(repeat)
  const rows = await listUpcomingInstancesForSource(source, fromDate)
  const deleted: EndRepeatSeriesSnapshot['deleted'] = []

  for (const row of rows) {
    const items = await db.dayInstanceItems.where('instanceId').equals(row.instance.id).toArray()
    deleted.push({
      instance: { ...row.instance },
      items: items.map((item) => ({ ...item })),
    })
    await deleteInstance(row.instance.id)
  }

  await updateRepeatOnSource(source, undefined)
  return { repeat: normalized, deleted }
}

export async function restoreRepeatSeries(
  snapshot: EndRepeatSeriesSnapshot,
  source: RepeatSource,
  restoreInstance: (instance: DayInstance) => Promise<void>,
  restoreItems: (items: DayInstanceItem[]) => Promise<void>
): Promise<void> {
  await updateRepeatOnSource(source, snapshot.repeat)
  for (const { instance, items } of snapshot.deleted) {
    await restoreInstance(instance)
    await restoreItems(items)
  }
}
