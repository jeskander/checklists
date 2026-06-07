import { db } from '../db/database'

/** Wipe local store on sign-out so the next account gets a clean bootstrap. */
export async function clearLocalStore(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.checklistTemplates,
      db.templateItems,
      db.days,
      db.dayInstances,
      db.dayFreeTimes,
      db.dayInstanceItems,
      db.taskLists,
      db.taskListItems,
      db.syncMeta,
      db.syncQueue,
    ],
    async () => {
      await db.checklistTemplates.clear()
      await db.templateItems.clear()
      await db.days.clear()
      await db.dayInstances.clear()
      await db.dayFreeTimes.clear()
      await db.dayInstanceItems.clear()
      await db.taskLists.clear()
      await db.taskListItems.clear()
      await db.syncMeta.clear()
      await db.syncQueue.clear()
    }
  )
}
