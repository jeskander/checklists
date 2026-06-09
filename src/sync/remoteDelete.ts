import { db } from '../db/database'

/** Remove a row deleted on another device from the local cache. */
export async function handleRemoteDelete(
  table: string,
  oldRecord: Record<string, unknown>
): Promise<void> {
  const id = String(oldRecord.id ?? '')
  if (!id) return

  switch (table) {
    case 'library_blocks': {
      const kind = oldRecord.kind
      if (kind === 'checklist') {
        await db.checklistTemplates.delete(id)
        const items = await db.templateItems.where('templateId').equals(id).toArray()
        for (const item of items) await db.templateItems.delete(item.id)
      } else if (kind === 'task_list') {
        await db.taskLists.delete(id)
        const items = await db.taskListItems.where('taskListId').equals(id).toArray()
        for (const item of items) await db.taskListItems.delete(item.id)
      }
      break
    }
    case 'block_items': {
      await db.templateItems.delete(id)
      await db.taskListItems.delete(id)
      break
    }
    case 'days': {
      const instances = await db.dayInstances.where('dayId').equals(id).toArray()
      for (const inst of instances) {
        await db.dayInstances.delete(inst.id)
        const items = await db.dayInstanceItems.where('instanceId').equals(inst.id).toArray()
        for (const item of items) await db.dayInstanceItems.delete(item.id)
      }
      const freeTimes = await db.dayFreeTimes.where('dayId').equals(id).toArray()
      for (const f of freeTimes) await db.dayFreeTimes.delete(f.id)
      await db.days.delete(id)
      break
    }
    case 'day_instances': {
      const items = await db.dayInstanceItems.where('instanceId').equals(id).toArray()
      for (const item of items) await db.dayInstanceItems.delete(item.id)
      await db.dayInstances.delete(id)
      break
    }
    case 'day_free_times':
      await db.dayFreeTimes.delete(id)
      break
    case 'day_instance_items':
      await db.dayInstanceItems.delete(id)
      break
  }
}
