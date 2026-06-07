import { db } from '../db/database'
import type { Day, DayFreeTime, DayInstance, DayInstanceItem } from '../db/types'
import { newId, now, todayDateString } from '../lib/ids'
import { collectDescendantIds } from '../lib/completion'
import type { ItemTreeStructureRow } from '../lib/itemTreeMove'
import {
  buildSplitColumns,
  splitRowMinutes,
} from '../lib/daySplitLayout'
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
import { enqueueSync } from '../sync/syncEngine'
import { listTemplateItems, getTemplate } from './templates'
import { completeTaskListItem, getTaskList, listTaskListItems, restoreTaskListItem } from './taskLists'
import { packTasksForSession } from '../lib/packTaskList'
import { syncDayInstanceItemToTaskList } from '../lib/taskListItemSync'

export type FreeSlotInsert = {
  freeId: string
  scheduledStartMs: number
}

async function shiftTimelineSortOrdersFrom(dayId: string, fromSortOrder: number, delta = 1): Promise<void> {
  const t = now()
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  await db.transaction('rw', db.dayFreeTimes, db.dayInstances, async () => {
    for (const i of instances) {
      if (i.sortOrder >= fromSortOrder) {
        await db.dayInstances.update(i.id, { sortOrder: i.sortOrder + delta, updatedAt: t })
      }
    }
    for (const f of freeTimes) {
      if (f.sortOrder >= fromSortOrder) {
        await db.dayFreeTimes.update(f.id, { sortOrder: f.sortOrder + delta, updatedAt: t })
      }
    }
  })
}

async function shrinkFreeBlockForInsert(freeId: string, instanceDurationMin: number): Promise<void> {
  const free = await db.dayFreeTimes.get(freeId)
  if (!free) return
  const newDur = free.durationMin - instanceDurationMin
  const t = now()
  if (newDur <= 0) {
    await db.dayFreeTimes.delete(freeId)
  } else {
    await db.dayFreeTimes.update(freeId, { durationMin: newDur, updatedAt: t })
  }
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
  if (at) {
    await applyInstanceScheduledStartChange(instanceId, at.scheduledStartMs)
  }
}

export async function getOrCreateDay(date: string): Promise<Day> {
  const existing = await db.days.where('date').equals(date).first()
  if (existing) return existing
  const day: Day = { id: newId(), date, updatedAt: now() }
  await db.days.add(day)
  await enqueueSync('create', 'day', day.id)
  return day
}

export async function getDayByDate(date: string): Promise<Day | undefined> {
  return db.days.where('date').equals(date).first()
}

export async function listDayInstances(dayId: string): Promise<DayInstance[]> {
  const list = await db.dayInstances.where('dayId').equals(dayId).toArray()
  return list.sort((a, b) => a.sortOrder - b.sortOrder)
}

async function getDayDate(dayId: string): Promise<string> {
  const day = await db.days.get(dayId)
  return day?.date ?? todayDateString()
}

export async function listDayFreeTimes(dayId: string): Promise<DayFreeTime[]> {
  const list = await db.dayFreeTimes.where('dayId').equals(dayId).toArray()
  return list.sort((a, b) => a.sortOrder - b.sortOrder)
}

async function nextTimelineSortOrder(dayId: string): Promise<number> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const orders = [...instances.map((i) => i.sortOrder), ...freeTimes.map((f) => f.sortOrder)]
  return (orders.length ? Math.max(...orders) : -1) + 1
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

/** One-time: turn computed gaps into movable free-time blocks. */
export async function ensureDayFreeTimeBlocks(dayId: string, dateStr: string): Promise<void> {
  const count = await db.dayFreeTimes.where('dayId').equals(dayId).count()
  if (count > 0) return

  const instances = await listDayInstances(dayId)
  if (!instances.length) return

  const rows = materializeTimelineRows(dateStr, instances)
  const t = now()
  let sortOrder = 0
  const freeToAdd: DayFreeTime[] = []

  await db.transaction('rw', db.dayFreeTimes, db.dayInstances, async () => {
    for (const row of rows) {
      if (row.kind === 'free') {
        freeToAdd.push({
          id: newId(),
          dayId,
          sortOrder,
          durationMin: row.durationMin,
          updatedAt: t,
        })
        sortOrder++
      } else {
        await db.dayInstances.update(row.instanceId, { sortOrder, updatedAt: t })
        sortOrder++
      }
    }
    if (freeToAdd.length) await db.dayFreeTimes.bulkAdd(freeToAdd)
  })

  await normalizeDayTimeline(dayId, dateStr)
}

export async function reconcileDayTimeline(dayId: string, dateStr: string): Promise<void> {
  await ensureDayFreeTimeBlocks(dayId, dateStr)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

export async function listInstanceItems(instanceId: string): Promise<DayInstanceItem[]> {
  const items = await db.dayInstanceItems.where('instanceId').equals(instanceId).toArray()
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function addInstanceFromTemplate(
  templateId: string,
  dayId: string,
  at?: FreeSlotInsert
): Promise<string> {
  const template = await getTemplate(templateId)
  if (!template) throw new Error('Template not found')
  const templateItems = await listTemplateItems(templateId)
  const { sortOrder, scheduledStartMs, at: slot } = await resolveInsertPlacement(
    dayId,
    template.defaultDurationMin,
    at
  )
  const t = now()

  const instance: DayInstance = {
    id: newId(),
    dayId,
    sourceTemplateId: templateId,
    title: template.title,
    durationMin: template.defaultDurationMin,
    sortOrder,
    scheduledStartMs,
    addedAt: t,
    collapsed: true,
    updatedAt: t,
  }

  await db.dayInstances.add(instance)

  const idMap = new Map<string, string>()
  const tops = templateItems.filter((ti) => !ti.parentItemId)
  const subs = templateItems.filter((ti) => ti.parentItemId)
  for (const ti of [...tops, ...subs]) {
    const newItemId = newId()
    idMap.set(ti.id, newItemId)
    const item: DayInstanceItem = {
      id: newItemId,
      instanceId: instance.id,
      parentItemId: ti.parentItemId ? idMap.get(ti.parentItemId) : undefined,
      title: ti.title,
      completed: false,
      sortOrder: ti.sortOrder,
      updatedAt: now(),
    }
    await db.dayInstanceItems.add(item)
    await enqueueSync('create', 'dayInstanceItem', item.id)
  }

  await enqueueSync('create', 'dayInstance', instance.id)
  await finalizeNewInstancePlacement(dayId, instance.id, slot)
  return instance.id
}

export async function addAdHocInstance(
  dayId: string,
  title: string,
  durationMin = 15,
  at?: FreeSlotInsert
): Promise<string> {
  const { sortOrder, scheduledStartMs, at: slot } = await resolveInsertPlacement(dayId, durationMin, at)
  const t = now()
  const instance: DayInstance = {
    id: newId(),
    dayId,
    title,
    durationMin,
    sortOrder,
    scheduledStartMs,
    addedAt: t,
    collapsed: true,
    updatedAt: t,
  }
  await db.dayInstances.add(instance)
  await enqueueSync('create', 'dayInstance', instance.id)
  await finalizeNewInstancePlacement(dayId, instance.id, slot)
  return instance.id
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
  const t = now()

  const instance: DayInstance = {
    id: newId(),
    dayId,
    sourceTaskListId: taskListId,
    title: taskList.title,
    durationMin,
    sortOrder,
    scheduledStartMs,
    addedAt: t,
    collapsed: true,
    updatedAt: t,
  }

  await db.dayInstances.add(instance)

  for (let i = 0; i < packed.length; i++) {
    const task = packed[i]
    const item: DayInstanceItem = {
      id: newId(),
      instanceId: instance.id,
      sourceTaskListItemId: task.id,
      title: task.title,
      durationMin: task.durationMin,
      deadline: task.deadline,
      completed: false,
      sortOrder: i,
      updatedAt: now(),
    }
    await db.dayInstanceItems.add(item)
    await enqueueSync('create', 'dayInstanceItem', item.id)
  }

  await enqueueSync('create', 'dayInstance', instance.id)
  await finalizeNewInstancePlacement(dayId, instance.id, slot)
  return instance.id
}

export async function startInstanceNow(id: string): Promise<void> {
  await updateInstance(id, { timerStartedAt: now() })
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
  await db.dayInstances.update(id, { ...patch, updatedAt: now() })
  await enqueueSync('update', 'dayInstance', id)

  if (patch.durationMin !== undefined) {
    const inst = await db.dayInstances.get(id)
    if (inst) {
      const dateStr = await getDayDate(inst.dayId)
      await ensureDayFreeTimeBlocks(inst.dayId, dateStr)
      await normalizeDayTimeline(inst.dayId, dateStr)
      await syncInstanceStartsFromChain(inst.dayId, dateStr)
    }
  }
}

async function dissolveAltGroupIfSingleton(dayId: string, altGroupId: string): Promise<void> {
  const members = (await listDayInstances(dayId)).filter((i) => i.altGroupId === altGroupId)
  if (members.length !== 1) return
  const t = now()
  await db.dayInstances.update(members[0].id, (row) => {
    delete row.altGroupId
    delete row.altGroupIndex
    delete row.altStackIndex
    row.updatedAt = t
  })
  await enqueueSync('update', 'dayInstance', members[0].id)
  const splitFree = (await listDayFreeTimes(dayId)).filter((f) => f.altGroupId === altGroupId)
  if (splitFree.length) await db.dayFreeTimes.bulkDelete(splitFree.map((f) => f.id))
}

async function shiftSplitColumnsFrom(
  dayId: string,
  altGroupId: string,
  fromColumn: number,
  delta: number
): Promise<void> {
  const t = now()
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  await db.transaction('rw', db.dayInstances, db.dayFreeTimes, async () => {
    for (const inst of instances) {
      if (inst.altGroupId === altGroupId && (inst.altGroupIndex ?? 0) >= fromColumn) {
        await db.dayInstances.update(inst.id, {
          altGroupIndex: (inst.altGroupIndex ?? 0) + delta,
          updatedAt: t,
        })
      }
    }
    for (const free of freeTimes) {
      if (free.altGroupId === altGroupId && (free.altGroupIndex ?? 0) >= fromColumn) {
        await db.dayFreeTimes.update(free.id, {
          altGroupIndex: (free.altGroupIndex ?? 0) + delta,
          updatedAt: t,
        })
      }
    }
  })
}

/** Place block in a new column beside the anchor block. */
export async function linkInstancesAsAlternatives(
  aId: string,
  bId: string,
  side: 'left' | 'right'
): Promise<void> {
  if (aId === bId) return
  const a = await db.dayInstances.get(aId)
  const b = await db.dayInstances.get(bId)
  if (!a || !b || a.dayId !== b.dayId) return

  const dayId = a.dayId
  const groupId = b.altGroupId ?? a.altGroupId ?? newId()
  const targetSort = Math.min(a.sortOrder, b.sortOrder)
  const removeSort = Math.max(a.sortOrder, b.sortOrder)
  const t = now()

  let newColForA: number
  let bCol = b.altGroupIndex ?? 0
  let bStack = b.altStackIndex ?? 0

  if (!b.altGroupId) {
    if (side === 'right') {
      bCol = 0
      bStack = 0
      newColForA = 1
    } else {
      bCol = 1
      bStack = 0
      newColForA = 0
    }
  } else {
    const anchorCol = b.altGroupIndex ?? 0
    newColForA = side === 'left' ? anchorCol : anchorCol + 1
    await shiftSplitColumnsFrom(dayId, groupId, newColForA, 1)
  }

  if (a.sortOrder !== b.sortOrder) {
    await shiftTimelineSortOrdersFrom(dayId, removeSort + 1, -1)
  }

  await db.transaction('rw', db.dayInstances, async () => {
    await db.dayInstances.update(bId, {
      altGroupId: groupId,
      altGroupIndex: bCol,
      altStackIndex: bStack,
      sortOrder: targetSort,
      updatedAt: t,
    })
    await db.dayInstances.update(aId, {
      altGroupId: groupId,
      altGroupIndex: newColForA,
      altStackIndex: 0,
      sortOrder: targetSort,
      updatedAt: t,
    })
  })
  await enqueueSync('update', 'dayInstance', bId)
  await enqueueSync('update', 'dayInstance', aId)

  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

/** Stack block below another in the same split column. */
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
  const t = now()

  const allInstances = await listDayInstances(dayId)
  const allFree = await listDayFreeTimes(dayId)

  if (a.sortOrder !== b.sortOrder) {
    await shiftTimelineSortOrdersFrom(dayId, removeSort + 1, -1)
  }

  await db.transaction('rw', db.dayInstances, db.dayFreeTimes, async () => {
    if (!b.altGroupId) {
      await db.dayInstances.update(bId, {
        altGroupId: groupId,
        altGroupIndex: 0,
        altStackIndex: 0,
        sortOrder: targetSort,
        updatedAt: t,
      })
    }

    for (const inst of allInstances) {
      if (
        inst.id !== aId &&
        inst.altGroupId === groupId &&
        (inst.altGroupIndex ?? 0) === bCol &&
        (inst.altStackIndex ?? 0) >= insertStack
      ) {
        await db.dayInstances.update(inst.id, {
          altStackIndex: (inst.altStackIndex ?? 0) + 1,
          updatedAt: t,
        })
      }
    }
    for (const free of allFree) {
      if (
        free.altGroupId === groupId &&
        (free.altGroupIndex ?? 0) === bCol &&
        (free.altStackIndex ?? 0) >= insertStack
      ) {
        await db.dayFreeTimes.update(free.id, {
          altStackIndex: (free.altStackIndex ?? 0) + 1,
          updatedAt: t,
        })
      }
    }

    await db.dayInstances.update(aId, {
      altGroupId: groupId,
      altGroupIndex: bCol,
      altStackIndex: insertStack,
      sortOrder: targetSort,
      updatedAt: t,
    })
  })
  await enqueueSync('update', 'dayInstance', aId)
  await enqueueSync('update', 'dayInstance', bId)

  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

async function normalizeSplitGroups(dayId: string, _dateStr: string): Promise<void> {
  let instances = await listDayInstances(dayId)
  let freeTimes = await listDayFreeTimes(dayId)
  const groupIds = [...new Set(instances.filter((i) => i.altGroupId).map((i) => i.altGroupId!))]
  const t = now()

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
          freeTimes = freeTimes.filter((f) => f.id !== last.free.id)
        }
        continue
      }

      if (last?.kind === 'free' && last.free.altGroupId === groupId) {
        await db.dayFreeTimes.update(last.free.id, { durationMin: deficit, updatedAt: t })
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
        const newFree: DayFreeTime = {
          id: newId(),
          dayId,
          sortOrder: groupSortOrder,
          altGroupId: groupId,
          altGroupIndex: col.columnIndex,
          altStackIndex: maxStack,
          durationMin: deficit,
          updatedAt: t,
        }
        await db.dayFreeTimes.add(newFree)
        freeTimes = [...freeTimes, newFree]
      }
    }
    instances = await listDayInstances(dayId)
    freeTimes = await listDayFreeTimes(dayId)
  }
}

/** Detach a free-time block from a split column so it can live on the main timeline. */
export async function clearFreeBlockAltGroup(freeId: string): Promise<void> {
  const free = await db.dayFreeTimes.get(freeId)
  if (!free?.altGroupId) return
  const t = now()
  await db.dayFreeTimes.update(freeId, (row) => {
    delete row.altGroupId
    delete row.altGroupIndex
    delete row.altStackIndex
    row.updatedAt = t
  })
}

/** Remove one block from an alternative group. */
export async function unlinkInstanceFromAltGroup(instanceId: string): Promise<void> {
  const inst = await db.dayInstances.get(instanceId)
  if (!inst?.altGroupId) return

  const dayId = inst.dayId
  const altGroupId = inst.altGroupId
  const insertAt = inst.sortOrder + 1
  const t = now()

  await shiftTimelineSortOrdersFrom(dayId, insertAt, 1)
  await db.dayInstances.update(instanceId, (row) => {
    delete row.altGroupId
    delete row.altGroupIndex
    delete row.altStackIndex
    row.sortOrder = insertAt
    row.updatedAt = t
  })
  await enqueueSync('update', 'dayInstance', instanceId)

  const remaining = (await listDayInstances(dayId))
    .filter((i) => i.altGroupId === altGroupId && i.id !== instanceId)
    .sort((a, b) => {
      const col = (a.altGroupIndex ?? 0) - (b.altGroupIndex ?? 0)
      if (col !== 0) return col
      return (a.altStackIndex ?? 0) - (b.altStackIndex ?? 0)
    })
  for (let i = 0; i < remaining.length; i++) {
    const inst = remaining[i]
    const col = inst.altGroupIndex ?? 0
    const stackInCol = remaining.filter((r) => (r.altGroupIndex ?? 0) === col).indexOf(inst)
    await db.dayInstances.update(inst.id, { altGroupIndex: col, altStackIndex: stackInCol, updatedAt: t })
    await enqueueSync('update', 'dayInstance', inst.id)
  }

  await dissolveAltGroupIfSingleton(dayId, altGroupId)

  const dateStr = await getDayDate(dayId)
  await normalizeDayTimeline(dayId, dateStr)
  await syncInstanceStartsFromChain(dayId, dateStr)
}

export async function deleteInstance(id: string): Promise<void> {
  const inst = await db.dayInstances.get(id)
  const items = await db.dayInstanceItems.where('instanceId').equals(id).toArray()
  const dayId = inst?.dayId
  const altGroupId = inst?.altGroupId
  await db.transaction('rw', db.dayInstances, db.dayInstanceItems, async () => {
    await db.dayInstanceItems.bulkDelete(items.map((i) => i.id))
    await db.dayInstances.delete(id)
  })
  for (const item of items) {
    await enqueueSync('delete', 'dayInstanceItem', item.id, item.notionPageId)
  }
  await enqueueSync('delete', 'dayInstance', id, inst?.notionPageId)
  if (dayId) {
    if (altGroupId) await dissolveAltGroupIfSingleton(dayId, altGroupId)
    const dateStr = await getDayDate(dayId)
    await rescheduleDayTimeline(dayId, dateStr)
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
  const newAddedAt = now()

  await db.transaction('rw', db.dayInstances, db.dayInstanceItems, async () => {
    await db.dayInstances.update(id, {
      addedAt: newAddedAt,
      timerStartedAt: undefined,
      updatedAt: now(),
    })
    for (const item of items) {
      await db.dayInstanceItems.update(item.id, { completed: false, updatedAt: now() })
    }
  })

  for (const item of items) {
    await enqueueSync('update', 'dayInstanceItem', item.id)
  }
  await enqueueSync('update', 'dayInstance', id)

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
  await db.dayInstances.update(id, { addedAt, timerStartedAt, updatedAt: now() })
  for (const item of items) {
    await db.dayInstanceItems.update(item.id, {
      completed: item.completed,
      updatedAt: now(),
    })
  }
  await enqueueSync('update', 'dayInstance', id)
}

export async function toggleInstanceItem(
  id: string,
  completed: boolean
): Promise<void> {
  const item = await db.dayInstanceItems.get(id)
  if (!item) return

  const instanceItems = await db.dayInstanceItems
    .where('instanceId')
    .equals(item.instanceId)
    .toArray()
  const descendantIds = collectDescendantIds(instanceItems, id)
  const idsToUpdate = descendantIds.length > 0 ? descendantIds : [id]

  const ts = now()
  await db.transaction('rw', db.dayInstanceItems, async () => {
    for (const itemId of idsToUpdate) {
      await db.dayInstanceItems.update(itemId, { completed, updatedAt: ts })
    }
  })
  for (const itemId of idsToUpdate) {
    await enqueueSync('update', 'dayInstanceItem', itemId)
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
    .filter((i) => (i.parentItemId ?? undefined) === (parentItemId ?? undefined))
    .toArray()
  const item: DayInstanceItem = {
    id: newId(),
    instanceId,
    parentItemId,
    title,
    completed: false,
    sortOrder: siblings.length,
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
  const siblings = (await db.dayInstanceItems.where('instanceId').equals(instanceId).toArray())
    .filter((i) => (i.parentItemId ?? undefined) === (parentItemId ?? undefined))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const insertAt = after.sortOrder + 1
  await Promise.all(
    siblings
      .filter((s) => s.sortOrder >= insertAt)
      .map((s) => db.dayInstanceItems.update(s.id, { sortOrder: s.sortOrder + 1, updatedAt: now() }))
  )

  const item: DayInstanceItem = {
    id: newId(),
    instanceId,
    parentItemId,
    title,
    completed: false,
    sortOrder: insertAt,
    updatedAt: now(),
  }
  await db.dayInstanceItems.add(item)
  await enqueueSync('create', 'dayInstanceItem', item.id)
  return item
}

export async function reparentInstanceItem(itemId: string, newParentId?: string): Promise<void> {
  const item = await db.dayInstanceItems.get(itemId)
  if (!item) return
  if ((item.parentItemId ?? undefined) === (newParentId ?? undefined)) return

  const all = await db.dayInstanceItems.where('instanceId').equals(item.instanceId).toArray()
  if (newParentId && !canReparentUnder(all, itemId, newParentId)) return

  const newSiblings = all.filter(
    (i) => i.id !== itemId && (i.parentItemId ?? undefined) === (newParentId ?? undefined)
  )
  const newSortOrder = newSiblings.length
    ? Math.max(...newSiblings.map((s) => s.sortOrder)) + 1
    : 0

  await db.dayInstanceItems.update(itemId, (row) => {
    if (newParentId) row.parentItemId = newParentId
    else delete row.parentItemId
    row.sortOrder = newSortOrder
    row.updatedAt = now()
  })
  await enqueueSync('update', 'dayInstanceItem', itemId)
}

export async function updateInstanceItem(
  id: string,
  patch: Partial<
    Pick<DayInstanceItem, 'title' | 'durationMin' | 'deadline' | 'sortOrder' | 'completed' | 'parentItemId'>
  >
): Promise<void> {
  if ('parentItemId' in patch) {
    await reparentInstanceItem(id, patch.parentItemId)
  }

  const { parentItemId: _parent, ...rest } = patch
  if (Object.keys(rest).length > 0) {
    const item = await db.dayInstanceItems.get(id)
    await db.dayInstanceItems.update(id, (row) => {
      Object.assign(row, rest, { updatedAt: now() })
      if ('deadline' in rest && rest.deadline === undefined) delete row.deadline
    })
    await enqueueSync('update', 'dayInstanceItem', id)

    if (item?.sourceTaskListItemId) {
      await syncDayInstanceItemToTaskList(item.sourceTaskListItemId, {
        title: rest.title,
        durationMin: rest.durationMin,
        ...('deadline' in rest ? { deadline: rest.deadline } : {}),
      })
    }
  }
}

export async function deleteInstanceItem(id: string): Promise<void> {
  const item = await db.dayInstanceItems.get(id)
  if (!item) return
  const children = await db.dayInstanceItems.where('parentItemId').equals(id).toArray()
  await db.transaction('rw', db.dayInstanceItems, async () => {
    for (const c of children) await db.dayInstanceItems.delete(c.id)
    await db.dayInstanceItems.delete(id)
  })
  for (const c of children) await enqueueSync('delete', 'dayInstanceItem', c.id, c.notionPageId)
  await enqueueSync('delete', 'dayInstanceItem', id, item.notionPageId)
}

async function insertFreeBlockAtSortOrder(
  dayId: string,
  sortOrder: number,
  durationMin: number
): Promise<void> {
  const t = now()
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)

  await db.transaction('rw', db.dayFreeTimes, db.dayInstances, async () => {
    for (const i of instances) {
      if (i.sortOrder >= sortOrder) {
        await db.dayInstances.update(i.id, { sortOrder: i.sortOrder + 1, updatedAt: t })
      }
    }
    for (const f of freeTimes) {
      if (f.sortOrder >= sortOrder) {
        await db.dayFreeTimes.update(f.id, { sortOrder: f.sortOrder + 1, updatedAt: t })
      }
    }
    await db.dayFreeTimes.add({
      id: newId(),
      dayId,
      sortOrder,
      durationMin,
      updatedAt: t,
    })
  })
}

async function normalizeDayTimelineToWindow(dayId: string, _dateStr: string): Promise<void> {
  const instances = await listDayInstances(dayId)
  const freeTimes = await listDayFreeTimes(dayId)
  const timeline = buildTimeline(instances, freeTimes)
  if (timeline.length === 0) return

  const delta = DAY_WINDOW_MINUTES - timelineTotalMinutes(timeline, instances, freeTimes)
  if (delta === 0) return

  const t = now()
  const display = groupTimelineForDisplay(timeline, instances, freeTimes)

  if (delta > 0) {
    const last = display[display.length - 1]
    if (last.kind === 'free' && !last.free.altGroupId) {
      await db.dayFreeTimes.update(last.free.id, {
        durationMin: last.free.durationMin + delta,
        updatedAt: t,
      })
    } else {
      const maxSortOrder = Math.max(
        ...instances.map((i) => i.sortOrder),
        ...freeTimes.map((f) => f.sortOrder),
        -1
      )
      await db.dayFreeTimes.add({
        id: newId(),
        dayId,
        sortOrder: maxSortOrder + 1,
        durationMin: delta,
        updatedAt: t,
      })
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
    if (newDur <= 0) {
      toDelete.push(entry.free.id)
    } else {
      updates.push({ id: entry.free.id, durationMin: newDur })
    }
  }

  await db.transaction('rw', db.dayFreeTimes, async () => {
    if (toDelete.length) await db.dayFreeTimes.bulkDelete(toDelete)
    for (const u of updates) {
      await db.dayFreeTimes.update(u.id, { durationMin: u.durationMin, updatedAt: t })
    }
  })
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

/**
 * User edits a block start time: add/shrink free time before it, then re-chain
 * so everything after shifts with it.
 */
export async function applyInstanceScheduledStartChange(
  instanceId: string,
  newStartMs: number
): Promise<void> {
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
      if (inst.altGroupId) {
        await unlinkInstanceFromAltGroup(instanceId)
      }
      await linkInstancesAsAlternatives(instanceId, overlapTarget.id, 'right')
      return
    }
  }

  const t = now()
  const prev = index > 0 ? timeline[index - 1] : undefined

  if (deltaMin > 0) {
    if (prev?.kind === 'free') {
      await db.dayFreeTimes.update(prev.free.id, {
        durationMin: prev.free.durationMin + deltaMin,
        updatedAt: t,
      })
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
      } else {
        await db.dayFreeTimes.update(prev.free.id, { durationMin: nextDur, updatedAt: t })
      }
    }
  }

  await syncInstanceStartsFromChain(dayId, dateStr)
}

export type { DayTimelineSnapshot } from '../lib/dayTimelineLayout'
export { snapshotDayTimeline } from '../lib/dayTimelineLayout'

export async function restoreDayTimeline(snapshot: DayTimelineSnapshot): Promise<void> {
  const t = now()
  const existingFreeIds = new Set(snapshot.freeTimes.map((f) => f.id))
  const allFree = await db.dayFreeTimes.toArray()
  const toDelete = allFree.filter((f) => !existingFreeIds.has(f.id)).map((f) => f.id)

  await db.transaction('rw', db.dayFreeTimes, db.dayInstances, async () => {
    if (toDelete.length) await db.dayFreeTimes.bulkDelete(toDelete)
    for (const f of snapshot.freeTimes) {
      const row = await db.dayFreeTimes.get(f.id)
      if (row) {
        await db.dayFreeTimes.update(f.id, {
          sortOrder: f.sortOrder,
          durationMin: f.durationMin,
          updatedAt: t,
        })
      } else {
        const dayId = snapshot.instances[0]
          ? (await db.dayInstances.get(snapshot.instances[0].id))?.dayId
          : undefined
        if (dayId) {
          await db.dayFreeTimes.add({
            id: f.id,
            dayId,
            sortOrder: f.sortOrder,
            durationMin: f.durationMin,
            updatedAt: t,
          })
        }
      }
    }
    for (const s of snapshot.instances) {
      await db.dayInstances.update(s.id, {
        sortOrder: s.sortOrder,
        scheduledStartMs: s.scheduledStartMs,
        updatedAt: t,
      })
      await enqueueSync('update', 'dayInstance', s.id)
    }
  })
}

export async function applyFlatTimelineOrder(
  dateStr: string,
  dayId: string,
  orderedIds: string[],
  instances: DayInstance[]
): Promise<void> {
  const t = now()
  let sortOrder = 0
  let i = 0

  await db.transaction('rw', db.dayFreeTimes, db.dayInstances, async () => {
    while (i < orderedIds.length) {
      const id = orderedIds[i]
      if (isFreeTimelineDragId(id)) {
        await db.dayFreeTimes.update(parseTimelineDragId(id).id, { sortOrder, updatedAt: t })
        sortOrder++
        i++
        continue
      }

      const inst = instances.find((x) => x.id === id)
      if (!inst) {
        i++
        continue
      }

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
          await db.dayInstances.update(mid, { sortOrder, updatedAt: t })
        }
        sortOrder++
      } else {
        await db.dayInstances.update(id, { sortOrder, updatedAt: t })
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
  const { dragIds: mergedIds, mergedAway, durationUpdates } = mergeAdjacentFreeDragIds(
    dragIds,
    freeById
  )

  const t = now()

  await db.transaction('rw', db.dayFreeTimes, db.dayInstances, async () => {
    if (mergedAway.length) await db.dayFreeTimes.bulkDelete(mergedAway)
    for (const [id, durationMin] of durationUpdates) {
      await db.dayFreeTimes.update(id, { durationMin, updatedAt: t })
    }

    for (let sortOrder = 0; sortOrder < mergedIds.length; sortOrder++) {
      const parsed = parseTimelineDragId(mergedIds[sortOrder])
      if (parsed.kind === 'free') {
        await db.dayFreeTimes.update(parsed.id, { sortOrder, updatedAt: t })
      } else if (parsed.kind === 'alternative') {
        const members = await db.dayInstances
          .where('dayId')
          .equals(dayId)
          .filter((i) => i.altGroupId === parsed.id)
          .toArray()
        for (const member of members) {
          await db.dayInstances.update(member.id, { sortOrder, updatedAt: t })
        }
      } else {
        await db.dayInstances.update(parsed.id, { sortOrder, updatedAt: t })
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

export async function setInstanceItemSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateInstanceItem(id, { sortOrder })))
}

export async function applyInstanceItemTree(
  instanceId: string,
  structure: ItemTreeStructureRow[]
): Promise<void> {
  const all = await db.dayInstanceItems.where('instanceId').equals(instanceId).toArray()
  await db.transaction('rw', db.dayInstanceItems, async () => {
    for (const row of structure) {
      if (row.parentItemId && !canReparentUnder(all, row.id, row.parentItemId)) continue
      await db.dayInstanceItems.update(row.id, (item) => {
        if (row.parentItemId) item.parentItemId = row.parentItemId
        else delete item.parentItemId
        item.sortOrder = row.sortOrder
        item.updatedAt = now()
      })
    }
  })
  for (const row of structure) await enqueueSync('update', 'dayInstanceItem', row.id)
}

export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const today = todayDateString()
  if (dateStr === today) return 'Today'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
