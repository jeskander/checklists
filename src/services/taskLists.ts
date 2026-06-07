import { db } from '../db/database'
import type { TaskDueOnDay } from '../lib/taskDeadline'
import { INBOX_LIST_TITLE, isInboxList } from '../lib/inbox'
import type { TaskImportance, TaskList, TaskListItem } from '../db/types'
import { newId, now } from '../lib/ids'
import { syncTaskListItemToDayItems } from '../lib/taskListItemSync'

export { INBOX_LIST_TITLE, isInboxList } from '../lib/inbox'

function pickCanonicalInbox(inboxes: TaskList[]): TaskList {
  return inboxes.reduce((best, cur) => {
    if (cur.sortOrder < best.sortOrder) return cur
    if (cur.sortOrder === best.sortOrder && cur.updatedAt < best.updatedAt) return cur
    return best
  })
}

/** Merge duplicate Inbox lists into one, moving tasks to the canonical list. */
export async function dedupeInboxLists(): Promise<TaskList | undefined> {
  const all = await db.taskLists.orderBy('sortOrder').toArray()
  const inboxes = all.filter(isInboxList)
  if (inboxes.length <= 1) return inboxes[0]

  const canonical = pickCanonicalInbox(inboxes)
  const duplicates = inboxes.filter((list) => list.id !== canonical.id)

  await db.transaction('rw', db.taskLists, db.taskListItems, async () => {
    const canonicalItems = await db.taskListItems.where('taskListId').equals(canonical.id).toArray()
    let nextSort =
      canonicalItems.length > 0
        ? Math.max(...canonicalItems.map((item) => item.sortOrder)) + 1
        : 0

    for (const dup of duplicates) {
      const items = await db.taskListItems.where('taskListId').equals(dup.id).toArray()
      for (const item of items) {
        await db.taskListItems.update(item.id, {
          taskListId: canonical.id,
          sortOrder: nextSort++,
          updatedAt: now(),
        })
      }
      await db.taskLists.delete(dup.id)
    }

    if (canonical.sortOrder !== 0) {
      await db.taskLists.update(canonical.id, { sortOrder: 0, updatedAt: now() })
    }
  })

  return canonical
}

export async function ensureInboxList(): Promise<TaskList> {
  await dedupeInboxLists()

  const all = await db.taskLists.orderBy('sortOrder').toArray()
  const existing = all.find((list) => isInboxList(list))
  if (existing) return existing

  const list: TaskList = {
    id: newId(),
    title: INBOX_LIST_TITLE,
    defaultDurationMin: 60,
    sortOrder: 0,
    updatedAt: now(),
  }

  await db.transaction('rw', db.taskLists, async () => {
    const current = await db.taskLists.orderBy('sortOrder').toArray()
    await Promise.all(
      current.map((row) => db.taskLists.update(row.id, { sortOrder: row.sortOrder + 1, updatedAt: now() }))
    )
    await db.taskLists.add(list)
  })

  return list
}

export async function listTaskLists(): Promise<TaskList[]> {
  await ensureInboxList()
  return db.taskLists.orderBy('sortOrder').toArray()
}

export async function getTaskList(id: string): Promise<TaskList | undefined> {
  return db.taskLists.get(id)
}

export async function createTaskList(title: string): Promise<TaskList> {
  if (isInboxList({ title })) return ensureInboxList()

  const count = await db.taskLists.count()
  const list: TaskList = {
    id: newId(),
    title,
    defaultDurationMin: 60,
    sortOrder: count,
    updatedAt: now(),
  }
  await db.taskLists.add(list)
  return list
}

export async function updateTaskList(
  id: string,
  patch: Partial<Pick<TaskList, 'title' | 'sortOrder' | 'defaultDurationMin' | 'repeat'>>
): Promise<void> {
  if ('title' in patch && patch.title != null) {
    const list = await db.taskLists.get(id)
    if (list && isInboxList(list) && !isInboxList({ title: patch.title })) {
      return
    }
  }
  await db.taskLists.update(id, (row) => {
    Object.assign(row, patch, { updatedAt: now() })
    if ('repeat' in patch && patch.repeat === undefined) delete row.repeat
  })
}

export async function deleteTaskList(id: string): Promise<void> {
  const list = await db.taskLists.get(id)
  if (list && isInboxList(list)) return
  const items = await db.taskListItems.where('taskListId').equals(id).toArray()
  await db.transaction('rw', db.taskLists, db.taskListItems, async () => {
    await db.taskListItems.bulkDelete(items.map((i) => i.id))
    await db.taskLists.delete(id)
  })
}

export async function listTaskListItems(taskListId: string): Promise<TaskListItem[]> {
  const items = await db.taskListItems.where('taskListId').equals(taskListId).toArray()
  return items
    .filter((item) => item.completedAt == null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function listAllTaskListItems(taskListId: string): Promise<TaskListItem[]> {
  const items = await db.taskListItems.where('taskListId').equals(taskListId).toArray()
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function addTaskListItem(
  taskListId: string,
  title: string,
  importance: TaskImportance = 2,
  durationMin = 15,
  deadline?: string
): Promise<TaskListItem> {
  const open = await listTaskListItems(taskListId)
  const item: TaskListItem = {
    id: newId(),
    taskListId,
    title,
    importance,
    durationMin,
    sortOrder: open.length,
    ...(deadline ? { deadline } : {}),
    updatedAt: now(),
  }
  await db.taskListItems.add(item)
  await db.taskLists.update(taskListId, { updatedAt: now() })
  return item
}

export async function addTaskListItemAfter(
  taskListId: string,
  afterItemId: string,
  title = ''
): Promise<TaskListItem> {
  const after = await db.taskListItems.get(afterItemId)
  if (!after) return addTaskListItem(taskListId, title)

  const siblings = await listAllTaskListItems(taskListId)
  const insertAt = after.sortOrder + 1
  await Promise.all(
    siblings
      .filter((s) => s.sortOrder >= insertAt)
      .map((s) => db.taskListItems.update(s.id, { sortOrder: s.sortOrder + 1, updatedAt: now() }))
  )

  const item: TaskListItem = {
    id: newId(),
    taskListId,
    title,
    importance: after.importance,
    durationMin: 15,
    sortOrder: insertAt,
    updatedAt: now(),
  }
  await db.taskListItems.add(item)
  await db.taskLists.update(taskListId, { updatedAt: now() })
  return item
}

export async function updateTaskListItem(
  id: string,
  patch: Partial<Pick<TaskListItem, 'title' | 'importance' | 'durationMin' | 'sortOrder' | 'deadline'>>
): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item) return
  await db.taskListItems.update(id, (row) => {
    Object.assign(row, patch, { updatedAt: now() })
    if ('deadline' in patch && patch.deadline === undefined) delete row.deadline
  })
  await db.taskLists.update(item.taskListId, { updatedAt: now() })

  await syncTaskListItemToDayItems(id, {
    title: patch.title,
    durationMin: patch.durationMin,
    ...('deadline' in patch ? { deadline: patch.deadline } : {}),
  })
}

export async function deleteTaskListItem(id: string): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item) return
  await db.taskListItems.delete(id)
  await db.taskLists.update(item.taskListId, { updatedAt: now() })
}

export async function setTaskListSortOrders(ids: string[]): Promise<void> {
  const t = now()
  await Promise.all(ids.map((id, sortOrder) => db.taskLists.update(id, { sortOrder, updatedAt: t })))
}

export async function setTaskListItemSortOrders(ids: string[]): Promise<void> {
  const t = now()
  await Promise.all(ids.map((id, sortOrder) => db.taskListItems.update(id, { sortOrder, updatedAt: t })))
}

export async function completeTaskListItem(id: string): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item || item.completedAt != null) return
  await db.taskListItems.update(id, { completedAt: now(), updatedAt: now() })
  await db.taskLists.update(item.taskListId, { updatedAt: now() })
}

export async function restoreTaskListItem(id: string): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item) return
  await db.taskListItems.update(id, (row) => {
    delete row.completedAt
    row.updatedAt = now()
  })
  await db.taskLists.update(item.taskListId, { updatedAt: now() })
}

export async function taskListOpenStats(taskListId: string): Promise<{ count: number; totalMin: number }> {
  const items = await listTaskListItems(taskListId)
  return {
    count: items.length,
    totalMin: items.reduce((sum, item) => sum + item.durationMin, 0),
  }
}

async function enrichTaskListItems(items: TaskListItem[]): Promise<TaskDueOnDay[]> {
  if (!items.length) return []

  const listIds = [...new Set(items.map((item) => item.taskListId))]
  const lists = await db.taskLists.bulkGet(listIds)
  const listTitleById = new Map(
    lists.filter((list): list is TaskList => list != null).map((list) => [list.id, list.title])
  )

  return items.map((item) => ({
    item,
    listTitle: listTitleById.get(item.taskListId) ?? 'Task list',
  }))
}

/** Open tasks whose deadline is exactly this calendar day. */
export async function listOpenTasksDueOn(date: string): Promise<TaskDueOnDay[]> {
  const items = await db.taskListItems.where('deadline').equals(date).toArray()
  const open = items.filter((item) => item.completedAt == null)
  open.sort((a, b) => a.importance - b.importance || a.sortOrder - b.sortOrder)
  return enrichTaskListItems(open)
}

/** Open tasks whose deadline passed before asOfDate (typically today). */
export async function listOpenTasksOverdue(asOfDate: string): Promise<TaskDueOnDay[]> {
  const items = await db.taskListItems.where('deadline').below(asOfDate).toArray()
  const open = items.filter((item) => item.completedAt == null && item.deadline)
  open.sort(
    (a, b) =>
      (a.deadline ?? '').localeCompare(b.deadline ?? '') ||
      a.importance - b.importance ||
      a.sortOrder - b.sortOrder
  )
  return enrichTaskListItems(open)
}
