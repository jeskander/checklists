import { db } from '../db/database'
import type { DayInstanceItem, TaskListItem } from '../db/types'
import { now } from '../lib/ids'
import { enqueueSync } from '../sync/syncEngine'

export type LinkedTaskItemPatch = Partial<Pick<TaskListItem, 'title' | 'durationMin' | 'deadline'>>

function hasLinkedPatch(patch: Partial<LinkedTaskItemPatch>): boolean {
  return patch.title !== undefined || patch.durationMin !== undefined || 'deadline' in patch
}

export async function linkedDayInstanceItems(taskListItemId: string): Promise<DayInstanceItem[]> {
  return db.dayInstanceItems.filter((item) => item.sourceTaskListItemId === taskListItemId).toArray()
}

export async function syncTaskListItemToDayItems(
  taskListItemId: string,
  patch: Partial<LinkedTaskItemPatch>
): Promise<void> {
  if (!hasLinkedPatch(patch)) return

  const linked = await linkedDayInstanceItems(taskListItemId)
  if (!linked.length) return

  const ts = now()
  for (const item of linked) {
    await db.dayInstanceItems.update(item.id, (row) => {
      row.updatedAt = ts
      if (patch.title !== undefined) row.title = patch.title
      if (patch.durationMin !== undefined) row.durationMin = patch.durationMin
      if ('deadline' in patch) {
        if (patch.deadline === undefined) delete row.deadline
        else row.deadline = patch.deadline
      }
    })
    await enqueueSync('update', 'dayInstanceItem', item.id)
  }
}

export async function syncDayInstanceItemToTaskList(
  taskListItemId: string,
  patch: Partial<LinkedTaskItemPatch>
): Promise<void> {
  if (!hasLinkedPatch(patch)) return

  const row = await db.taskListItems.get(taskListItemId)
  if (!row) return

  await db.taskListItems.update(taskListItemId, (item) => {
    item.updatedAt = now()
    if (patch.title !== undefined) item.title = patch.title
    if (patch.durationMin !== undefined) item.durationMin = patch.durationMin
    if ('deadline' in patch) {
      if (patch.deadline === undefined) delete item.deadline
      else item.deadline = patch.deadline
    }
  })
  await db.taskLists.update(row.taskListId, { updatedAt: now() })
}
