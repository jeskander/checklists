import { db } from '../db/database'
import type { Day, DayFreeTime, DayInstance, DayInstanceItem } from '../db/types'
import { newId, now, todayDateString } from '../lib/ids'
import { collectDescendantIds } from '../lib/completion'
import type { ItemTreeStructureRow } from '../lib/itemTreeMove'
import { buildSplitColumns, splitRowMinutes } from '../lib/daySplitLayout'
import {
  buildTimeline,
  chainTimelineFromDayStart,
  findInstanceContainingStartTime,
  materializeTimelineRows,
  mergeAdjacentFreeDragIds,
  parseTimelineDragId,
  isFreeTimelineDragId,
  groupTimelineForDisplay,
  timelineEndMs,
  timelineToDragRows,
  timelineTotalMinutes,
  type DayTimelineSnapshot,
} from '../lib/dayTimelineLayout'
import { DAY_WINDOW_MINUTES } from '../lib/dayTimeline'
import { canReparentUnder } from '../lib/listItems'
import { defaultFirstSlotOnDay } from '../lib/scheduleTime'
import { listTemplateItems, getTemplate } from './templates'
import { completeTaskListItem, getTaskList, listTaskListItems, restoreTaskListItem } from './taskLists'
import { packTasksForSession } from '../lib/packTaskList'
import { syncDayInstanceItemToTaskList } from '../lib/taskListItemSync'
import { enqueueSync } from '../sync/syncEngine'

export type FreeSlotInsert = {
  freeId: string
  scheduledStartMs: number
}

// ─── Days ────────────────────────────────────────────────────────────────────

export async function getOrCreateDay(date: string): Promise<Day> {
  const existing = await db.days.where('date').equals(date).first()
  if (existing) return existing

  const id = newId()
  const day: Day = { id, date, updatedAt: now() }
  await db.days.add(day)
  await enqueueSync('create', 'day', id)
  return day
}

export async function getDayByDate(date: string): Promise<Day | undefined> {
  return db.days.where('date').equals(date).first()
}

async function getDayDate(dayId: string): Promise<string> {
  const day = await db.days.get(dayId)
  return day?.date ?? todayDateString()
}

// ─── Day instances & free times ───────────────────────────────────────────────

export async function listDayInstances(dayId: string): Promise<DayInstance[]> {
  const items = await db.dayInstances.where('dayId').equals(dayId).toArray()
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function listDayFreeTimes(dayId: string): Promise<DayFreeTime[]> {
  const items = await db.dayFreeTimes.where('dayId').equals(dayId).toArray()
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function listInstanceItems(instanceId: string): Promise<DayInstanceItem[]> {
  const items = await db.dayInstanceItems.where('instanceId').equals(instanceId).toArray()
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Fetch items for multiple instances in a single query, grouped by instanceId. */
export async function listAllDayInstanceItems(
  instanceIds: string[]
): Promise<Record<string, DayInstanceItem[]>> {
  if (!instanceIds.length) return {}
  const items = await db.dayInstanceItems.where('instanceId').anyOf(instanceIds).toArray()
  const map: Record<string, DayInstanceItem[]> = {}
  for (const item of items.sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!map[item.instanceId]) map[item.instanceId] = []
    map[item.instanceId].push(item)
  }
  return map
}

async function nextTimelineSortOrder(dayId: string): Promise<number> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const orders = [...instances.map((i) => i.sortOrder), ...freeTimes.map((f) => f.sortOrder)]
  return (orders.length ? Math.max(...orders) : -1) + 1
}

async function shiftTimelineSortOrdersFrom(dayId: string, fromSortOrder: number, delta = 1): Promise<void> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const updatedAt = now()
  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    for (const i of instances.filter((inst) => inst.sortOrder >= fromSortOrder)) {
      await db.dayInstances.update(i.id, { sortOrder: i.sortOrder + delta, updatedAt })
      await enqueueSync('update', 'dayInstance', i.id)
    }
    for (const f of freeTimes.filter((ft) => ft.sortOrder >= fromSortOrder)) {
      await db.dayFreeTimes.update(f.id, { sortOrder: f.sortOrder + delta, updatedAt })
      await enqueueSync('update', 'dayFreeTime', f.id)
    }
  })
}

async function shrinkFreeBlockForInsert(freeId: string, instanceDurationMin: number): Promise<void> {
  const free = await db.dayFreeTimes.get(freeId)
  if (!free) return
  const newDur = free.durationMin - instanceDurationMin
  if (newDur <= 0) {
    await db.dayFreeTimes.delete(freeId)
    await enqueueSync('delete', 'dayFreeTime', freeId)
  } else {
    await db.dayFreeTimes.update(freeId, { durationMin: newDur, updatedAt: now() })
    await enqueueSync('update', 'dayFreeTime', freeId)
  }
}

async function plannedStartForNewInstance(dayId: string): Promise<number> {
  const dateStr = await getDayDate(dayId)
  await ensureDayFreeTimeBlocks(dayId, dateStr)
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const timeline = buildTimeline(instances, freeTimes)
  if (timeline.length === 0) return defaultFirstSlotOnDay(dateStr)
  return timelineEndMs(dateStr, timeline, instances, freeTimes)
}

async function resolveInsertPlacement(
  dayId: string,
  durationMin: number,
  at?: FreeSlotInsert
): Promise<{ sortOrder: number; scheduledStartMs: number; at?: FreeSlotInsert }> {
  if (!at) {
    return {
      sortOrder: await nextTimelineSortOrder(dayId),
      scheduledStartMs: await plannedStartForNewInstance(dayId),
    }
  }
  const free = await db.dayFreeTimes.get(at.freeId)
  if (!free || free.dayId !== dayId) throw new Error('Free slot not found')
  await shiftTimelineSortOrdersFrom(dayId, free.sortOrder)
  await shrinkFreeBlockForInsert(at.freeId, durationMin)
  return { sortOrder: free.sortOrder, scheduledStartMs: at.scheduledStartMs, at }
}

async function normalizeDayTimeline(dayId: string, dateStr: string): Promise<void> {
  await normalizeSplitGroups(dayId, dateStr)
  await normalizeDayTimelineToWindow(dayId, dateStr)
}

async function finalizeNewInstancePlacement(
  dayId: string,
  instanceId: string,
  at?: FreeSlotInsert
): Promise<void> {
  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
  if (at) await applyInstanceScheduledStartChange(instanceId, at.scheduledStartMs)
}

// ─── Add instances ────────────────────────────────────────────────────────────

export async function addInstanceFromTemplate(
  templateId: string,
  dayId: string,
  at?: FreeSlotInsert
): Promise<string> {
  const template = await getTemplate(templateId)
  if (!template) throw new Error('Template not found')
  const templateItems = await listTemplateItems(templateId)
  const { sortOrder, scheduledStartMs, at: slot } = await resolveInsertPlacement(dayId, template.defaultDurationMin, at)
  const instanceId = newId()
  const ts = now()

  const instance: DayInstance = {
    id: instanceId,
    dayId,
    sourceTemplateId: templateId,
    title: template.title,
    durationMin: template.defaultDurationMin,
    sortOrder,
    scheduledStartMs,
    addedAt: ts,
    collapsed: true,
    updatedAt: ts,
  }

  const idMap = new Map<string, string>()
  const tops = templateItems.filter((ti) => !ti.parentItemId)
  const subs = templateItems.filter((ti) => ti.parentItemId)

  await db.transaction('rw', [db.dayInstances, db.dayInstanceItems, db.syncQueue], async () => {
    await db.dayInstances.add(instance)
    await enqueueSync('create', 'dayInstance', instanceId)

    for (const ti of [...tops, ...subs]) {
      const newItemId = newId()
      idMap.set(ti.id, newItemId)
      const item: DayInstanceItem = {
        id: newItemId,
        instanceId,
        parentItemId: ti.parentItemId ? idMap.get(ti.parentItemId) : undefined,
        title: ti.title,
        completed: false,
        sortOrder: ti.sortOrder,
        durationMin: 0,
        updatedAt: now(),
      }
      await db.dayInstanceItems.add(item)
      await enqueueSync('create', 'dayInstanceItem', newItemId)
    }
  })

  await finalizeNewInstancePlacement(dayId, instanceId, slot)
  return instanceId
}

export async function addAdHocInstance(
  dayId: string,
  title: string,
  durationMin = 15,
  at?: FreeSlotInsert
): Promise<string> {
  const { sortOrder, scheduledStartMs, at: slot } = await resolveInsertPlacement(dayId, durationMin, at)
  const instanceId = newId()
  const ts = now()

  const instance: DayInstance = {
    id: instanceId,
    dayId,
    title,
    durationMin,
    sortOrder,
    scheduledStartMs,
    addedAt: ts,
    collapsed: true,
    updatedAt: ts,
  }

  await db.dayInstances.add(instance)
  await enqueueSync('create', 'dayInstance', instanceId)

  await finalizeNewInstancePlacement(dayId, instanceId, slot)
  return instanceId
}

export async function addInstanceFromTaskList(
  taskListId: string,
  dayId: string,
  durationMin: number,
  at?: FreeSlotInsert
): Promise<string> {
  const taskList = await getTaskList(taskListId)
  if (!taskList) throw new Error('Task list not found')

  const openItems = await listTaskListItems(taskListId)
  const packed = packTasksForSession(openItems, durationMin)
  const { sortOrder, scheduledStartMs, at: slot } = await resolveInsertPlacement(dayId, durationMin, at)
  const instanceId = newId()
  const ts = now()

  const instance: DayInstance = {
    id: instanceId,
    dayId,
    sourceTaskListId: taskListId,
    title: taskList.title,
    durationMin,
    sortOrder,
    scheduledStartMs,
    addedAt: ts,
    collapsed: true,
    updatedAt: ts,
  }

  await db.transaction('rw', [db.dayInstances, db.dayInstanceItems, db.syncQueue], async () => {
    await db.dayInstances.add(instance)
    await enqueueSync('create', 'dayInstance', instanceId)

    for (let i = 0; i < packed.length; i++) {
      const task = packed[i]
      const itemId = newId()
      const item: DayInstanceItem = {
        id: itemId,
        instanceId,
        sourceTaskListItemId: task.id,
        title: task.title,
        durationMin: task.durationMin,
        deadline: task.deadline,
        completed: false,
        sortOrder: i,
        updatedAt: now(),
      }
      await db.dayInstanceItems.add(item)
      await enqueueSync('create', 'dayInstanceItem', itemId)
    }
  })

  await finalizeNewInstancePlacement(dayId, instanceId, slot)
  return instanceId
}

// ─── Update / delete instances ────────────────────────────────────────────────

export async function startInstanceNow(id: string): Promise<void> {
  const ts = now()
  await db.dayInstances.update(id, { timerStartedAt: ts, updatedAt: ts })
  await enqueueSync('update', 'dayInstance', id)
}

export async function updateInstance(
  id: string,
  patch: Partial<
    Pick<
      DayInstance,
      | 'title'
      | 'durationMin'
      | 'sortOrder'
      | 'noteJson'
      | 'collapsed'
      | 'addedAt'
      | 'scheduledStartMs'
      | 'timerStartedAt'
      | 'altGroupId'
    >
  >
): Promise<void> {
  const existing = await db.dayInstances.get(id)
  if (!existing) return

  const updated: DayInstance = {
    ...existing,
    updatedAt: now(),
  }
  if ('title' in patch) updated.title = patch.title!
  if ('durationMin' in patch) updated.durationMin = patch.durationMin!
  if ('sortOrder' in patch) updated.sortOrder = patch.sortOrder!
  if ('noteJson' in patch) updated.noteJson = patch.noteJson
  if ('collapsed' in patch) updated.collapsed = patch.collapsed!
  if ('addedAt' in patch && patch.addedAt != null) updated.addedAt = patch.addedAt
  if ('scheduledStartMs' in patch && patch.scheduledStartMs != null) updated.scheduledStartMs = patch.scheduledStartMs
  if ('timerStartedAt' in patch) updated.timerStartedAt = patch.timerStartedAt
  if ('altGroupId' in patch) updated.altGroupId = patch.altGroupId

  await db.dayInstances.put(updated)
  await enqueueSync('update', 'dayInstance', id)

  if (patch.durationMin !== undefined) {
    const dateStr = await getDayDate(existing.dayId)
    await ensureDayFreeTimeBlocks(existing.dayId, dateStr)
    await normalizeDayTimeline(existing.dayId, dateStr)
    await syncInstanceStartsFromChain(existing.dayId, dateStr)
  }
}

export async function deleteInstance(id: string): Promise<void> {
  const inst = await db.dayInstances.get(id)
  if (!inst) return

  const items = await db.dayInstanceItems.where('instanceId').equals(id).toArray()
  await db.transaction('rw', [db.dayInstances, db.dayInstanceItems, db.syncQueue], async () => {
    for (const item of items) {
      await db.dayInstanceItems.delete(item.id)
      await enqueueSync('delete', 'dayInstanceItem', item.id)
    }
    await db.dayInstances.delete(id)
    await enqueueSync('delete', 'dayInstance', id)
  })

  if (inst.dayId) {
    if (inst.altGroupId) await dissolveAltGroupIfSingleton(inst.dayId, inst.altGroupId)
    const dateStr = await getDayDate(inst.dayId)
    await rescheduleDayTimeline(inst.dayId, dateStr)
  }
}

export async function resetInstance(id: string): Promise<{
  items: DayInstanceItem[]
  addedAt: number
  timerStartedAt?: number
}> {
  const inst = await db.dayInstances.get(id)
  if (!inst) throw new Error('Instance not found')

  const items = await listInstanceItems(id)
  const prevAddedAt = inst.addedAt
  const prevTimerStartedAt = inst.timerStartedAt
  const ts = now()

  await db.transaction('rw', [db.dayInstances, db.dayInstanceItems, db.syncQueue], async () => {
    await db.dayInstances.update(id, { addedAt: ts, timerStartedAt: undefined, updatedAt: ts })
    await enqueueSync('update', 'dayInstance', id)
    for (const item of items) {
      await db.dayInstanceItems.update(item.id, { completed: false, updatedAt: ts })
      await enqueueSync('update', 'dayInstanceItem', item.id)
    }
  })

  return {
    items: items.map((i) => ({ ...i, completed: false })),
    addedAt: prevAddedAt,
    timerStartedAt: prevTimerStartedAt,
  }
}

export async function restoreInstanceReset(
  id: string,
  items: DayInstanceItem[],
  addedAt: number,
  timerStartedAt?: number
): Promise<void> {
  await db.transaction('rw', [db.dayInstances, db.dayInstanceItems, db.syncQueue], async () => {
    await db.dayInstances.update(id, {
      addedAt,
      timerStartedAt,
      updatedAt: now(),
    })
    await enqueueSync('update', 'dayInstance', id)
    for (const item of items) {
      await db.dayInstanceItems.update(item.id, { completed: item.completed, updatedAt: now() })
      await enqueueSync('update', 'dayInstanceItem', item.id)
    }
  })
}

/** Restore a day instance snapshot (for undo). */
export async function restoreDayInstance(instance: DayInstance): Promise<void> {
  await db.dayInstances.put({ ...instance, updatedAt: now() })
  await enqueueSync('update', 'dayInstance', instance.id)
}

/** Restore day instance items snapshot (for undo). */
export async function restoreDayInstanceItems(items: DayInstanceItem[]): Promise<void> {
  if (!items.length) return
  await db.transaction('rw', [db.dayInstanceItems, db.syncQueue], async () => {
    for (const item of items) {
      await db.dayInstanceItems.put({ ...item, updatedAt: now() })
      await enqueueSync('update', 'dayInstanceItem', item.id)
    }
  })
}

// ─── Instance items ───────────────────────────────────────────────────────────

export async function toggleInstanceItem(id: string, completed: boolean): Promise<void> {
  const item = await db.dayInstanceItems.get(id)
  if (!item) return

  const instanceItems = await listInstanceItems(item.instanceId)
  const appItem = instanceItems.find((i) => i.id === id)
  if (!appItem) return

  const descendantIds = collectDescendantIds(instanceItems, id)
  const idsToUpdate = descendantIds.length > 0 ? descendantIds : [id]
  const ts = now()

  await db.transaction('rw', [db.dayInstanceItems, db.syncQueue], async () => {
    for (const itemId of idsToUpdate) {
      await db.dayInstanceItems.update(itemId, { completed, updatedAt: ts })
      await enqueueSync('update', 'dayInstanceItem', itemId)
    }
  })

  for (const itemId of idsToUpdate) {
    const row = instanceItems.find((i) => i.id === itemId)
    if (row?.sourceTaskListItemId) {
      if (completed) {
        await completeTaskListItem(row.sourceTaskListItemId)
      } else {
        await restoreTaskListItem(row.sourceTaskListItemId)
      }
    }
  }
}

export async function addInstanceItem(
  instanceId: string,
  title: string,
  parentItemId?: string
): Promise<DayInstanceItem> {
  const siblings = await db.dayInstanceItems
    .where('instanceId')
    .equals(instanceId)
    .filter((i) => (i.parentItemId ?? undefined) === parentItemId)
    .toArray()
  const sortOrder = siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0

  const item: DayInstanceItem = {
    id: newId(),
    instanceId,
    parentItemId,
    title,
    completed: false,
    sortOrder,
    durationMin: 0,
    updatedAt: now(),
  }
  await db.dayInstanceItems.add(item)
  await enqueueSync('create', 'dayInstanceItem', item.id)
  return item
}

export async function addInstanceItemAfter(
  instanceId: string,
  afterItemId: string,
  title = ''
): Promise<DayInstanceItem> {
  const after = await db.dayInstanceItems.get(afterItemId)
  if (!after) return addInstanceItem(instanceId, title)

  const parentItemId = after.parentItemId
  const insertAt = after.sortOrder + 1

  const toShift = await db.dayInstanceItems
    .where('instanceId')
    .equals(instanceId)
    .filter((i) => (i.parentItemId ?? undefined) === (parentItemId ?? undefined) && i.sortOrder >= insertAt)
    .toArray()

  const itemId = newId()
  const item: DayInstanceItem = {
    id: itemId,
    instanceId,
    parentItemId,
    title,
    completed: false,
    sortOrder: insertAt,
    durationMin: 0,
    updatedAt: now(),
  }

  await db.transaction('rw', [db.dayInstanceItems, db.syncQueue], async () => {
    const ts = now()
    for (const s of toShift) {
      await db.dayInstanceItems.update(s.id, { sortOrder: s.sortOrder + 1, updatedAt: ts })
      await enqueueSync('update', 'dayInstanceItem', s.id)
    }
    await db.dayInstanceItems.add(item)
    await enqueueSync('create', 'dayInstanceItem', itemId)
  })

  return item
}

export async function reparentInstanceItem(itemId: string, newParentId?: string): Promise<void> {
  const item = await db.dayInstanceItems.get(itemId)
  if (!item) return
  if ((item.parentItemId ?? undefined) === newParentId) return

  const allItems = await listInstanceItems(item.instanceId)
  if (newParentId && !canReparentUnder(allItems, itemId, newParentId)) return

  const newSiblings = allItems.filter(
    (i) => i.id !== itemId && (i.parentItemId ?? undefined) === newParentId
  )
  const newSortOrder = newSiblings.length ? Math.max(...newSiblings.map((s) => s.sortOrder)) + 1 : 0

  await db.dayInstanceItems.update(itemId, {
    parentItemId: newParentId,
    sortOrder: newSortOrder,
    updatedAt: now(),
  })
  await enqueueSync('update', 'dayInstanceItem', itemId)
}

export async function updateInstanceItem(
  id: string,
  patch: Partial<Pick<DayInstanceItem, 'title' | 'durationMin' | 'deadline' | 'sortOrder' | 'completed' | 'parentItemId'>>
): Promise<void> {
  if ('parentItemId' in patch) await reparentInstanceItem(id, patch.parentItemId)

  const { parentItemId: _p, ...rest } = patch
  if (Object.keys(rest).length > 0) {
    const item = await db.dayInstanceItems.get(id)
    if (!item) return

    const updated: DayInstanceItem = { ...item, updatedAt: now() }
    if ('title' in rest) updated.title = rest.title!
    if ('durationMin' in rest) updated.durationMin = rest.durationMin
    if ('deadline' in rest) updated.deadline = rest.deadline
    if ('sortOrder' in rest) updated.sortOrder = rest.sortOrder!
    if ('completed' in rest) updated.completed = rest.completed!

    await db.dayInstanceItems.put(updated)
    await enqueueSync('update', 'dayInstanceItem', id)

    if (item.sourceTaskListItemId) {
      await syncDayInstanceItemToTaskList(item.sourceTaskListItemId, {
        title: rest.title,
        durationMin: rest.durationMin,
        ...('deadline' in rest ? { deadline: rest.deadline } : {}),
      })
    }
  }
}

export async function deleteInstanceItem(id: string): Promise<void> {
  const children = await db.dayInstanceItems.where('parentItemId').equals(id).toArray()
  await db.transaction('rw', [db.dayInstanceItems, db.syncQueue], async () => {
    for (const child of children) {
      await db.dayInstanceItems.delete(child.id)
      await enqueueSync('delete', 'dayInstanceItem', child.id)
    }
    await db.dayInstanceItems.delete(id)
    await enqueueSync('delete', 'dayInstanceItem', id)
  })
}

export async function setInstanceItemSortOrders(ids: string[]): Promise<void> {
  const ts = now()
  await db.transaction('rw', [db.dayInstanceItems, db.syncQueue], async () => {
    for (let sortOrder = 0; sortOrder < ids.length; sortOrder++) {
      await db.dayInstanceItems.update(ids[sortOrder], { sortOrder, updatedAt: ts })
      await enqueueSync('update', 'dayInstanceItem', ids[sortOrder])
    }
  })
}

export async function applyInstanceItemTree(
  instanceId: string,
  structure: ItemTreeStructureRow[]
): Promise<void> {
  const allItems = await listInstanceItems(instanceId)
  const ts = now()
  await db.transaction('rw', [db.dayInstanceItems, db.syncQueue], async () => {
    for (const row of structure) {
      if (row.parentItemId && !canReparentUnder(allItems, row.id, row.parentItemId)) continue
      await db.dayInstanceItems.update(row.id, {
        parentItemId: row.parentItemId,
        sortOrder: row.sortOrder,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayInstanceItem', row.id)
    }
  })
}

// ─── Timeline normalization ───────────────────────────────────────────────────

export async function ensureDayFreeTimeBlocks(dayId: string, dateStr: string): Promise<void> {
  const count = await db.dayFreeTimes.where('dayId').equals(dayId).count()
  if (count > 0) return

  const instances = await listDayInstances(dayId)
  if (!instances.length) return

  const rows = materializeTimelineRows(dateStr, instances)
  let sortOrder = 0

  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    for (const row of rows) {
      if (row.kind === 'free') {
        const freeId = newId()
        const free: DayFreeTime = {
          id: freeId,
          dayId,
          sortOrder,
          durationMin: row.durationMin,
          updatedAt: now(),
        }
        await db.dayFreeTimes.add(free)
        await enqueueSync('create', 'dayFreeTime', freeId)
        sortOrder++
      } else {
        await db.dayInstances.update(row.instanceId, { sortOrder, updatedAt: now() })
        await enqueueSync('update', 'dayInstance', row.instanceId)
        sortOrder++
      }
    }
  })

  await normalizeDayTimeline(dayId, dateStr)
}

export async function reconcileDayTimeline(dayId: string, dateStr: string): Promise<void> {
  await ensureDayFreeTimeBlocks(dayId, dateStr)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

async function syncInstanceStartsFromChain(dayId: string, dateStr: string): Promise<void> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const timeline = buildTimeline(instances, freeTimes)
  const { instanceStarts } = chainTimelineFromDayStart(dateStr, timeline, instances, freeTimes)
  await Promise.all(
    [...instanceStarts.entries()].map(([id, scheduledStartMs]) =>
      updateInstance(id, { scheduledStartMs })
    )
  )
}

async function normalizeSplitGroups(dayId: string, _dateStr: string): Promise<void> {
  let instances = await listDayInstances(dayId)
  let freeTimes = await listDayFreeTimes(dayId)
  const groupIds = [...new Set(instances.filter((i) => i.altGroupId).map((i) => i.altGroupId!))]

  for (const groupId of groupIds) {
    const columns = buildSplitColumns(instances, freeTimes, groupId)
    const rowMin = splitRowMinutes(columns)
    const groupSortOrder = instances.find((i) => i.altGroupId === groupId)?.sortOrder ?? 0

    for (const col of columns) {
      const last = col.items[col.items.length - 1]
      const contentMin = last?.kind === 'free'
        ? col.totalMinutes - last.free.durationMin
        : col.totalMinutes
      const deficit = rowMin - contentMin
      if (deficit <= 0) {
        if (last?.kind === 'free' && last.free.altGroupId === groupId) {
          await db.dayFreeTimes.delete(last.free.id)
          await enqueueSync('delete', 'dayFreeTime', last.free.id)
          freeTimes = freeTimes.filter((f) => f.id !== last.free.id)
        }
        continue
      }

      if (last?.kind === 'free' && last.free.altGroupId === groupId) {
        await db.dayFreeTimes.update(last.free.id, { durationMin: deficit, updatedAt: now() })
        await enqueueSync('update', 'dayFreeTime', last.free.id)
      } else {
        const maxStack = col.items.length
          ? Math.max(
              ...col.items.map((item) =>
                item.kind === 'instance'
                  ? (item.instance.altStackIndex ?? 0)
                  : (item.free.altStackIndex ?? 0)
              )
            ) + 1
          : 0
        const newFreeId = newId()
        const newFree: DayFreeTime = {
          id: newFreeId,
          dayId,
          sortOrder: groupSortOrder,
          altGroupId: groupId,
          altGroupIndex: col.columnIndex,
          altStackIndex: maxStack,
          durationMin: deficit,
          updatedAt: now(),
        }
        await db.dayFreeTimes.add(newFree)
        await enqueueSync('create', 'dayFreeTime', newFreeId)
        freeTimes = [...freeTimes, newFree]
      }
    }
    instances = await listDayInstances(dayId)
    freeTimes = await listDayFreeTimes(dayId)
  }
}

async function normalizeDayTimelineToWindow(dayId: string, _dateStr: string): Promise<void> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const timeline = buildTimeline(instances, freeTimes)
  if (timeline.length === 0) return

  const delta = DAY_WINDOW_MINUTES - timelineTotalMinutes(timeline, instances, freeTimes)
  if (delta === 0) return

  const display = groupTimelineForDisplay(timeline, instances, freeTimes)

  if (delta > 0) {
    const last = display[display.length - 1]
    if (last.kind === 'free' && !last.free.altGroupId) {
      await db.dayFreeTimes.update(last.free.id, {
        durationMin: last.free.durationMin + delta,
        updatedAt: now(),
      })
      await enqueueSync('update', 'dayFreeTime', last.free.id)
    } else {
      const maxSortOrder = Math.max(
        ...instances.map((i) => i.sortOrder),
        ...freeTimes.map((f) => f.sortOrder),
        -1
      )
      const freeId = newId()
      const free: DayFreeTime = {
        id: freeId,
        dayId,
        sortOrder: maxSortOrder + 1,
        durationMin: delta,
        updatedAt: now(),
      }
      await db.dayFreeTimes.add(free)
      await enqueueSync('create', 'dayFreeTime', freeId)
    }
    return
  }

  let remaining = -delta
  const toDelete: string[] = []
  const updates: Array<{ id: string; durationMin: number }> = []

  for (let i = display.length - 1; i >= 0 && remaining > 0; i--) {
    const entry = display[i]
    if (entry.kind !== 'free' || entry.free.altGroupId) continue
    const shrink = Math.min(entry.free.durationMin, remaining)
    const newDur = entry.free.durationMin - shrink
    remaining -= shrink
    if (newDur <= 0) toDelete.push(entry.free.id)
    else updates.push({ id: entry.free.id, durationMin: newDur })
  }

  await db.transaction('rw', [db.dayFreeTimes, db.syncQueue], async () => {
    for (const id of toDelete) {
      await db.dayFreeTimes.delete(id)
      await enqueueSync('delete', 'dayFreeTime', id)
    }
    const ts = now()
    for (const u of updates) {
      await db.dayFreeTimes.update(u.id, { durationMin: u.durationMin, updatedAt: ts })
      await enqueueSync('update', 'dayFreeTime', u.id)
    }
  })
}

// ─── Alt groups (split columns) ───────────────────────────────────────────────

async function dissolveAltGroupIfSingleton(dayId: string, altGroupId: string): Promise<void> {
  const members = (await listDayInstances(dayId)).filter((i) => i.altGroupId === altGroupId)
  if (members.length !== 1) return

  const memberId = members[0].id
  await db.dayInstances.update(memberId, {
    altGroupId: undefined,
    altGroupIndex: undefined,
    altStackIndex: undefined,
    updatedAt: now(),
  })
  await enqueueSync('update', 'dayInstance', memberId)

  const splitFree = await db.dayFreeTimes.filter((f) => f.altGroupId === altGroupId).toArray()
  if (splitFree.length) {
    await db.transaction('rw', [db.dayFreeTimes, db.syncQueue], async () => {
      for (const f of splitFree) {
        await db.dayFreeTimes.delete(f.id)
        await enqueueSync('delete', 'dayFreeTime', f.id)
      }
    })
  }
}

async function shiftSplitColumnsFrom(dayId: string, altGroupId: string, fromColumn: number, delta: number): Promise<void> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const ts = now()
  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    for (const i of instances.filter(
      (inst) => inst.altGroupId === altGroupId && (inst.altGroupIndex ?? 0) >= fromColumn
    )) {
      await db.dayInstances.update(i.id, {
        altGroupIndex: (i.altGroupIndex ?? 0) + delta,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayInstance', i.id)
    }
    for (const f of freeTimes.filter(
      (ft) => ft.altGroupId === altGroupId && (ft.altGroupIndex ?? 0) >= fromColumn
    )) {
      await db.dayFreeTimes.update(f.id, {
        altGroupIndex: (f.altGroupIndex ?? 0) + delta,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayFreeTime', f.id)
    }
  })
}

export async function linkInstancesAsAlternatives(aId: string, bId: string, side: 'left' | 'right'): Promise<void> {
  if (aId === bId) return
  const a = await db.dayInstances.get(aId)
  const b = await db.dayInstances.get(bId)
  if (!a || !b || a.dayId !== b.dayId) return

  const dayId = a.dayId
  const groupId = b.altGroupId ?? a.altGroupId ?? newId()
  const targetSort = Math.min(a.sortOrder, b.sortOrder)
  const removeSort = Math.max(a.sortOrder, b.sortOrder)

  let newColForA: number
  let bCol = b.altGroupIndex ?? 0
  let bStack = b.altStackIndex ?? 0

  if (!b.altGroupId) {
    if (side === 'right') { bCol = 0; bStack = 0; newColForA = 1 }
    else { bCol = 1; bStack = 0; newColForA = 0 }
  } else {
    const anchorCol = b.altGroupIndex ?? 0
    newColForA = side === 'left' ? anchorCol : anchorCol + 1
    await shiftSplitColumnsFrom(dayId, groupId, newColForA, 1)
  }

  if (a.sortOrder !== b.sortOrder) await shiftTimelineSortOrdersFrom(dayId, removeSort + 1, -1)

  const ts = now()
  await db.transaction('rw', [db.dayInstances, db.syncQueue], async () => {
    await db.dayInstances.update(bId, {
      altGroupId: groupId,
      altGroupIndex: bCol,
      altStackIndex: bStack,
      sortOrder: targetSort,
      updatedAt: ts,
    })
    await enqueueSync('update', 'dayInstance', bId)
    await db.dayInstances.update(aId, {
      altGroupId: groupId,
      altGroupIndex: newColForA,
      altStackIndex: 0,
      sortOrder: targetSort,
      updatedAt: ts,
    })
    await enqueueSync('update', 'dayInstance', aId)
  })

  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

export async function stackInstanceInColumn(aId: string, bId: string): Promise<void> {
  if (aId === bId) return
  const a = await db.dayInstances.get(aId)
  const b = await db.dayInstances.get(bId)
  if (!a || !b || a.dayId !== b.dayId) return

  const dayId = a.dayId
  const groupId = b.altGroupId ?? newId()
  const targetSort = Math.min(a.sortOrder, b.sortOrder)
  const removeSort = Math.max(a.sortOrder, b.sortOrder)
  const bCol = b.altGroupIndex ?? 0
  const insertStack = (b.altStackIndex ?? 0) + 1

  const allInstances = await listDayInstances(dayId)
  const allFree = await listDayFreeTimes(dayId)

  if (a.sortOrder !== b.sortOrder) await shiftTimelineSortOrdersFrom(dayId, removeSort + 1, -1)

  const ts = now()
  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    if (!b.altGroupId) {
      await db.dayInstances.update(bId, {
        altGroupId: groupId,
        altGroupIndex: 0,
        altStackIndex: 0,
        sortOrder: targetSort,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayInstance', bId)
    }

    for (const i of allInstances.filter(
      (inst) =>
        inst.id !== aId &&
        inst.altGroupId === groupId &&
        (inst.altGroupIndex ?? 0) === bCol &&
        (inst.altStackIndex ?? 0) >= insertStack
    )) {
      await db.dayInstances.update(i.id, {
        altStackIndex: (i.altStackIndex ?? 0) + 1,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayInstance', i.id)
    }
    for (const f of allFree.filter(
      (ft) =>
        ft.altGroupId === groupId &&
        (ft.altGroupIndex ?? 0) === bCol &&
        (ft.altStackIndex ?? 0) >= insertStack
    )) {
      await db.dayFreeTimes.update(f.id, {
        altStackIndex: (f.altStackIndex ?? 0) + 1,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayFreeTime', f.id)
    }

    await db.dayInstances.update(aId, {
      altGroupId: groupId,
      altGroupIndex: bCol,
      altStackIndex: insertStack,
      sortOrder: targetSort,
      updatedAt: ts,
    })
    await enqueueSync('update', 'dayInstance', aId)
  })

  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

export async function unlinkInstanceFromAltGroup(instanceId: string): Promise<void> {
  const inst = await db.dayInstances.get(instanceId)
  if (!inst?.altGroupId) return

  const dayId = inst.dayId
  const altGroupId = inst.altGroupId
  const insertAt = inst.sortOrder + 1

  await shiftTimelineSortOrdersFrom(dayId, insertAt, 1)
  await db.dayInstances.update(instanceId, {
    altGroupId: undefined,
    altGroupIndex: undefined,
    altStackIndex: undefined,
    sortOrder: insertAt,
    updatedAt: now(),
  })
  await enqueueSync('update', 'dayInstance', instanceId)

  const remaining = (await listDayInstances(dayId))
    .filter((i) => i.altGroupId === altGroupId && i.id !== instanceId)
    .sort((a, b) => {
      const col = (a.altGroupIndex ?? 0) - (b.altGroupIndex ?? 0)
      if (col !== 0) return col
      return (a.altStackIndex ?? 0) - (b.altStackIndex ?? 0)
    })

  const ts = now()
  await db.transaction('rw', [db.dayInstances, db.syncQueue], async () => {
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i]
      const col = r.altGroupIndex ?? 0
      const stackInCol = remaining.filter((x) => (x.altGroupIndex ?? 0) === col).indexOf(r)
      await db.dayInstances.update(r.id, {
        altGroupIndex: col,
        altStackIndex: stackInCol,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayInstance', r.id)
    }
  })

  await dissolveAltGroupIfSingleton(dayId, altGroupId)

  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

export async function clearFreeBlockAltGroup(freeId: string): Promise<void> {
  const free = await db.dayFreeTimes.get(freeId)
  if (!free?.altGroupId) return
  await db.dayFreeTimes.update(freeId, {
    altGroupId: undefined,
    altGroupIndex: undefined,
    altStackIndex: undefined,
    updatedAt: now(),
  })
  await enqueueSync('update', 'dayFreeTime', freeId)
}

// ─── Timeline ordering ────────────────────────────────────────────────────────

export async function applyFlatTimelineOrder(
  dateStr: string,
  dayId: string,
  orderedIds: string[],
  instances: DayInstance[]
): Promise<void> {
  let sortOrder = 0
  let i = 0
  const ts = now()

  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    while (i < orderedIds.length) {
      const id = orderedIds[i]
      if (isFreeTimelineDragId(id)) {
        const freeId = parseTimelineDragId(id).id
        await db.dayFreeTimes.update(freeId, { sortOrder, updatedAt: ts })
        await enqueueSync('update', 'dayFreeTime', freeId)
        sortOrder++
        i++
        continue
      }

      const inst = instances.find((x) => x.id === id)
      if (!inst) { i++; continue }

      const altGroupId = inst.altGroupId
      if (altGroupId) {
        const memberIds: string[] = []
        while (i < orderedIds.length) {
          const nextId = orderedIds[i]
          if (isFreeTimelineDragId(nextId)) break
          const next = instances.find((x) => x.id === nextId)
          if (!next || next.altGroupId !== altGroupId) break
          memberIds.push(nextId)
          i++
        }
        for (const mid of memberIds) {
          await db.dayInstances.update(mid, { sortOrder, updatedAt: ts })
          await enqueueSync('update', 'dayInstance', mid)
        }
        sortOrder++
      } else {
        await db.dayInstances.update(id, { sortOrder, updatedAt: ts })
        await enqueueSync('update', 'dayInstance', id)
        sortOrder++
        i++
      }
    }
  })

  await syncInstanceStartsFromChain(dayId, dateStr)
  await normalizeDayTimeline(dayId, dateStr)
}

export async function applyDayTimelineOrder(
  dateStr: string,
  dayId: string,
  dragIds: string[],
  _instances: DayInstance[],
  freeTimes: DayFreeTime[]
): Promise<void> {
  const freeById = new Map(freeTimes.map((f) => [f.id, { ...f }]))
  const { dragIds: mergedIds, mergedAway, durationUpdates } = mergeAdjacentFreeDragIds(dragIds, freeById)

  const ts = now()
  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    for (const id of mergedAway) {
      await db.dayFreeTimes.delete(id)
      await enqueueSync('delete', 'dayFreeTime', id)
    }
    for (const [id, durationMin] of durationUpdates.entries()) {
      await db.dayFreeTimes.update(id, { durationMin, updatedAt: ts })
      await enqueueSync('update', 'dayFreeTime', id)
    }

    for (let sortOrder = 0; sortOrder < mergedIds.length; sortOrder++) {
      const parsed = parseTimelineDragId(mergedIds[sortOrder])
      if (parsed.kind === 'free') {
        await db.dayFreeTimes.update(parsed.id, { sortOrder, updatedAt: ts })
        await enqueueSync('update', 'dayFreeTime', parsed.id)
      } else if (parsed.kind === 'alternative') {
        const members = await db.dayInstances
          .where('dayId')
          .equals(dayId)
          .filter((inst) => inst.altGroupId === parsed.id)
          .toArray()
        for (const m of members) {
          await db.dayInstances.update(m.id, { sortOrder, updatedAt: ts })
          await enqueueSync('update', 'dayInstance', m.id)
        }
      } else {
        await db.dayInstances.update(parsed.id, { sortOrder, updatedAt: ts })
        await enqueueSync('update', 'dayInstance', parsed.id)
      }
    }
  })

  await syncInstanceStartsFromChain(dayId, dateStr)
}

async function rescheduleDayTimeline(dayId: string, dateStr: string): Promise<void> {
  await ensureDayFreeTimeBlocks(dayId, dateStr)
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const dragIds = timelineToDragRows(buildTimeline(instances, freeTimes), instances, freeTimes).map((r) => r.id)
  await applyDayTimelineOrder(dateStr, dayId, dragIds, instances, freeTimes)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

export async function applyInstanceScheduledStartChange(instanceId: string, newStartMs: number): Promise<void> {
  const inst = await db.dayInstances.get(instanceId)
  if (!inst) return

  const dayId = inst.dayId
  const dateStr = await getDayDate(dayId)
  await ensureDayFreeTimeBlocks(dayId, dateStr)

  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const timeline = buildTimeline(instances, freeTimes)
  const index = timeline.findIndex((e) => e.kind === 'instance' && e.instance.id === instanceId)
  if (index < 0) return

  const { instanceStarts } = chainTimelineFromDayStart(dateStr, timeline, instances, freeTimes)
  const oldStartMs = instanceStarts.get(instanceId) ?? inst.scheduledStartMs
  const deltaMs = newStartMs - oldStartMs
  const deltaMin = Math.round(deltaMs / 60_000)
  if (deltaMin === 0) return

  const overlapTarget = findInstanceContainingStartTime(instanceId, newStartMs, instances, instanceStarts)
  if (overlapTarget) {
    const alreadyParallel =
      inst.altGroupId &&
      overlapTarget.altGroupId &&
      inst.altGroupId === overlapTarget.altGroupId &&
      (inst.altGroupIndex ?? 0) !== (overlapTarget.altGroupIndex ?? 0)
    if (!alreadyParallel) {
      if (inst.altGroupId) await unlinkInstanceFromAltGroup(instanceId)
      await linkInstancesAsAlternatives(instanceId, overlapTarget.id, 'right')
      return
    }
  }

  const prev = index > 0 ? timeline[index - 1] : undefined

  if (deltaMin > 0) {
    if (prev?.kind === 'free') {
      await db.dayFreeTimes.update(prev.free.id, {
        durationMin: prev.free.durationMin + deltaMin,
        updatedAt: now(),
      })
      await enqueueSync('update', 'dayFreeTime', prev.free.id)
    } else {
      const target = timeline[index]
      const sortOrder = target.kind === 'instance' ? target.instance.sortOrder : inst.sortOrder
      await insertFreeBlockAtSortOrder(dayId, sortOrder, deltaMin)
    }
  } else {
    const shrinkBy = -deltaMin
    if (prev?.kind === 'free') {
      const nextDur = prev.free.durationMin - shrinkBy
      if (nextDur <= 0) {
        await db.dayFreeTimes.delete(prev.free.id)
        await enqueueSync('delete', 'dayFreeTime', prev.free.id)
      } else {
        await db.dayFreeTimes.update(prev.free.id, { durationMin: nextDur, updatedAt: now() })
        await enqueueSync('update', 'dayFreeTime', prev.free.id)
      }
    }
  }

  await syncInstanceStartsFromChain(dayId, dateStr)
}

async function insertFreeBlockAtSortOrder(dayId: string, sortOrder: number, durationMin: number): Promise<void> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const ts = now()

  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    for (const i of instances.filter((inst) => inst.sortOrder >= sortOrder)) {
      await db.dayInstances.update(i.id, { sortOrder: i.sortOrder + 1, updatedAt: ts })
      await enqueueSync('update', 'dayInstance', i.id)
    }
    for (const f of freeTimes.filter((ft) => ft.sortOrder >= sortOrder)) {
      await db.dayFreeTimes.update(f.id, { sortOrder: f.sortOrder + 1, updatedAt: ts })
      await enqueueSync('update', 'dayFreeTime', f.id)
    }

    const freeId = newId()
    const free: DayFreeTime = {
      id: freeId,
      dayId,
      sortOrder,
      durationMin,
      updatedAt: ts,
    }
    await db.dayFreeTimes.add(free)
    await enqueueSync('create', 'dayFreeTime', freeId)
  })
}

// ─── Snapshot / restore (undo) ────────────────────────────────────────────────

export type { DayTimelineSnapshot } from '../lib/dayTimelineLayout'
export { snapshotDayTimeline } from '../lib/dayTimelineLayout'

export async function restoreDayTimeline(snapshot: DayTimelineSnapshot): Promise<void> {
  const existingFreeIds = new Set(snapshot.freeTimes.map((f) => f.id))
  const allFree = await db.dayFreeTimes.toArray()
  const toDelete = allFree.filter((f) => !existingFreeIds.has(f.id)).map((f) => f.id)

  await db.transaction('rw', [db.dayInstances, db.dayFreeTimes, db.syncQueue], async () => {
    for (const id of toDelete) {
      await db.dayFreeTimes.delete(id)
      await enqueueSync('delete', 'dayFreeTime', id)
    }

    for (const f of snapshot.freeTimes) {
      const existing = await db.dayFreeTimes.get(f.id)
      if (existing) {
        await db.dayFreeTimes.update(f.id, {
          sortOrder: f.sortOrder,
          durationMin: f.durationMin,
          updatedAt: now(),
        })
        await enqueueSync('update', 'dayFreeTime', f.id)
      } else {
        const firstInst = snapshot.instances[0]
          ? await db.dayInstances.get(snapshot.instances[0].id)
          : undefined
        if (firstInst) {
          const free: DayFreeTime = {
            id: f.id,
            dayId: firstInst.dayId,
            sortOrder: f.sortOrder,
            durationMin: f.durationMin,
            updatedAt: now(),
          }
          await db.dayFreeTimes.add(free)
          await enqueueSync('create', 'dayFreeTime', f.id)
        }
      }
    }

    const ts = now()
    for (const s of snapshot.instances) {
      await db.dayInstances.update(s.id, {
        sortOrder: s.sortOrder,
        scheduledStartMs: s.scheduledStartMs,
        updatedAt: ts,
      })
      await enqueueSync('update', 'dayInstance', s.id)
    }
  })
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = todayDateString()
  if (dateStr === today) return 'Today'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
