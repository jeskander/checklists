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
import { pullFromSupabase } from './bootstrapPull'

let syncing = false
let pendingSync = false
let pushing = false
let pendingPush = false
let pullTimer: ReturnType<typeof setTimeout> | null = null

const API_GAP_MS = 80
const PULL_DEBOUNCE_MS = 400

type SyncStatus = { busy: boolean; message: string; online: boolean }
const syncListeners = new Set<(s: SyncStatus) => void>()
let syncStatus: SyncStatus = {
  busy: false,
  message: '',
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
}

let bootstrapReady = false
const bootstrapListeners = new Set<(ready: boolean, message: string) => void>()

function emitSyncStatus(message: string, busy = syncing || pushing): void {
  syncStatus = { ...syncStatus, busy, message }
  syncListeners.forEach((l) => l(syncStatus))
}

function emitBootstrap(ready: boolean, message = ''): void {
  bootstrapReady = ready
  bootstrapListeners.forEach((l) => l(ready, message))
}

export function subscribeSyncStatus(listener: (s: SyncStatus) => void): () => void {
  syncListeners.add(listener)
  listener(syncStatus)
  return () => syncListeners.delete(listener)
}

export function subscribeBootstrap(
  listener: (ready: boolean, message: string) => void
): () => void {
  bootstrapListeners.add(listener)
  listener(bootstrapReady, syncStatus.message)
  return () => bootstrapListeners.delete(listener)
}

export function isBootstrapReady(): boolean {
  return bootstrapReady
}

export function resetBootstrapState(): void {
  emitBootstrap(false, '')
}

export function isOnline(): boolean {
  return syncStatus.online
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

function requireOnline(): void {
  if (!navigator.onLine) {
    throw new Error('Offline — connect to the internet to save changes')
  }
}

function sortSyncQueue(ops: SyncQueueEntry[]): SyncQueueEntry[] {
  return [...ops].sort((a, b) => {
    if (a.type === 'delete' && b.type !== 'delete') return -1
    if (b.type === 'delete' && a.type !== 'delete') return 1
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
      const { error } = await supabase
        .from('day_instance_items')
        .upsert(dayInstanceItemToRow(row) as never)
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

async function pushQueueOps(
  ops: SyncQueueEntry[],
  label: string
): Promise<{ ok: boolean; message: string }> {
  if (ops.length === 0) return { ok: true, message: '' }
  requireOnline()

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
      return { ok: false, message: `${msg} — ${op.entity} ${op.type} ${op.entityId}` }
    }
    await sleep(API_GAP_MS)
  }
  return { ok: true, message: '' }
}

/** Push all pending local changes to Supabase immediately. */
export async function flushPush(): Promise<{ ok: boolean; message: string }> {
  if (pushing) {
    pendingPush = true
    return { ok: true, message: 'Queued — upload in progress…' }
  }

  pushing = true
  try {
    while (true) {
      const queue = sortSyncQueue(await db.syncQueue.orderBy('createdAt').toArray())
      if (queue.length === 0) break

      const deleteOps = queue.filter((op) => op.type === 'delete')
      const upsertOps = queue.filter((op) => op.type !== 'delete')

      const deleteResult = await pushQueueOps(deleteOps, 'Uploading deletions')
      if (!deleteResult.ok) {
        emitSyncStatus(deleteResult.message, false)
        return deleteResult
      }

      const pushResult = await pushQueueOps(upsertOps, 'Uploading changes')
      if (!pushResult.ok) {
        emitSyncStatus(pushResult.message, false)
        return pushResult
      }
    }

    const pending = await db.syncQueue.count()
    if (pending === 0) {
      await db.syncMeta.put({
        id: 'main',
        lastPullAt: (await db.syncMeta.get('main'))?.lastPullAt ?? now(),
        lastPushAt: now(),
      })
      if (!syncing) emitSyncStatus('', false)
    }
    return { ok: true, message: 'Uploaded' }
  } finally {
    pushing = false
    if (pendingPush) {
      pendingPush = false
      void flushPush()
    }
  }
}

/** Queue a change and upload to Supabase immediately. */
export async function enqueueSync(
  type: 'create' | 'update' | 'delete',
  entity: string,
  entityId: string
): Promise<void> {
  requireOnline()

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

  const result = await flushPush()
  if (!result.ok) throw new Error(result.message)
}

/** Debounced pull from Supabase (for realtime / tab focus). */
export function queuePull(opts?: { full?: boolean }): void {
  if (!bootstrapReady) return
  if (pullTimer) clearTimeout(pullTimer)
  pullTimer = setTimeout(() => {
    void pullFromCloud(opts)
  }, PULL_DEBOUNCE_MS)
}

async function pullFromCloud(opts?: { full?: boolean }): Promise<void> {
  if (!navigator.onLine || !bootstrapReady) return
  if (syncing) {
    pendingSync = true
    return
  }

  syncing = true
  emitSyncStatus('Updating from cloud…', true)
  try {
    await pullFromSupabase(opts?.full ?? false, undefined, { reconcile: opts?.full ?? false })
    const { dedupeInboxLists } = await import('../services/taskLists')
    await dedupeInboxLists()
    await db.syncMeta.put({
      id: 'main',
      lastPullAt: now(),
      lastPushAt: (await db.syncMeta.get('main'))?.lastPushAt,
    })
    emitSyncStatus('', false)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Update failed'
    emitSyncStatus(msg, false)
  } finally {
    syncing = false
    if (pendingSync) {
      pendingSync = false
      void pullFromCloud(opts)
    }
  }
}

export async function runSync(opts?: {
  fullPull?: boolean
  pullOnly?: boolean
}): Promise<{ ok: boolean; message: string }> {
  if (!navigator.onLine) {
    emitSyncStatus('Offline — connect to sync', false)
    return { ok: false, message: 'Offline' }
  }

  if (syncing) {
    pendingSync = true
    return { ok: true, message: 'Queued — sync in progress…' }
  }

  syncing = true
  emitSyncStatus('Syncing…', true)

  try {
    await pullFromSupabase(opts?.fullPull ?? false, undefined, {
      reconcile: opts?.fullPull ?? false,
    })

    const { dedupeInboxLists } = await import('../services/taskLists')
    await dedupeInboxLists()

    if (!opts?.pullOnly) {
      const pushResult = await flushPush()
      if (!pushResult.ok) return pushResult
    }

    await db.syncMeta.put({
      id: 'main',
      lastPullAt: now(),
      lastPushAt: now(),
    })

    emitSyncStatus('Synced', false)
    return { ok: true, message: 'Synced' }
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

/** Online-first startup: wipe local cache and load everything from Supabase. */
export async function bootstrapSync(): Promise<void> {
  emitBootstrap(false, 'Loading from cloud…')

  if (!navigator.onLine) {
    emitSyncStatus('Offline — connect to load your data', false)
    emitBootstrap(false, 'Offline — connect to load your data')
    return
  }

  if (syncing) return
  syncing = true
  emitSyncStatus('Loading from cloud…', true)

  try {
    await clearLocalStore()
    await pullFromSupabase(true, (p) => emitSyncStatus(p.stage, true), { reconcile: true })

    const { dedupeInboxLists } = await import('../services/taskLists')
    await dedupeInboxLists()

    await db.syncMeta.put({
      id: 'main',
      lastPullAt: now(),
      lastPushAt: now(),
    })

    emitSyncStatus('', false)
    emitBootstrap(true, '')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load from cloud'
    emitSyncStatus(msg, false)
    emitBootstrap(false, msg)
  } finally {
    syncing = false
  }
}

/** Wipe local cache and re-download from Supabase (no upload). */
export async function resetLocalFromCloud(): Promise<{ ok: boolean; message: string }> {
  if (!navigator.onLine) {
    return { ok: false, message: 'Offline — connect to the internet first' }
  }

  emitBootstrap(false, 'Resetting from cloud…')
  syncing = true
  emitSyncStatus('Resetting from cloud…', true)

  try {
    await clearLocalStore()
    await pullFromSupabase(true, (p) => emitSyncStatus(p.stage, true), { reconcile: true })

    const { dedupeInboxLists } = await import('../services/taskLists')
    await dedupeInboxLists()

    await db.syncMeta.put({
      id: 'main',
      lastPullAt: now(),
      lastPushAt: now(),
    })

    emitSyncStatus('Reset complete', false)
    emitBootstrap(true, '')
    return { ok: true, message: 'Reset complete' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Reset failed'
    emitSyncStatus(msg, false)
    emitBootstrap(false, msg)
    return { ok: false, message: msg }
  } finally {
    syncing = false
  }
}

export function setSyncOnline(online: boolean): void {
  syncStatus = { ...syncStatus, online }
  syncListeners.forEach((l) => l(syncStatus))
  if (online && bootstrapReady) queuePull()
  if (online && !bootstrapReady) void bootstrapSync()
}
