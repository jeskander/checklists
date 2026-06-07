import { db } from '../db/database'
import type { TaskListItem } from '../db/types'
import { now } from '../lib/ids'
import { enqueueSync } from '../sync/syncEngine'

export type LinkedTaskItemPatch = Partial<Pick<TaskListItem, 'title' | 'durationMin' | 'deadline'>>

function hasLinkedPatch(patch: Partial<LinkedTaskItemPatch>): boolean {
  return patch.title !== undefined || patch.durationMin !== undefined || 'deadline' in patch
}

export async function syncTaskListItemToDayItems(
  taskListItemId: string,
  patch: Partial<LinkedTaskItemPatch>
): Promise<void> {
  if (!hasLinkedPatch(patch)) return

  const linked = await db.dayInstanceItems
    .filter((i) => i.sourceTaskListItemId === taskListItemId)
    .toArray()
  if (!linked.length) return

  for (const item of linked) {
    const update: Partial<typeof item> = { updatedAt: now() }
    if (patch.title !== undefined) update.title = patch.title
    if (patch.durationMin !== undefined) update.durationMin = patch.durationMin
    if ('deadline' in patch) update.deadline = patch.deadline
    await db.dayInstanceItems.update(item.id, update)
    await enqueueSync('update', 'dayInstanceItem', item.id)
  }
}

export async function syncDayInstanceItemToTaskList(
  taskListItemId: string,
  patch: Partial<LinkedTaskItemPatch>
): Promise<void> {
  if (!hasLinkedPatch(patch)) return

  const item = await db.taskListItems.get(taskListItemId)
  if (!item) return

  const update: Partial<TaskListItem> = { updatedAt: now() }
  if (patch.title !== undefined) update.title = patch.title
  if (patch.durationMin !== undefined) update.durationMin = patch.durationMin
  if ('deadline' in patch) update.deadline = patch.deadline

  await db.taskListItems.update(taskListItemId, update)
  await updateTaskListTimestamp(item.taskListId)
  await enqueueSync('update', 'taskListItem', taskListItemId)
}

async function updateTaskListTimestamp(taskListId: string): Promise<void> {
  await db.taskLists.update(taskListId, { updatedAt: now() })
  await enqueueSync('update', 'taskList', taskListId)
}
