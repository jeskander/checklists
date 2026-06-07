import { db } from '../db/database'
import type {
  ChecklistTemplate,
  Day,
  DayInstance,
  DayInstanceItem,
  SyncQueueEntry,
  TemplateItem,
} from '../db/types'
import { getNotionClient, hasFullNotionSchema, hasNotionConfig, NOTION_DS, queryNotionDatabase } from './notionClient'
import { newId, now } from '../lib/ids'

let syncTimer: ReturnType<typeof setTimeout> | null = null
let syncing = false
let pendingSync = false

/** Debounce background sync so typing does not trigger push+pull every few keystrokes. */
const SYNC_DEBOUNCE_MS = 2500

/** Gap between Notion API calls to avoid rate-limit retry storms. */
const NOTION_API_GAP_MS = 120

type SyncStatus = { busy: boolean; message: string }
const syncListeners = new Set<(s: SyncStatus) => void>()
let syncStatus: SyncStatus = { busy: false, message: '' }

function emitSyncStatus(message: string, busy = syncing): void {
  syncStatus = { busy, message }
  syncListeners.forEach((l) => l(syncStatus))
}

export function subscribeSyncStatus(listener: (s: SyncStatus) => void): () => void {
  syncListeners.add(listener)
  listener(syncStatus)
  return () => syncListeners.delete(listener)
}

const ENTITY_PUSH_ORDER: Record<string, number> = {
  template: 0,
  day: 1,
  templateItem: 2,
  dayInstance: 3,
  dayInstanceItem: 4,
}

export function queueSync(): void {
  if (!hasNotionConfig() || !hasFullNotionSchema()) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    void runSync()
  }, SYNC_DEBOUNCE_MS)
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

/** Local deletes are removed from Dexie immediately; skip Notion pull until delete is pushed. */
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

function isPendingDelete(pendingDeletes: Map<string, Set<string>>, kind: string, localId: string): boolean {
  return pendingDeletes.get(kind)?.has(localId) ?? false
}

async function pushQueueOps(
  client: NonNullable<ReturnType<typeof getNotionClient>>,
  ops: SyncQueueEntry[],
  label: string
): Promise<{ ok: boolean; message: string }> {
  if (ops.length === 0) return { ok: true, message: '' }
  let i = 0
  for (const op of ops) {
    i += 1
    emitSyncStatus(`${label} (${i}/${ops.length})…`, true)
    try {
      await processOp(client, op)
      await db.syncQueue.delete(op.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Push failed'
      return { ok: false, message: `${msg} (${op.entity} ${op.type})` }
    }
    await sleep(NOTION_API_GAP_MS)
  }
  return { ok: true, message: '' }
}

export async function runSync(): Promise<{ ok: boolean; message: string }> {
  if (!hasNotionConfig()) return { ok: false, message: 'No Notion token configured' }
  if (!hasFullNotionSchema()) return { ok: false, message: 'Notion database IDs missing in env' }

  if (syncing) {
    pendingSync = true
    return { ok: true, message: 'Queued — sync in progress…' }
  }

  syncing = true
  emitSyncStatus('Starting sync…', true)
  const syncStartedAt = now()

  try {
    const client = getNotionClient()
    if (!client) {
      emitSyncStatus('Notion client unavailable', false)
      return { ok: false, message: 'Notion client unavailable' }
    }

    const queue = sortSyncQueue(await db.syncQueue.orderBy('createdAt').toArray())
    const deleteOps = queue.filter((op) => op.type === 'delete')
    const pushOps = queue.filter((op) => op.type !== 'delete')

    const deleteResult = await pushQueueOps(client, deleteOps, 'Pushing deletions')
    if (!deleteResult.ok) return deleteResult

    emitSyncStatus('Pulling from Notion…', true)
    const pendingDeletes = await loadPendingDeleteIds()
    await pullAll(client, syncStartedAt, pendingDeletes)

    const pushResult = await pushQueueOps(client, pushOps, 'Pushing changes')
    if (!pushResult.ok) return pushResult

    emitSyncStatus('Uploading unsynced local rows…', true)
    await pushAllMissing(client)

    await db.syncMeta.put({
      id: 'main',
      lastPushAt: now(),
      lastPullAt: now(),
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
      void runSync()
    }
  }
}

async function pushAllMissing(client: NonNullable<ReturnType<typeof getNotionClient>>): Promise<void> {
  const templates = await db.checklistTemplates.filter((t) => !t.notionPageId).toArray()
  for (const t of templates) {
    await pushTemplate(client, t.id)
    await sleep(NOTION_API_GAP_MS)
  }

  const days = await db.days.filter((d) => !d.notionPageId).toArray()
  for (const d of days) {
    await pushDay(client, d.id)
    await sleep(NOTION_API_GAP_MS)
  }

  const templateItems = await db.templateItems.filter((i) => !i.notionPageId).toArray()
  for (const item of templateItems) {
    await pushTemplateItem(client, item.id)
    await sleep(NOTION_API_GAP_MS)
  }

  const instances = await db.dayInstances.filter((i) => !i.notionPageId).toArray()
  for (const inst of instances) {
    await pushDayInstance(client, inst.id)
    await sleep(NOTION_API_GAP_MS)
  }

  const instanceItems = await db.dayInstanceItems.filter((i) => !i.notionPageId).toArray()
  for (const item of instanceItems) {
    await pushDayInstanceItem(client, item.id)
    await sleep(NOTION_API_GAP_MS)
  }
}

async function processOp(
  client: ReturnType<typeof getNotionClient>,
  op: { type: string; entity: string; entityId: string; notionPageId?: string }
): Promise<void> {
  if (!client) return

  if (op.type === 'delete' && op.notionPageId) {
    await client.pages.update({ page_id: op.notionPageId, archived: true })
    return
  }

  if (op.type === 'create' || op.type === 'update') {
    await pushEntity(client, op.entity, op.entityId)
  }
}

async function pushEntity(
  client: NonNullable<ReturnType<typeof getNotionClient>>,
  entity: string,
  id: string
): Promise<void> {
  switch (entity) {
    case 'template':
      await pushTemplate(client, id)
      break
    case 'templateItem':
      await pushTemplateItem(client, id)
      break
    case 'day':
      await pushDay(client, id)
      break
    case 'dayInstance':
      await pushDayInstance(client, id)
      break
    case 'dayInstanceItem':
      await pushDayInstanceItem(client, id)
      break
  }
}

// Notion property payloads vary by workspace schema; cast for personal integration.
function props(data: Record<string, unknown>) {
  return data as Parameters<
    NonNullable<ReturnType<typeof getNotionClient>>['pages']['create']
  >[0]['properties']
}

async function pushTemplate(client: NonNullable<ReturnType<typeof getNotionClient>>, id: string) {
  const t = await db.checklistTemplates.get(id)
  if (!t || !NOTION_DS.templates) return

  const properties = props({
    Name: { title: [{ text: { content: t.title } }] },
    'Default duration': { number: t.defaultDurationMin },
    'Local ID': { rich_text: [{ text: { content: t.id } }] },
    'Sort order': { number: t.sortOrder },
  })

  if (t.notionPageId) {
    await client.pages.update({ page_id: t.notionPageId, properties })
  } else {
    const page = await client.pages.create({
      parent: { database_id: NOTION_DS.templates },
      properties,
    })
    await db.checklistTemplates.update(id, { notionPageId: page.id })
  }
}

async function pushTemplateItem(client: NonNullable<ReturnType<typeof getNotionClient>>, id: string) {
  const item = await db.templateItems.get(id)
  if (!item || !NOTION_DS.templateItems) return

  const template = await db.checklistTemplates.get(item.templateId)
  const properties = props({
    Name: { title: [{ text: { content: item.title } }] },
    'Local ID': { rich_text: [{ text: { content: item.id } }] },
    'Template Local ID': { rich_text: [{ text: { content: item.templateId } }] },
    'Sort order': { number: item.sortOrder },
    ...(item.parentItemId
      ? { 'Parent Local ID': { rich_text: [{ text: { content: item.parentItemId } }] } }
      : {}),
    ...(template?.notionPageId
      ? { Template: { relation: [{ id: template.notionPageId }] } }
      : {}),
  })

  if (item.notionPageId) {
    await client.pages.update({ page_id: item.notionPageId, properties })
  } else {
    const page = await client.pages.create({
      parent: { database_id: NOTION_DS.templateItems },
      properties,
    })
    await db.templateItems.update(id, { notionPageId: page.id })
  }
}

async function pushDay(client: NonNullable<ReturnType<typeof getNotionClient>>, id: string) {
  const day = await db.days.get(id)
  if (!day || !NOTION_DS.days) return

  const properties = props({
    Name: { title: [{ text: { content: day.date } }] },
    Date: { date: { start: day.date } },
    'Local ID': { rich_text: [{ text: { content: day.id } }] },
  })

  if (day.notionPageId) {
    await client.pages.update({ page_id: day.notionPageId, properties })
  } else {
    const page = await client.pages.create({
      parent: { database_id: NOTION_DS.days },
      properties,
    })
    await db.days.update(id, { notionPageId: page.id })
  }
}

async function pushDayInstance(client: NonNullable<ReturnType<typeof getNotionClient>>, id: string) {
  const inst = await db.dayInstances.get(id)
  if (!inst || !NOTION_DS.dayInstances) return

  const day = await db.days.get(inst.dayId)
  const startIso = new Date(inst.scheduledStartMs).toISOString()
  const properties = props({
    Name: { title: [{ text: { content: inst.title } }] },
    'Local ID': { rich_text: [{ text: { content: inst.id } }] },
    'Day Local ID': { rich_text: [{ text: { content: inst.dayId } }] },
    Duration: { number: inst.durationMin },
    'Sort order': { number: inst.sortOrder },
    Note: { rich_text: [{ text: { content: inst.noteJson ?? '' } }] },
    'Scheduled start': { date: { start: startIso } },
    'Added at': { date: { start: new Date(inst.addedAt).toISOString() } },
    Collapsed: { checkbox: inst.collapsed },
    ...(inst.sourceTemplateId
      ? { 'Source Local ID': { rich_text: [{ text: { content: inst.sourceTemplateId } }] } }
      : {}),
    ...(day?.notionPageId ? { Day: { relation: [{ id: day.notionPageId }] } } : {}),
  })

  if (inst.notionPageId) {
    await client.pages.update({ page_id: inst.notionPageId, properties })
  } else {
    const page = await client.pages.create({
      parent: { database_id: NOTION_DS.dayInstances },
      properties,
    })
    await db.dayInstances.update(id, { notionPageId: page.id })
  }
}

async function pushDayInstanceItem(
  client: NonNullable<ReturnType<typeof getNotionClient>>,
  id: string
) {
  const item = await db.dayInstanceItems.get(id)
  if (!item || !NOTION_DS.dayInstanceItems) return

  const inst = await db.dayInstances.get(item.instanceId)
  const properties = props({
    Name: { title: [{ text: { content: item.title } }] },
    'Local ID': { rich_text: [{ text: { content: item.id } }] },
    'Instance Local ID': { rich_text: [{ text: { content: item.instanceId } }] },
    'Sort order': { number: item.sortOrder },
    Completed: { checkbox: item.completed },
    ...(item.parentItemId
      ? { 'Parent Local ID': { rich_text: [{ text: { content: item.parentItemId } }] } }
      : {}),
    ...(inst?.notionPageId ? { Instance: { relation: [{ id: inst.notionPageId }] } } : {}),
  })

  if (item.notionPageId) {
    await client.pages.update({ page_id: item.notionPageId, properties })
  } else {
    const page = await client.pages.create({
      parent: { database_id: NOTION_DS.dayInstanceItems },
      properties,
    })
    await db.dayInstanceItems.update(id, { notionPageId: page.id })
  }
}

const PULL_LABELS: Record<string, string> = {
  template: 'templates',
  templateItem: 'template items',
  day: 'days',
  dayInstance: 'day blocks',
  dayInstanceItem: 'block items',
}

async function pullAll(
  client: NonNullable<ReturnType<typeof getNotionClient>>,
  syncStartedAt: number,
  pendingDeletes: Map<string, Set<string>>
): Promise<void> {
  const pulls: [string | undefined, string][] = [
    [NOTION_DS.templates, 'template'],
    [NOTION_DS.templateItems, 'templateItem'],
    [NOTION_DS.days, 'day'],
    [NOTION_DS.dayInstances, 'dayInstance'],
    [NOTION_DS.dayInstanceItems, 'dayInstanceItem'],
  ]
  for (const [dbId, kind] of pulls) {
    if (!dbId) continue
    emitSyncStatus(`Pulling ${PULL_LABELS[kind] ?? kind}…`, true)
    await pullDatabase(client, dbId, kind, syncStartedAt, pendingDeletes)
  }
}

async function pullDatabase(
  _client: NonNullable<ReturnType<typeof getNotionClient>>,
  databaseId: string,
  kind: string,
  syncStartedAt: number,
  pendingDeletes: Map<string, Set<string>>
): Promise<void> {
  let cursor: string | undefined
  do {
    const response = await queryNotionDatabase<{ properties?: Record<string, unknown>; last_edited_time?: string; id?: string }>(
      databaseId,
      cursor
    )
    for (const page of response.results) {
      if (!page.properties) continue
      await mergeFromNotion(kind, page, syncStartedAt, pendingDeletes)
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined
  } while (cursor)
}

/** Keep local text the user is typing if they edited after this sync run began. */
function keepLocalTextIfEditing<T extends { updatedAt: number; title: string }>(
  existing: T | undefined,
  merged: T,
  syncStartedAt: number
): T {
  if (!existing || existing.updatedAt <= syncStartedAt) return merged
  return { ...merged, title: existing.title, updatedAt: existing.updatedAt }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mergeFromNotion(
  kind: string,
  page: any,
  syncStartedAt: number,
  pendingDeletes: Map<string, Set<string>>
): Promise<void> {
  const localId = extractRichText(page.properties?.['Local ID']) ?? page.id
  if (isPendingDelete(pendingDeletes, kind, localId)) return
  const updatedAt = new Date(page.last_edited_time).getTime()

  switch (kind) {
    case 'template': {
      const existing = await db.checklistTemplates.get(localId)
      if (existing && existing.updatedAt > updatedAt) return
      const row: ChecklistTemplate = keepLocalTextIfEditing(
        existing,
        {
          id: localId,
          title: extractTitle(page.properties?.Name) ?? 'Untitled',
          defaultDurationMin: page.properties?.['Default duration']?.number ?? 15,
          sortOrder: page.properties?.['Sort order']?.number ?? 0,
          notionPageId: page.id,
          updatedAt,
        },
        syncStartedAt
      )
      await db.checklistTemplates.put(row)
      break
    }
    case 'templateItem': {
      const existing = await db.templateItems.get(localId)
      if (existing && existing.updatedAt > updatedAt) return
      const templateId = await resolveTemplateId(page, existing?.templateId)
      if (!templateId) return
      const row: TemplateItem = keepLocalTextIfEditing(
        existing,
        {
          id: localId,
          templateId,
          parentItemId: extractRichText(page.properties?.['Parent Local ID']),
          title: extractTitle(page.properties?.Name) ?? '',
          sortOrder: page.properties?.['Sort order']?.number ?? 0,
          notionPageId: page.id,
          updatedAt,
        },
        syncStartedAt
      )
      await db.templateItems.put(row)
      break
    }
    case 'day': {
      const existing = await db.days.get(localId)
      if (existing && existing.updatedAt > updatedAt) return
      const date =
        page.properties?.Date?.date?.start ??
        extractTitle(page.properties?.Name) ??
        todayFallback()
      const row: Day = { id: localId, date, notionPageId: page.id, updatedAt }
      await db.days.put(row)
      break
    }
    case 'dayInstance': {
      const existing = await db.dayInstances.get(localId)
      if (existing && existing.updatedAt > updatedAt) return
      const dayId = await resolveDayId(page, existing?.dayId)
      if (!dayId) return
      const scheduledStart =
        page.properties?.['Scheduled start']?.date?.start != null
          ? new Date(page.properties['Scheduled start'].date.start).getTime()
          : undefined
      const addedAt =
        page.properties?.['Added at']?.date?.start != null
          ? new Date(page.properties['Added at'].date.start).getTime()
          : undefined
      const noteFromNotion = extractRichText(page.properties?.Note)
      const noteJson =
        existing?.noteJson != null && existing.noteJson !== ''
          ? existing.noteJson
          : noteFromNotion
      const row: DayInstance = keepLocalTextIfEditing(
        existing,
        {
          id: localId,
          dayId,
          sourceTemplateId: extractRichText(page.properties?.['Source Local ID']),
          title: extractTitle(page.properties?.Name) ?? 'Block',
          durationMin: page.properties?.Duration?.number ?? 15,
          sortOrder: page.properties?.['Sort order']?.number ?? 0,
          scheduledStartMs: scheduledStart ?? existing?.scheduledStartMs ?? updatedAt,
          addedAt: addedAt ?? existing?.addedAt ?? updatedAt,
          noteJson,
          collapsed: page.properties?.Collapsed?.checkbox ?? existing?.collapsed ?? false,
          notionPageId: page.id,
          updatedAt,
        },
        syncStartedAt
      )
      await db.dayInstances.put(row)
      break
    }
    case 'dayInstanceItem': {
      const existing = await db.dayInstanceItems.get(localId)
      if (existing && existing.updatedAt > updatedAt) return
      const instanceId = await resolveInstanceId(page, existing?.instanceId)
      if (!instanceId) return
      const row: DayInstanceItem = keepLocalTextIfEditing(
        existing,
        {
          id: localId,
          instanceId,
          parentItemId: extractRichText(page.properties?.['Parent Local ID']),
          title: extractTitle(page.properties?.Name) ?? '',
          completed: page.properties?.Completed?.checkbox ?? false,
          sortOrder: page.properties?.['Sort order']?.number ?? 0,
          notionPageId: page.id,
          updatedAt,
        },
        syncStartedAt
      )
      await db.dayInstanceItems.put(row)
      break
    }
  }
}

function extractTitle(prop: { title?: { plain_text?: string }[] } | undefined): string | undefined {
  return prop?.title?.[0]?.plain_text
}

function extractRichText(
  prop: { rich_text?: { plain_text?: string }[] } | undefined
): string | undefined {
  return prop?.rich_text?.[0]?.plain_text
}

function extractRelationId(
  prop: { relation?: { id: string }[] } | undefined
): string | undefined {
  return prop?.relation?.[0]?.id
}

async function localIdForNotionPage(
  table: 'checklistTemplates' | 'days' | 'dayInstances',
  notionPageId: string | undefined
): Promise<string | undefined> {
  if (!notionPageId) return undefined
  const row = await db[table].filter((r) => r.notionPageId === notionPageId).first()
  return row?.id
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveTemplateId(page: any, fallback?: string): Promise<string | undefined> {
  const fromText = extractRichText(page.properties?.['Template Local ID'])
  if (fromText) return fromText
  if (fallback) return fallback
  const notionId = extractRelationId(page.properties?.Template)
  return localIdForNotionPage('checklistTemplates', notionId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveDayId(page: any, fallback?: string): Promise<string | undefined> {
  const fromText = extractRichText(page.properties?.['Day Local ID'])
  if (fromText) return fromText
  if (fallback) return fallback
  const notionId = extractRelationId(page.properties?.Day)
  return localIdForNotionPage('days', notionId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveInstanceId(page: any, fallback?: string): Promise<string | undefined> {
  const fromText = extractRichText(page.properties?.['Instance Local ID'])
  if (fromText) return fromText
  if (fallback) return fallback
  const notionId = extractRelationId(page.properties?.Instance)
  return localIdForNotionPage('dayInstances', notionId)
}

function todayFallback(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function enqueueSync(
  type: 'create' | 'update' | 'delete',
  entity: string,
  id: string,
  notionPageId?: string
): Promise<void> {
  const existing = await db.syncQueue
    .filter((op) => op.entity === entity && op.entityId === id)
    .toArray()
  for (const op of existing) await db.syncQueue.delete(op.id)

  await db.syncQueue.put({
    id: newId(),
    type,
    entity,
    entityId: id,
    notionPageId,
    createdAt: now(),
  })
  queueSync()
}
