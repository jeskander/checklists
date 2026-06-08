import { db } from '../db/database'
import type { SyncQueueEntry } from '../db/types'
import { supabase } from '../lib/supabaseClient'
import { newId, now } from '../lib/ids'
import {
  dayFreeTimeToRow,
  dayInstanceItemToRow,
  dayInstanceToRow,
  dayToRow,
  taskListItemToRow,
  taskListToRow,
  templateItemToRow,
  templateToRow,
} from './supabaseMappers'
import { clearLocalStore } from '../db/clearLocalStore'
import { pullFromSupabase, isLocalStoreEmpty } from './bootstrapPull'

let syncTimer: ReturnType<typeof setTimeout> | null = null
let syncing = false
let pendingSync = false

const SYNC_DEBOUNCE_MS = 2500
const API_GAP_MS = 80

type SyncStatus = { busy: boolean; message: string; online: boolean }
const syncListeners = new Set<(s: SyncStatus) => void>()
let syncStatus: SyncStatus = {
  busy: false,
  message: '',
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
}

function emitSyncStatus(message: string, busy = syncing): void {
  syncStatus = { ...syncStatus, busy, message }
  syncListeners.forEach((l) => l(syncStatus))
}

export function subscribeSyncStatus(listener: (s: SyncStatus) => void): () => void {
  syncListeners.add(listener)
  listener(syncStatus)
  return () => syncListeners.delete(listener)
}

const ENTITY_PUSH_ORDER: Record<string, number> = {
  template: 0,
  taskList: 0,
  day: 1,
  templateItem: 2,
  taskListItem: 2,
  dayInstance: 3,
  dayFreeTime: 3,
  dayInstanceItem: 4,
}

const ENTITY_TABLE: Record<string, string> = {
  template: 'library_blocks',
  taskList: 'library_blocks',
  templateItem: 'block_items',
  taskListItem: 'block_items',
  day: 'days',
  dayInstance: 'day_instances',
  dayFreeTime: 'day_free_times',
  dayInstanceItem: 'day_instance_items',
}

export function queueSync(): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    void runSync()
  }, SYNC_DEBOUNCE_MS)
}

export async function enqueueSync(
  type: 'create' | 'update' | 'delete',
  entity: string,
  entityId: string
): Promise<void> {
  const existing = await db.syncQueue
    .filter((op) => op.entity === entity && op.entityId === entityId)
    .toArray()
  for (const op of existing) await db.syncQueue.delete(op.id)

  await db.syncQueue.put({
    id: newId(),
    type,
    entity,
    entityId,
    createdAt: now(),
  })
  queueSync()
}

function sortSyncQueue(ops: SyncQueueEntry[]): SyncQueueEntry[] {
  return [...ops].sort((a, b) => {
    if (a.type === 'delete' && b.type !== 'delete') return 1
    if (b.type === 'delete' && a.type !== 'delete') return -1
    const oa = ENTITY_PUSH_ORDER[a.entity] ?? 9
    const ob = ENTITY_PUSH_ORDER[b.entity] ?? 9
    if (oa !== ob) return oa - ob
    return a.createdAt - b.createdAt
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function pushEntity(entity: string, entityId: string): Promise<void> {
  const table = ENTITY_TABLE[entity]
  if (!table) return

  switch (entity) {
    case 'template': {
      const row = await db.checklistTemplates.get(entityId)
      if (!row) return
      const { error } = await supabase.from('library_blocks').upsert(templateToRow(row) as never)
      if (error) throw error
      break
    }
    case 'taskList': {
      const row = await db.taskLists.get(entityId)
      if (!row) return
      const { error } = await supabase.from('library_blocks').upsert(taskListToRow(row) as never)
      if (error) throw error
      break
    }
    case 'templateItem': {
      const row = await db.templateItems.get(entityId)
      if (!row) return
      const { error } = await supabase.from('block_items').upsert(templateItemToRow(row) as never)
      if (error) throw error
      break
    }
    case 'taskListItem': {
      const row = await db.taskListItems.get(entityId)
      if (!row) return
      const { error } = await supabase.from('block_items').upsert(taskListItemToRow(row) as never)
      if (error) throw error
      break
    }
    case 'day': {
      const row = await db.days.get(entityId)
      if (!row) return
      const { error } = await supabase.from('days').upsert(dayToRow(row) as never)
      if (error) throw error
      break
    }
    case 'dayInstance': {
      const row = await db.dayInstances.get(entityId)
      if (!row) return
      const { error } = await supabase.from('day_instances').upsert(dayInstanceToRow(row) as never)
      if (error) throw error
      break
    }
    case 'dayFreeTime': {
      const row = await db.dayFreeTimes.get(entityId)
      if (!row) return
      const { error } = await supabase.from('day_free_times').upsert(dayFreeTimeToRow(row) as never)
      if (error) throw error
      break
    }
    case 'dayInstanceItem': {
      const row = await db.dayInstanceItems.get(entityId)
      if (!row) return
      const { error } = await supabase.from('day_instance_items').upsert(dayInstanceItemToRow(row) as never)
      if (error) throw error
      break
    }
  }
}

async function deleteEntity(entity: string, entityId: string): Promise<void> {
  const table = ENTITY_TABLE[entity]
  if (!table) return
  const { error } = await supabase.from(table).delete().eq('id', entityId)
  if (error) throw error
}

async function pushQueueOps(ops: SyncQueueEntry[], label: string): Promise<{ ok: boolean; message: string }> {
  if (ops.length === 0) return { ok: true, message: '' }
  if (!navigator.onLine) return { ok: false, message: 'Offline — will retry when connected' }

  let i = 0
  for (const op of ops) {
    i += 1
    emitSyncStatus(`${label} (${i}/${ops.length})…`, true)
    try {
      if (op.type === 'delete') {
        await deleteEntity(op.entity, op.entityId)
      } else {
        await pushEntity(op.entity, op.entityId)
      }
      await db.syncQueue.delete(op.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Push failed'
      return { ok: false, message: `${msg} (${op.entity} ${op.type})` }
    }
    await sleep(API_GAP_MS)
  }
  return { ok: true, message: '' }
}

export async function runSync(opts?: { fullPull?: boolean }): Promise<{ ok: boolean; message: string }> {
  if (syncing) {
    pendingSync = true
    return { ok: true, message: 'Queued — sync in progress…' }
  }

  syncing = true
  emitSyncStatus('Syncing…', true)

  try {
    if (navigator.onLine) {
      emitSyncStatus('Pulling changes…', true)
      await pullFromSupabase(opts?.fullPull ?? false)

      const { dedupeInboxLists } = await import('../services/taskLists')
      await dedupeInboxLists()

      const queue = sortSyncQueue(await db.syncQueue.orderBy('createdAt').toArray())
      const deleteOps = queue.filter((op) => op.type === 'delete')
      const pushOps = queue.filter((op) => op.type !== 'delete')

      const deleteResult = await pushQueueOps(deleteOps, 'Pushing deletions')
      if (!deleteResult.ok) return deleteResult

      const pushResult = await pushQueueOps(pushOps, 'Pushing changes')
      if (!pushResult.ok) return pushResult

      await db.syncMeta.put({
        id: 'main',
        lastPullAt: now(),
        lastPushAt: now(),
      })

      emitSyncStatus('Synced', false)
      return { ok: true, message: 'Synced' }
    }

    emitSyncStatus('Offline — changes saved locally', false)
    return { ok: true, message: 'Offline' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    emitSyncStatus(msg, false)
    return { ok: false, message: msg }
  } finally {
    syncing = false
    if (pendingSync) {
      pendingSync = false
      void runSync(opts)
    }
  }
}

export async function bootstrapSync(): Promise<void> {
  const empty = await isLocalStoreEmpty()
  await runSync({ fullPull: empty })
}

/** Wipe local IndexedDB and re-download everything from Supabase. */
export async function resetLocalFromCloud(): Promise<{ ok: boolean; message: string }> {
  if (!navigator.onLine) {
    return { ok: false, message: 'Offline — connect to the internet first' }
  }
  await clearLocalStore()
  return runSync({ fullPull: true })
}

export function setSyncOnline(online: boolean): void {
  syncStatus = { ...syncStatus, online }
  syncListeners.forEach((l) => l(syncStatus))
  if (online) queueSync()
}
