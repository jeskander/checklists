import { db } from '../db/database'
import type { TaskList, TaskListItem } from '../db/types'
import type { TaskDueOnDay } from '../lib/taskDeadline'
import { INBOX_LIST_TITLE, isInboxList } from '../lib/inbox'
import { newId, now } from '../lib/ids'
import { collectDescendantIds, getChildren } from '../lib/completion'
import { flattenItemTree, type ItemTreeStructureRow } from '../lib/itemTreeMove'
import { canReparentUnder } from '../lib/listItems'
import { syncTaskListItemToDayItems } from '../lib/taskListItemSync'
import { enqueueSync } from '../sync/syncEngine'

export { INBOX_LIST_TITLE, isInboxList } from '../lib/inbox'

// ─── Task lists ───────────────────────────────────────────────────────────────

export async function listTaskLists(): Promise<TaskList[]> {
  await ensureInboxList()
  return db.taskLists.orderBy('sortOrder').toArray()
}

export async function getTaskList(id: string): Promise<TaskList | undefined> {
  return db.taskLists.get(id)
}

export async function createTaskList(title: string): Promise<TaskList> {
  if (isInboxList({ title })) return ensureInboxList()

  const existing = await db.taskLists.orderBy('sortOrder').reverse().first()
  const sortOrder = existing ? existing.sortOrder + 1 : 1

  const list: TaskList = {
    id: newId(),
    title,
    defaultDurationMin: 60,
    sortOrder,
    updatedAt: now(),
  }
  await db.taskLists.add(list)
  await enqueueSync('create', 'taskList', list.id)
  return list
}

export async function updateTaskList(
  id: string,
  patch: Partial<Pick<TaskList, 'title' | 'sortOrder' | 'defaultDurationMin' | 'repeat'>>
): Promise<void> {
  if ('title' in patch && patch.title != null) {
    const list = await getTaskList(id)
    if (list && isInboxList(list) && !isInboxList({ title: patch.title })) return
  }

  const existing = await db.taskLists.get(id)
  if (!existing) return
  await db.taskLists.put({ ...existing, ...patch, updatedAt: now() })
  await enqueueSync('update', 'taskList', id)
}

export async function deleteTaskList(id: string): Promise<void> {
  const list = await getTaskList(id)
  if (list && isInboxList(list)) return

  const items = await db.taskListItems.where('taskListId').equals(id).toArray()
  await db.transaction('rw', [db.taskLists, db.taskListItems], async () => {
    for (const item of items) {
      await db.taskListItems.delete(item.id)
      await enqueueSync('delete', 'taskListItem', item.id)
    }
    await db.taskLists.delete(id)
    await enqueueSync('delete', 'taskList', id)
  })
}

export async function restoreTaskList(list: TaskList): Promise<void> {
  await db.taskLists.put({ ...list, updatedAt: now() })
  await enqueueSync('update', 'taskList', list.id)
}

export async function restoreTaskListItems(items: TaskListItem[]): Promise<void> {
  for (const item of items) {
    await db.taskListItems.put({ ...item, updatedAt: now() })
    await enqueueSync('update', 'taskListItem', item.id)
  }
}

export async function setTaskListSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateTaskList(id, { sortOrder })))
}

export async function ensureInboxList(): Promise<TaskList> {
  let existing = await dedupeInboxLists()
  if (existing) {
    if (existing.sortOrder !== 0) {
      await updateTaskList(existing.id, { sortOrder: 0 })
      existing = { ...existing, sortOrder: 0 }
    }
    return existing
  }

  const list: TaskList = {
    id: newId(),
    title: INBOX_LIST_TITLE,
    defaultDurationMin: 60,
    sortOrder: 0,
    updatedAt: now(),
  }
  await db.taskLists.add(list)
  await enqueueSync('create', 'taskList', list.id)
  return list
}

// ─── Task list items ──────────────────────────────────────────────────────────

async function listOpenTaskListItemRows(taskListId: string): Promise<TaskListItem[]> {
  return db.taskListItems
    .where('taskListId')
    .equals(taskListId)
    .filter((i) => i.completedAt == null)
    .toArray()
}

export async function listTaskListItems(taskListId: string): Promise<TaskListItem[]> {
  const items = await listOpenTaskListItemRows(taskListId)
  return getChildren(items, undefined).sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function listAllTaskListItems(taskListId: string): Promise<TaskListItem[]> {
  const items = await db.taskListItems.where('taskListId').equals(taskListId).toArray()
  const flat = flattenItemTree(items)
  return flat.map(({ id }) => items.find((i) => i.id === id)).filter((i): i is TaskListItem => i != null)
}

async function rootMetaForItem(
  taskListId: string,
  itemId: string
): Promise<Pick<TaskListItem, 'importance' | 'durationMin' | 'deadline'>> {
  const all = await db.taskListItems.where('taskListId').equals(taskListId).toArray()
  let current = all.find((i) => i.id === itemId)
  while (current?.parentItemId) {
    current = all.find((i) => i.id === current!.parentItemId)
  }
  return {
    importance: current?.importance ?? 2,
    durationMin: current?.durationMin ?? 15,
    deadline: current?.deadline,
  }
}

export async function updateTaskListGroupMeta(
  id: string,
  patch: Partial<Pick<TaskListItem, 'importance' | 'durationMin' | 'deadline'>>
): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item) return
  const allItems = await db.taskListItems.where('taskListId').equals(item.taskListId).toArray()
  const ids = [id, ...collectDescendantIds(allItems, id)]
  for (const targetId of ids) {
    await updateTaskListItem(targetId, patch)
  }
}

export async function setTaskListRootSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateTaskListItem(id, { sortOrder })))
}

export async function addTaskListItem(
  taskListId: string,
  title: string,
  importance: TaskListItem['importance'] = 2,
  durationMin = 15,
  deadline?: string,
  parentItemId?: string
): Promise<TaskListItem> {
  const siblings = await db.taskListItems
    .where('taskListId')
    .equals(taskListId)
    .filter((i) => i.completedAt == null && (i.parentItemId ?? undefined) === parentItemId)
    .toArray()
  const sortOrder = siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0
  const rootMeta = parentItemId ? await rootMetaForItem(taskListId, parentItemId) : null

  const item: TaskListItem = {
    id: newId(),
    taskListId,
    parentItemId,
    title,
    importance: rootMeta?.importance ?? importance,
    durationMin: rootMeta?.durationMin ?? durationMin,
    sortOrder,
    deadline: rootMeta?.deadline ?? deadline,
    updatedAt: now(),
  }
  await db.taskListItems.add(item)
  await updateTaskList(taskListId, {})
  await enqueueSync('create', 'taskListItem', item.id)
  return item
}

export async function addTaskListItemAfter(
  taskListId: string,
  afterItemId: string,
  title = ''
): Promise<TaskListItem> {
  const afterRow = await db.taskListItems.get(afterItemId)
  if (!afterRow) return addTaskListItem(taskListId, title)

  const parentItemId = afterRow.parentItemId
  const insertAt = afterRow.sortOrder + 1
  const rootMeta = parentItemId ? await rootMetaForItem(taskListId, afterItemId) : null

  const toShift = await db.taskListItems
    .where('taskListId')
    .equals(taskListId)
    .filter(
      (i) =>
        i.completedAt == null &&
        (i.parentItemId ?? undefined) === (parentItemId ?? undefined) &&
        i.sortOrder >= insertAt
    )
    .toArray()

  for (const s of toShift) {
    await db.taskListItems.update(s.id, { sortOrder: s.sortOrder + 1, updatedAt: now() })
    await enqueueSync('update', 'taskListItem', s.id)
  }

  const item: TaskListItem = {
    id: newId(),
    taskListId,
    parentItemId,
    title,
    importance: rootMeta?.importance ?? afterRow.importance,
    durationMin: rootMeta?.durationMin ?? 15,
    sortOrder: insertAt,
    deadline: rootMeta?.deadline,
    updatedAt: now(),
  }
  await db.taskListItems.add(item)
  await updateTaskList(taskListId, {})
  await enqueueSync('create', 'taskListItem', item.id)
  return item
}

export async function reparentTaskListItem(itemId: string, newParentId?: string): Promise<void> {
  const item = await db.taskListItems.get(itemId)
  if (!item || (item.parentItemId ?? undefined) === newParentId) return

  const allItems = await listAllTaskListItems(item.taskListId)
  if (newParentId && !canReparentUnder(allItems, itemId, newParentId)) return

  const newSiblings = allItems.filter(
    (i) => i.id !== itemId && (i.parentItemId ?? undefined) === newParentId
  )
  const newSortOrder = newSiblings.length ? Math.max(...newSiblings.map((s) => s.sortOrder)) + 1 : 0

  await db.taskListItems.update(itemId, {
    parentItemId: newParentId,
    sortOrder: newSortOrder,
    updatedAt: now(),
  })

  if (newParentId) {
    const meta = await rootMetaForItem(item.taskListId, newParentId)
    const toUpdate = [itemId, ...collectDescendantIds(allItems, itemId)]
    for (const targetId of toUpdate) {
      await db.taskListItems.update(targetId, { ...meta, updatedAt: now() })
      await enqueueSync('update', 'taskListItem', targetId)
    }
  } else {
    await enqueueSync('update', 'taskListItem', itemId)
  }

  await updateTaskList(item.taskListId, {})
}

export async function updateTaskListItem(
  id: string,
  patch: Partial<
    Pick<TaskListItem, 'title' | 'importance' | 'durationMin' | 'sortOrder' | 'deadline' | 'parentItemId'>
  >
): Promise<void> {
  if ('parentItemId' in patch) {
    await reparentTaskListItem(id, patch.parentItemId)
  }

  const { parentItemId: _p, ...rest } = patch
  if (Object.keys(rest).length === 0) return

  const item = await db.taskListItems.get(id)
  if (!item) return

  await db.taskListItems.update(id, { ...rest, updatedAt: now() })
  await updateTaskList(item.taskListId, {})
  await enqueueSync('update', 'taskListItem', id)

  await syncTaskListItemToDayItems(id, {
    title: rest.title,
    durationMin: rest.durationMin,
    ...('deadline' in rest ? { deadline: rest.deadline } : {}),
  })
}

export async function deleteTaskListItem(id: string): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item) return

  const allItems = await db.taskListItems.where('taskListId').equals(item.taskListId).toArray()
  const toDelete = [id, ...collectDescendantIds(allItems, id)]

  for (const delId of toDelete) {
    await db.taskListItems.delete(delId)
    await enqueueSync('delete', 'taskListItem', delId)
  }
  await updateTaskList(item.taskListId, {})
}

export async function setTaskListItemSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateTaskListItem(id, { sortOrder })))
}

export async function applyTaskListItemTree(
  taskListId: string,
  structure: ItemTreeStructureRow[]
): Promise<void> {
  const allItems = await listAllTaskListItems(taskListId)

  for (const row of structure) {
    if (row.parentItemId && !canReparentUnder(allItems, row.id, row.parentItemId)) continue
    await db.taskListItems.update(row.id, {
      parentItemId: row.parentItemId,
      sortOrder: row.sortOrder,
      updatedAt: now(),
    })
    await enqueueSync('update', 'taskListItem', row.id)
  }
  await updateTaskList(taskListId, {})
}

export async function completeTaskListItem(id: string): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item || item.completedAt) return
  await db.taskListItems.update(id, { completedAt: now(), updatedAt: now() })
  await updateTaskList(item.taskListId, {})
  await enqueueSync('update', 'taskListItem', id)
}

export async function restoreTaskListItem(id: string): Promise<void> {
  const item = await db.taskListItems.get(id)
  if (!item) return
  await db.taskListItems.update(id, { completedAt: undefined, updatedAt: now() })
  await updateTaskList(item.taskListId, {})
  await enqueueSync('update', 'taskListItem', id)
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
  const listTitleById = new Map(lists.filter(Boolean).map((l) => [l!.id, l!.title]))
  return items.map((item) => ({
    item,
    listTitle: listTitleById.get(item.taskListId) ?? 'Task list',
  }))
}

export async function listOpenTasksDueOn(date: string): Promise<TaskDueOnDay[]> {
  const items = await db.taskListItems
    .filter((i) => i.deadline === date && i.completedAt == null && i.parentItemId == null)
    .toArray()
  items.sort((a, b) => a.importance - b.importance || a.sortOrder - b.sortOrder)
  return enrichTaskListItems(items)
}

export async function listOpenTasksOverdue(asOfDate: string): Promise<TaskDueOnDay[]> {
  const items = await db.taskListItems
    .filter(
      (i) =>
        i.completedAt == null &&
        i.parentItemId == null &&
        i.deadline != null &&
        i.deadline < asOfDate
    )
    .toArray()
  items.sort(
    (a, b) =>
      (a.deadline ?? '').localeCompare(b.deadline ?? '') ||
      a.importance - b.importance ||
      a.sortOrder - b.sortOrder
  )
  return enrichTaskListItems(items)
}

export async function dedupeInboxLists(): Promise<TaskList | undefined> {
  const inboxes = (await db.taskLists.toArray())
    .filter((l) => l.title.trim().toLowerCase() === INBOX_LIST_TITLE.toLowerCase())
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (inboxes.length <= 1) return inboxes[0]

  const canonical = inboxes[0]
  const duplicates = inboxes.slice(1)

  const canonItems = await db.taskListItems.where('taskListId').equals(canonical.id).toArray()
  let nextSort = canonItems.length ? Math.max(...canonItems.map((i) => i.sortOrder)) + 1 : 0

  for (const dup of duplicates) {
    const items = await db.taskListItems.where('taskListId').equals(dup.id).toArray()
    for (let i = 0; i < items.length; i++) {
      await db.taskListItems.update(items[i].id, {
        taskListId: canonical.id,
        sortOrder: nextSort + i,
        updatedAt: now(),
      })
      await enqueueSync('update', 'taskListItem', items[i].id)
    }
    nextSort += items.length
    await db.taskLists.delete(dup.id)
    await enqueueSync('delete', 'taskList', dup.id)
  }

  if (canonical.sortOrder !== 0) {
    await updateTaskList(canonical.id, { sortOrder: 0 })
    return { ...canonical, sortOrder: 0 }
  }

  return canonical
}
