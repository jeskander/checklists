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
import { INBOX_LIST_TITLE } from '../lib/inbox'
import { supabase } from '../lib/supabaseClient'
import { columnsToRepeat, dbToImportance, toMs } from '../lib/supabaseHelpers'
import { now } from '../lib/ids'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToTemplate(row: any): ChecklistTemplate {
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
export function rowToTaskList(row: any): TaskList {
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
export function rowToDay(row: any): Day {
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
    createdByRepeat: row.created_by_repeat ?? undefined,
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
  pendingDeleteIds: Set<string>,
  pendingUpsertIds: Set<string>
): Promise<void> {
  if (pendingDeleteIds.has(row.id)) return
  if (pendingUpsertIds.has(row.id)) return
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

async function loadPendingUpsertIds(): Promise<Map<string, Set<string>>> {
  const ops = await db.syncQueue.filter((op) => op.type !== 'delete').toArray()
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

async function pruneLocalIds<T extends { id: string }>(
  table: { toArray: () => Promise<T[]>; delete: (id: string) => Promise<void> },
  remoteIds: Set<string>,
  pendingUpsertIds: Set<string>
): Promise<void> {
  const local = await table.toArray()
  for (const row of local) {
    if (!remoteIds.has(row.id) && !pendingUpsertIds.has(row.id)) await table.delete(row.id)
  }
}

export type PullProgress = { stage: string }

export type PullOptions = { reconcile?: boolean }

/** Fetch a day from Supabase by calendar date (cloud-first create). */
export async function fetchDayByDateFromCloud(date: string): Promise<Day | undefined> {
  const { data, error } = await supabase.from('days').select('*').eq('date', date).maybeSingle()
  if (error) throw error
  return data ? rowToDay(data) : undefined
}

/** Fetch the Inbox task list from Supabase if it exists. */
export async function fetchInboxFromCloud(): Promise<TaskList | undefined> {
  const { data, error } = await supabase
    .from('library_blocks')
    .select('*')
    .eq('kind', 'task_list')
    .ilike('title', INBOX_LIST_TITLE)
  if (error) throw error
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const row = rows.find(
    (r) => String(r.title).trim().toLowerCase() === INBOX_LIST_TITLE.toLowerCase()
  )
  return row ? rowToTaskList(row) : undefined
}

/** Pull remote data into Dexie. Full pull with reconcile makes local match Supabase exactly. */
export async function pullFromSupabase(
  full = false,
  onProgress?: (p: PullProgress) => void,
  opts?: PullOptions
): Promise<void> {
  const meta = await db.syncMeta.get('main')
  const since = full ? undefined : meta?.lastPullAt
  const sinceIso = since ? new Date(since).toISOString() : undefined
  const pendingDeletes = await loadPendingDeleteIds()
  const pendingUpserts = await loadPendingUpsertIds()
  const reconcile = full && (opts?.reconcile ?? false)

  const stage = (name: string) => onProgress?.({ stage: name })

  const templateIds = new Set<string>()
  const taskListIds = new Set<string>()
  const templateItemIds = new Set<string>()
  const taskListItemIds = new Set<string>()
  const dayIds = new Set<string>()
  const dayInstanceIds = new Set<string>()
  const dayFreeTimeIds = new Set<string>()
  const dayInstanceItemIds = new Set<string>()

  // ── Library blocks (templates + task lists) ───────────────────────────────
  stage('Templates & task lists')
  const blocksQuery = sinceIso
    ? supabase.from('library_blocks').select('*').gte('updated_at', sinceIso)
    : supabase.from('library_blocks').select('*')
  const { data: blocks, error: blocksErr } = await blocksQuery
  if (blocksErr) throw blocksErr

  for (const row of (blocks ?? []) as Array<Record<string, unknown>>) {
    if (row.kind === 'checklist') {
      templateIds.add(String(row.id))
      await mergeIfNewer(
        {
          get: (id) => db.checklistTemplates.get(id),
          put: (r) => db.checklistTemplates.put(r),
        },
        rowToTemplate(row),
        pendingDeletes.get('template') ?? new Set(),
        pendingUpserts.get('template') ?? new Set()
      )
    } else if (row.kind === 'task_list') {
      taskListIds.add(String(row.id))
      await mergeIfNewer(
        {
          get: (id) => db.taskLists.get(id),
          put: (r) => db.taskLists.put(r),
        },
        rowToTaskList(row),
        pendingDeletes.get('taskList') ?? new Set(),
        pendingUpserts.get('taskList') ?? new Set()
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
    const blockId = String(row.block_id)
    const template = await db.checklistTemplates.get(blockId)
    if (template || templateIds.has(blockId)) {
      templateItemIds.add(String(row.id))
      await mergeIfNewer(
        {
          get: (id) => db.templateItems.get(id),
          put: (r) => db.templateItems.put(r),
        },
        rowToTemplateItem(row),
        pendingDeletes.get('templateItem') ?? new Set(),
        pendingUpserts.get('templateItem') ?? new Set()
      )
    } else {
      taskListItemIds.add(String(row.id))
      await mergeIfNewer(
        {
          get: (id) => db.taskListItems.get(id),
          put: (r) => db.taskListItems.put(r),
        },
        rowToTaskListItem(row),
        pendingDeletes.get('taskListItem') ?? new Set(),
        pendingUpserts.get('taskListItem') ?? new Set()
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
    dayIds.add(remote.id)
    const pending = pendingDeletes.get('day') ?? new Set()
    const pendingUpsert = pendingUpserts.get('day') ?? new Set()
    if (pending.has(remote.id)) continue

    const existingById = await db.days.get(remote.id)
    const existingByDate = await db.days.where('date').equals(remote.date).first()

    if (existingById) {
      if (pendingUpsert.has(existingById.id)) continue
      if (existingById.updatedAt <= remote.updatedAt) await db.days.put(remote)
    } else if (existingByDate) {
      if (pendingUpsert.has(existingByDate.id)) continue
      if (existingByDate.updatedAt <= remote.updatedAt) {
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
    dayInstanceIds.add(inst.id)
    await mergeIfNewer(
      {
        get: (id) => db.dayInstances.get(id),
        put: (r) => db.dayInstances.put(r),
      },
      inst,
      pendingDeletes.get('dayInstance') ?? new Set(),
      pendingUpserts.get('dayInstance') ?? new Set()
    )
  }

  // ── Day free times ────────────────────────────────────────────────────────
  stage('Free time')
  const freeQuery = sinceIso
    ? supabase.from('day_free_times').select('*').gte('updated_at', sinceIso)
    : supabase.from('day_free_times').select('*')
  const { data: freeTimes, error: freeErr } = await freeQuery
  if (freeErr) throw freeErr

  for (const row of (freeTimes ?? []) as Array<Record<string, unknown>>) {
    dayFreeTimeIds.add(String(row.id))
    await mergeIfNewer(
      {
        get: (id) => db.dayFreeTimes.get(id),
        put: (r) => db.dayFreeTimes.put(r),
      },
      rowToDayFreeTime(row),
      pendingDeletes.get('dayFreeTime') ?? new Set(),
      pendingUpserts.get('dayFreeTime') ?? new Set()
    )
  }

  // ── Day instance items ────────────────────────────────────────────────────
  stage('Block items')
  const diQuery = sinceIso
    ? supabase.from('day_instance_items').select('*').gte('updated_at', sinceIso)
    : supabase.from('day_instance_items').select('*')
  const { data: diItems, error: diErr } = await diQuery
  if (diErr) throw diErr

  for (const row of (diItems ?? []) as Array<Record<string, unknown>>) {
    dayInstanceItemIds.add(String(row.id))
    await mergeIfNewer(
      {
        get: (id) => db.dayInstanceItems.get(id),
        put: (r) => db.dayInstanceItems.put(r),
      },
      rowToDayInstanceItem(row),
      pendingDeletes.get('dayInstanceItem') ?? new Set(),
      pendingUpserts.get('dayInstanceItem') ?? new Set()
    )
  }

  if (reconcile) {
    stage('Reconciling…')
    await pruneLocalIds(db.checklistTemplates, templateIds, pendingUpserts.get('template') ?? new Set())
    await pruneLocalIds(db.taskLists, taskListIds, pendingUpserts.get('taskList') ?? new Set())
    await pruneLocalIds(db.templateItems, templateItemIds, pendingUpserts.get('templateItem') ?? new Set())
    await pruneLocalIds(db.taskListItems, taskListItemIds, pendingUpserts.get('taskListItem') ?? new Set())
    await pruneLocalIds(db.days, dayIds, pendingUpserts.get('day') ?? new Set())
    await pruneLocalIds(db.dayInstances, dayInstanceIds, pendingUpserts.get('dayInstance') ?? new Set())
    await pruneLocalIds(db.dayFreeTimes, dayFreeTimeIds, pendingUpserts.get('dayFreeTime') ?? new Set())
    await pruneLocalIds(
      db.dayInstanceItems,
      dayInstanceItemIds,
      pendingUpserts.get('dayInstanceItem') ?? new Set()
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
