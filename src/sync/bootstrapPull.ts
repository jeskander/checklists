import { db } from '../db/database'
import type {
  ChecklistTemplate,
  Day,
  DayFreeTime,
  DayInstance,
  DayInstanceItem,
  TaskList,
  TaskListItem,
  TemplateItem,
} from '../db/types'
import { supabase } from '../lib/supabaseClient'
import { columnsToRepeat, dbToImportance, toMs } from '../lib/supabaseHelpers'
import { now } from '../lib/ids'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTemplate(row: any): ChecklistTemplate {
  return {
    id: row.id,
    title: row.title,
    defaultDurationMin: row.default_duration_min,
    sortOrder: row.sort_order,
    updatedAt: toMs(row.updated_at),
    repeat: columnsToRepeat(row),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTaskList(row: any): TaskList {
  return {
    id: row.id,
    title: row.title,
    defaultDurationMin: row.default_duration_min,
    sortOrder: row.sort_order,
    updatedAt: toMs(row.updated_at),
    repeat: columnsToRepeat(row),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTemplateItem(row: any): TemplateItem {
  return {
    id: row.id,
    templateId: row.block_id,
    parentItemId: row.parent_item_id ?? undefined,
    title: row.title,
    sortOrder: row.sort_order,
    updatedAt: toMs(row.updated_at),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTaskListItem(row: any): TaskListItem {
  return {
    id: row.id,
    taskListId: row.block_id,
    parentItemId: row.parent_item_id ?? undefined,
    title: row.title,
    importance: dbToImportance(row.importance),
    durationMin: row.duration_min ?? 15,
    sortOrder: row.sort_order,
    completedAt: row.completed_at ? toMs(row.completed_at) : undefined,
    deadline: row.deadline ?? undefined,
    updatedAt: toMs(row.updated_at),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDay(row: any): Day {
  return { id: row.id, date: row.date, updatedAt: toMs(row.updated_at) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDayFreeTime(row: any): DayFreeTime {
  return {
    id: row.id,
    dayId: row.day_id,
    sortOrder: row.sort_order,
    durationMin: row.duration_min,
    altGroupId: row.alt_group_id ?? undefined,
    altGroupIndex: row.alt_group_index ?? undefined,
    altStackIndex: row.alt_stack_index ?? undefined,
    updatedAt: toMs(row.updated_at),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rowToDayInstance(row: any): Promise<DayInstance> {
  const sourceId = row.source_block_id as string | null
  let sourceTemplateId: string | undefined
  let sourceTaskListId: string | undefined
  if (sourceId) {
    const template = await db.checklistTemplates.get(sourceId)
    const taskList = await db.taskLists.get(sourceId)
    if (template) sourceTemplateId = sourceId
    else if (taskList) sourceTaskListId = sourceId
    else {
      // Block not pulled yet — infer from remote kind if available
      const kind = row.library_blocks?.kind
      if (kind === 'checklist') sourceTemplateId = sourceId
      else if (kind === 'task_list') sourceTaskListId = sourceId
    }
  }
  return {
    id: row.id,
    dayId: row.day_id,
    sourceTemplateId,
    sourceTaskListId,
    title: row.title,
    durationMin: row.duration_min,
    sortOrder: row.sort_order,
    scheduledStartMs: toMs(row.scheduled_start),
    timerStartedAt: row.timer_started_at ? toMs(row.timer_started_at) : undefined,
    addedAt: toMs(row.added_at),
    noteJson: row.note_json ?? undefined,
    collapsed: row.collapsed,
    altGroupId: row.alt_group_id ?? undefined,
    altGroupIndex: row.alt_group_index ?? undefined,
    altStackIndex: row.alt_stack_index ?? undefined,
    updatedAt: toMs(row.updated_at),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDayInstanceItem(row: any): DayInstanceItem {
  return {
    id: row.id,
    instanceId: row.instance_id,
    parentItemId: row.parent_item_id ?? undefined,
    sourceTaskListItemId: row.source_block_item_id ?? undefined,
    title: row.title,
    durationMin: row.duration_min || undefined,
    deadline: row.deadline ?? undefined,
    completed: row.completed,
    sortOrder: row.sort_order,
    updatedAt: toMs(row.updated_at),
  }
}

async function mergeIfNewer<T extends { id: string; updatedAt: number }>(
  table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<unknown> },
  row: T,
  pendingDeleteIds: Set<string>
): Promise<void> {
  if (pendingDeleteIds.has(row.id)) return
  const existing = await table.get(row.id)
  if (existing && existing.updatedAt > row.updatedAt) return
  await table.put(row)
}

async function loadPendingDeleteIds(): Promise<Map<string, Set<string>>> {
  const ops = await db.syncQueue.filter((op) => op.type === 'delete').toArray()
  const map = new Map<string, Set<string>>()
  for (const op of ops) {
    let ids = map.get(op.entity)
    if (!ids) {
      ids = new Set()
      map.set(op.entity, ids)
    }
    ids.add(op.entityId)
  }
  return map
}

export type PullProgress = { stage: string }

/** Pull all remote data into Dexie (bootstrap or incremental). */
export async function pullFromSupabase(
  full = false,
  onProgress?: (p: PullProgress) => void
): Promise<void> {
  const meta = await db.syncMeta.get('main')
  const since = full ? undefined : meta?.lastPullAt
  const sinceIso = since ? new Date(since).toISOString() : undefined
  const pendingDeletes = await loadPendingDeleteIds()

  const stage = (name: string) => onProgress?.({ stage: name })

  // ── Library blocks (templates + task lists) ───────────────────────────────
  stage('Templates & task lists')
  const blocksQuery = sinceIso
    ? supabase.from('library_blocks').select('*').gte('updated_at', sinceIso)
    : supabase.from('library_blocks').select('*')
  const { data: blocks, error: blocksErr } = await blocksQuery
  if (blocksErr) throw blocksErr

  for (const row of (blocks ?? []) as Array<Record<string, unknown>>) {
    if (row.kind === 'checklist') {
      await mergeIfNewer(
        {
          get: (id) => db.checklistTemplates.get(id),
          put: (r) => db.checklistTemplates.put(r),
        },
        rowToTemplate(row),
        pendingDeletes.get('template') ?? new Set()
      )
    } else if (row.kind === 'task_list') {
      await mergeIfNewer(
        {
          get: (id) => db.taskLists.get(id),
          put: (r) => db.taskLists.put(r),
        },
        rowToTaskList(row),
        pendingDeletes.get('taskList') ?? new Set()
      )
    }
  }

  // ── Block items ───────────────────────────────────────────────────────────
  stage('Items')
  const itemsQuery = sinceIso
    ? supabase.from('block_items').select('*').gte('updated_at', sinceIso)
    : supabase.from('block_items').select('*')
  const { data: blockItems, error: itemsErr } = await itemsQuery
  if (itemsErr) throw itemsErr

  for (const row of (blockItems ?? []) as Array<Record<string, unknown>>) {
    const template = await db.checklistTemplates.get(String(row.block_id))
    if (template) {
      await mergeIfNewer(
        {
          get: (id) => db.templateItems.get(id),
          put: (r) => db.templateItems.put(r),
        },
        rowToTemplateItem(row),
        pendingDeletes.get('templateItem') ?? new Set()
      )
    } else {
      await mergeIfNewer(
        {
          get: (id) => db.taskListItems.get(id),
          put: (r) => db.taskListItems.put(r),
        },
        rowToTaskListItem(row),
        pendingDeletes.get('taskListItem') ?? new Set()
      )
    }
  }

  // ── Days (match by date when ids differ) ──────────────────────────────────
  stage('Days')
  const daysQuery = sinceIso
    ? supabase.from('days').select('*').gte('updated_at', sinceIso)
    : supabase.from('days').select('*')
  const { data: days, error: daysErr } = await daysQuery
  if (daysErr) throw daysErr

  for (const row of days ?? []) {
    const remote = rowToDay(row)
    const pending = pendingDeletes.get('day') ?? new Set()
    if (pending.has(remote.id)) continue

    const existingById = await db.days.get(remote.id)
    const existingByDate = await db.days.where('date').equals(remote.date).first()

    if (existingById) {
      if (existingById.updatedAt <= remote.updatedAt) await db.days.put(remote)
    } else if (existingByDate) {
      if (existingByDate.updatedAt <= remote.updatedAt) {
        // Remap local day id to remote id
        await remapDayId(existingByDate.id, remote)
      }
    } else {
      await db.days.put(remote)
    }
  }

  // ── Day instances ─────────────────────────────────────────────────────────
  stage('Day blocks')
  const instQuery = sinceIso
    ? supabase.from('day_instances').select('*, library_blocks(kind)').gte('updated_at', sinceIso)
    : supabase.from('day_instances').select('*, library_blocks(kind)')
  const { data: instances, error: instErr } = await instQuery
  if (instErr) throw instErr

  for (const row of instances ?? []) {
    const inst = await rowToDayInstance(row)
    await mergeIfNewer(
      {
        get: (id) => db.dayInstances.get(id),
        put: (r) => db.dayInstances.put(r),
      },
      inst,
      pendingDeletes.get('dayInstance') ?? new Set()
    )
  }

  // ── Day free times ────────────────────────────────────────────────────────
  stage('Free time')
  const freeQuery = sinceIso
    ? supabase.from('day_free_times').select('*').gte('updated_at', sinceIso)
    : supabase.from('day_free_times').select('*')
  const { data: freeTimes, error: freeErr } = await freeQuery
  if (freeErr) throw freeErr

  for (const row of freeTimes ?? []) {
    await mergeIfNewer(
      {
        get: (id) => db.dayFreeTimes.get(id),
        put: (r) => db.dayFreeTimes.put(r),
      },
      rowToDayFreeTime(row),
      pendingDeletes.get('dayFreeTime') ?? new Set()
    )
  }

  // ── Day instance items ────────────────────────────────────────────────────
  stage('Block items')
  const diQuery = sinceIso
    ? supabase.from('day_instance_items').select('*').gte('updated_at', sinceIso)
    : supabase.from('day_instance_items').select('*')
  const { data: diItems, error: diErr } = await diQuery
  if (diErr) throw diErr

  for (const row of diItems ?? []) {
    await mergeIfNewer(
      {
        get: (id) => db.dayInstanceItems.get(id),
        put: (r) => db.dayInstanceItems.put(r),
      },
      rowToDayInstanceItem(row),
      pendingDeletes.get('dayInstanceItem') ?? new Set()
    )
  }

  await db.syncMeta.put({
    id: 'main',
    lastPullAt: now(),
    lastPushAt: meta?.lastPushAt,
  })
}

/** Remap a local day id to match remote when dates collide. */
async function remapDayId(localId: string, remote: Day): Promise<void> {
  if (localId === remote.id) {
    await db.days.put(remote)
    return
  }

  await db.transaction('rw', [db.days, db.dayInstances, db.dayFreeTimes], async () => {
    const instances = await db.dayInstances.where('dayId').equals(localId).toArray()
    const freeTimes = await db.dayFreeTimes.where('dayId').equals(localId).toArray()
    await db.days.delete(localId)
    await db.days.put(remote)
    for (const inst of instances) {
      await db.dayInstances.update(inst.id, { dayId: remote.id, updatedAt: now() })
    }
    for (const f of freeTimes) {
      await db.dayFreeTimes.update(f.id, { dayId: remote.id, updatedAt: now() })
    }
  })
}

/** True when local Dexie has no user data yet. */
export async function isLocalStoreEmpty(): Promise<boolean> {
  const counts = await Promise.all([
    db.checklistTemplates.count(),
    db.taskLists.count(),
    db.days.count(),
    db.dayInstances.count(),
  ])
  return counts.every((c) => c === 0)
}
