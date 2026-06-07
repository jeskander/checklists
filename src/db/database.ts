import Dexie, { type EntityTable } from 'dexie'
import { INBOX_LIST_TITLE } from '../lib/inbox'
import { newId, now } from '../lib/ids'
import type {
  ChecklistTemplate,
  Day,
  DayFreeTime,
  DayInstance,
  DayInstanceItem,
  SyncMeta,
  SyncQueueEntry,
  TaskList,
  TaskListItem,
  TemplateItem,
} from './types'

export class ChecklistsDB extends Dexie {
  checklistTemplates!: EntityTable<ChecklistTemplate, 'id'>
  templateItems!: EntityTable<TemplateItem, 'id'>
  days!: EntityTable<Day, 'id'>
  dayInstances!: EntityTable<DayInstance, 'id'>
  dayFreeTimes!: EntityTable<DayFreeTime, 'id'>
  dayInstanceItems!: EntityTable<DayInstanceItem, 'id'>
  taskLists!: EntityTable<TaskList, 'id'>
  taskListItems!: EntityTable<TaskListItem, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'id'>
  syncQueue!: EntityTable<SyncQueueEntry, 'id'>

  constructor() {
    super('checklists-db')
    this.version(1).stores({
      checklistTemplates: 'id, sortOrder, updatedAt',
      templateItems: 'id, templateId, parentItemId, sortOrder',
      days: 'id, date',
      dayInstances: 'id, dayId, sortOrder, addedAt',
      dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
      syncMeta: 'id',
      syncQueue: 'id, createdAt',
    })

    this.version(2)
      .stores({
        checklistTemplates: 'id, sortOrder, updatedAt',
        templateItems: 'id, templateId, parentItemId, sortOrder',
        days: 'id, date',
        dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
        dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
        syncMeta: 'id',
        syncQueue: 'id, createdAt',
      })
      .upgrade((tx) =>
        tx
          .table('dayInstances')
          .toCollection()
          .modify((inst: { scheduledStartMs?: number; addedAt: number }) => {
            if (inst.scheduledStartMs == null) {
              inst.scheduledStartMs = inst.addedAt
            }
          })
      )

    this.version(3)
      .stores({
        checklistTemplates: 'id, sortOrder, updatedAt',
        templateItems: 'id, templateId, parentItemId, sortOrder',
        days: 'id, date',
        dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
        dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
        syncMeta: 'id',
        syncQueue: 'id, createdAt',
      })
      .upgrade((tx) =>
        tx
          .table('dayInstances')
          .toCollection()
          .modify((inst: { timerStartedAt?: number; addedAt: number; scheduledStartMs: number }) => {
            if (inst.timerStartedAt == null && Date.now() >= inst.scheduledStartMs) {
              inst.timerStartedAt = undefined
            }
          })
      )

    this.version(4).stores({
      checklistTemplates: 'id, sortOrder, updatedAt',
      templateItems: 'id, templateId, parentItemId, sortOrder',
      days: 'id, date',
      dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
      dayFreeTimes: 'id, dayId, sortOrder',
      dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
      syncMeta: 'id',
      syncQueue: 'id, createdAt',
    })

    this.version(5).stores({
      checklistTemplates: 'id, sortOrder, updatedAt',
      templateItems: 'id, templateId, parentItemId, sortOrder',
      days: 'id, date',
      dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
      dayFreeTimes: 'id, dayId, sortOrder',
      dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
      taskLists: 'id, sortOrder, updatedAt',
      taskListItems: 'id, taskListId, importance, sortOrder, completedAt',
      syncMeta: 'id',
      syncQueue: 'id, createdAt',
    })

    this.version(6).stores({
      checklistTemplates: 'id, sortOrder, updatedAt',
      templateItems: 'id, templateId, parentItemId, sortOrder',
      days: 'id, date',
      dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
      dayFreeTimes: 'id, dayId, sortOrder',
      dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
      taskLists: 'id, sortOrder, updatedAt',
      taskListItems: 'id, taskListId, importance, sortOrder, completedAt, deadline',
      syncMeta: 'id',
      syncQueue: 'id, createdAt',
    })

    this.version(7)
      .stores({
        checklistTemplates: 'id, sortOrder, updatedAt',
        templateItems: 'id, templateId, parentItemId, sortOrder',
        days: 'id, date',
        dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
        dayFreeTimes: 'id, dayId, sortOrder',
        dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
        taskLists: 'id, sortOrder, updatedAt',
        taskListItems: 'id, taskListId, importance, sortOrder, completedAt, deadline',
        syncMeta: 'id',
        syncQueue: 'id, createdAt',
      })
      .upgrade(async (tx) => {
        const lists = await tx.table('taskLists').toArray()
        const hasInbox = lists.some(
          (list: { title: string }) => list.title.trim().toLowerCase() === INBOX_LIST_TITLE.toLowerCase()
        )
        if (hasInbox) return

        await Promise.all(
          lists.map((list: { id: string; sortOrder: number }) =>
            tx.table('taskLists').update(list.id, { sortOrder: list.sortOrder + 1, updatedAt: now() })
          )
        )
        await tx.table('taskLists').add({
          id: newId(),
          title: INBOX_LIST_TITLE,
          sortOrder: 0,
          updatedAt: now(),
        })
      })

    this.version(8)
      .stores({
        checklistTemplates: 'id, sortOrder, updatedAt',
        templateItems: 'id, templateId, parentItemId, sortOrder',
        days: 'id, date',
        dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
        dayFreeTimes: 'id, dayId, sortOrder',
        dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
        taskLists: 'id, sortOrder, updatedAt',
        taskListItems: 'id, taskListId, importance, sortOrder, completedAt, deadline',
        syncMeta: 'id',
        syncQueue: 'id, createdAt',
      })
      .upgrade(async (tx) => {
        const lists = (await tx.table('taskLists').toArray()) as Array<{
          id: string
          title: string
          sortOrder: number
          updatedAt: number
        }>
        const inboxes = lists.filter(
          (list) => list.title.trim().toLowerCase() === INBOX_LIST_TITLE.toLowerCase()
        )
        if (inboxes.length <= 1) return

        const canonical = inboxes.reduce((best, cur) => {
          if (cur.sortOrder < best.sortOrder) return cur
          if (cur.sortOrder === best.sortOrder && cur.updatedAt < best.updatedAt) return cur
          return best
        })
        const duplicates = inboxes.filter((list) => list.id !== canonical.id)

        const canonicalItems = await tx.table('taskListItems').where('taskListId').equals(canonical.id).toArray()
        let nextSort =
          canonicalItems.length > 0
            ? Math.max(...canonicalItems.map((item: { sortOrder: number }) => item.sortOrder)) + 1
            : 0

        for (const dup of duplicates) {
          const items = await tx.table('taskListItems').where('taskListId').equals(dup.id).toArray()
          for (const item of items) {
            await tx.table('taskListItems').update(item.id, {
              taskListId: canonical.id,
              sortOrder: nextSort++,
              updatedAt: now(),
            })
          }
          await tx.table('taskLists').delete(dup.id)
        }

        if (canonical.sortOrder !== 0) {
          await tx.table('taskLists').update(canonical.id, { sortOrder: 0, updatedAt: now() })
        }
      })

    this.version(9).stores({
      checklistTemplates: 'id, sortOrder, updatedAt',
      templateItems: 'id, templateId, parentItemId, sortOrder',
      days: 'id, date',
      dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
      dayFreeTimes: 'id, dayId, sortOrder',
      dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
      taskLists: 'id, sortOrder, updatedAt',
      taskListItems: 'id, taskListId, importance, sortOrder, completedAt, deadline',
      syncMeta: 'id',
      syncQueue: 'id, createdAt',
    })

    this.version(10).stores({
      checklistTemplates: 'id, sortOrder, updatedAt',
      templateItems: 'id, templateId, parentItemId, sortOrder',
      days: 'id, date',
      dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
      dayFreeTimes: 'id, dayId, sortOrder',
      dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
      taskLists: 'id, sortOrder, updatedAt',
      taskListItems: 'id, taskListId, importance, sortOrder, completedAt, deadline',
      syncMeta: 'id',
      syncQueue: 'id, createdAt',
    })

    this.version(12)
      .stores({
        checklistTemplates: 'id, sortOrder, updatedAt',
        templateItems: 'id, templateId, parentItemId, sortOrder',
        days: 'id, date',
        dayInstances: 'id, dayId, sortOrder, addedAt, scheduledStartMs',
        dayFreeTimes: 'id, dayId, sortOrder',
        dayInstanceItems: 'id, instanceId, parentItemId, sortOrder',
        taskLists: 'id, sortOrder, updatedAt',
        taskListItems: 'id, taskListId, importance, sortOrder, completedAt, deadline',
        syncMeta: 'id',
        syncQueue: 'id, createdAt',
      })
      .upgrade((tx) =>
        tx
          .table('taskLists')
          .toCollection()
          .modify((list: { defaultDurationMin?: number }) => {
            if (list.defaultDurationMin == null) list.defaultDurationMin = 60
          })
      )
  }
}

export const db = new ChecklistsDB()
