import { db } from '../db/database'
import type { ChecklistTemplate, TemplateItem } from '../db/types'
import { newId, now } from '../lib/ids'
import { flatToStructure, flattenItemTree, type ItemTreeStructureRow } from '../lib/itemTreeMove'
import { canReparentUnder } from '../lib/listItems'
import { enqueueSync } from '../sync/syncEngine'

// ─── Templates ───────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<ChecklistTemplate[]> {
  return db.checklistTemplates.orderBy('sortOrder').toArray()
}

export async function getTemplate(id: string): Promise<ChecklistTemplate | undefined> {
  return db.checklistTemplates.get(id)
}

export async function createTemplate(
  title: string,
  defaultDurationMin = 15
): Promise<ChecklistTemplate> {
  const existing = await db.checklistTemplates.orderBy('sortOrder').reverse().first()
  const sortOrder = existing ? existing.sortOrder + 1 : 0
  const template: ChecklistTemplate = {
    id: newId(),
    title,
    defaultDurationMin,
    sortOrder,
    updatedAt: now(),
  }
  await db.checklistTemplates.add(template)
  await enqueueSync('create', 'template', template.id)
  return template
}

export async function updateTemplate(
  id: string,
  patch: Partial<Pick<ChecklistTemplate, 'title' | 'defaultDurationMin' | 'sortOrder' | 'repeat'>>
): Promise<void> {
  const existing = await db.checklistTemplates.get(id)
  if (!existing) return
  const updated: ChecklistTemplate = {
    ...existing,
    ...patch,
    updatedAt: now(),
  }
  await db.checklistTemplates.put(updated)
  await enqueueSync('update', 'template', id)
}

export async function deleteTemplate(id: string): Promise<void> {
  const items = await db.templateItems.where('templateId').equals(id).toArray()
  await db.transaction('rw', [db.checklistTemplates, db.templateItems, db.syncQueue], async () => {
    for (const item of items) {
      await db.templateItems.delete(item.id)
      await enqueueSync('delete', 'templateItem', item.id)
    }
    await db.checklistTemplates.delete(id)
    await enqueueSync('delete', 'template', id)
  })
}

export async function restoreTemplate(template: ChecklistTemplate): Promise<void> {
  await db.checklistTemplates.put({ ...template, updatedAt: now() })
  await enqueueSync('update', 'template', template.id)
}

export async function restoreTemplateItems(items: TemplateItem[]): Promise<void> {
  for (const item of items) {
    await db.templateItems.put({ ...item, updatedAt: now() })
    await enqueueSync('update', 'templateItem', item.id)
  }
}

export async function setTemplateSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateTemplate(id, { sortOrder })))
}

// ─── Template items ──────────────────────────────────────────────────────────

export async function listTemplateItems(templateId: string): Promise<TemplateItem[]> {
  const items = await db.templateItems.where('templateId').equals(templateId).toArray()
  return items.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function addTemplateItem(
  templateId: string,
  title: string,
  parentItemId?: string
): Promise<TemplateItem> {
  const siblings = await db.templateItems
    .where('templateId')
    .equals(templateId)
    .filter((i) => (i.parentItemId ?? undefined) === parentItemId)
    .toArray()
  const sortOrder = siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0

  const item: TemplateItem = {
    id: newId(),
    templateId,
    parentItemId,
    title,
    sortOrder,
    updatedAt: now(),
  }
  await db.templateItems.add(item)
  await updateTemplate(templateId, {})
  await enqueueSync('create', 'templateItem', item.id)
  return item
}

export async function addTemplateItemAfter(
  templateId: string,
  afterItemId: string,
  title = ''
): Promise<TemplateItem> {
  const afterRow = await db.templateItems.get(afterItemId)
  if (!afterRow) return addTemplateItem(templateId, title)

  const parentItemId = afterRow.parentItemId
  const insertAt = afterRow.sortOrder + 1

  const toShift = await db.templateItems
    .where('templateId')
    .equals(templateId)
    .filter((i) => (i.parentItemId ?? undefined) === (parentItemId ?? undefined) && i.sortOrder >= insertAt)
    .toArray()

  for (const s of toShift) {
    await db.templateItems.update(s.id, { sortOrder: s.sortOrder + 1, updatedAt: now() })
    await enqueueSync('update', 'templateItem', s.id)
  }

  const item: TemplateItem = {
    id: newId(),
    templateId,
    parentItemId,
    title,
    sortOrder: insertAt,
    updatedAt: now(),
  }
  await db.templateItems.add(item)
  await updateTemplate(templateId, {})
  await enqueueSync('create', 'templateItem', item.id)
  return item
}

export async function reparentTemplateItem(itemId: string, newParentId?: string): Promise<void> {
  const item = await db.templateItems.get(itemId)
  if (!item || (item.parentItemId ?? undefined) === newParentId) return

  const allItems = await listTemplateItems(item.templateId)
  if (newParentId && !canReparentUnder(allItems, itemId, newParentId)) return

  const newSiblings = allItems.filter(
    (i) => i.id !== itemId && (i.parentItemId ?? undefined) === newParentId
  )
  const newSortOrder = newSiblings.length ? Math.max(...newSiblings.map((s) => s.sortOrder)) + 1 : 0

  await db.templateItems.update(itemId, {
    parentItemId: newParentId,
    sortOrder: newSortOrder,
    updatedAt: now(),
  })
  await updateTemplate(item.templateId, {})
  await enqueueSync('update', 'templateItem', itemId)
}

export async function updateTemplateItem(
  id: string,
  patch: Partial<Pick<TemplateItem, 'title' | 'sortOrder' | 'parentItemId'>>
): Promise<void> {
  if ('parentItemId' in patch) {
    await reparentTemplateItem(id, patch.parentItemId)
  }
  const { parentItemId: _p, ...rest } = patch
  if (Object.keys(rest).length > 0) {
    const item = await db.templateItems.get(id)
    if (!item) return
    await db.templateItems.update(id, { ...rest, updatedAt: now() })
    await updateTemplate(item.templateId, {})
    await enqueueSync('update', 'templateItem', id)
  }
}

export async function deleteTemplateItem(id: string): Promise<void> {
  const children = await db.templateItems.where('parentItemId').equals(id).toArray()
  for (const child of children) {
    await db.templateItems.delete(child.id)
    await enqueueSync('delete', 'templateItem', child.id)
  }
  const item = await db.templateItems.get(id)
  await db.templateItems.delete(id)
  if (item) {
    await updateTemplate(item.templateId, {})
    await enqueueSync('delete', 'templateItem', id)
  }
}

export async function setTemplateItemSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateTemplateItem(id, { sortOrder })))
}

export async function mergeTemplateInto(
  sourceTemplateId: string,
  targetTemplateId: string
): Promise<void> {
  if (sourceTemplateId === targetTemplateId) return

  const targetItems = await listTemplateItems(targetTemplateId)
  const sourceItems = await listTemplateItems(sourceTemplateId)

  if (!sourceItems.length) {
    await deleteTemplate(sourceTemplateId)
    return
  }

  const combined = [...flattenItemTree(targetItems), ...flattenItemTree(sourceItems)]
  const structure = flatToStructure(combined)

  for (const item of sourceItems) {
    await db.templateItems.update(item.id, { templateId: targetTemplateId, updatedAt: now() })
    await enqueueSync('update', 'templateItem', item.id)
  }
  for (const row of structure) {
    await db.templateItems.update(row.id, {
      parentItemId: row.parentItemId,
      sortOrder: row.sortOrder,
      updatedAt: now(),
    })
    await enqueueSync('update', 'templateItem', row.id)
  }
  await updateTemplate(targetTemplateId, {})
  await deleteTemplate(sourceTemplateId)
}

export async function applyTemplateItemTree(
  templateId: string,
  structure: ItemTreeStructureRow[]
): Promise<void> {
  const allItems = await listTemplateItems(templateId)

  for (const row of structure) {
    if (row.parentItemId && !canReparentUnder(allItems, row.id, row.parentItemId)) continue
    await db.templateItems.update(row.id, {
      parentItemId: row.parentItemId,
      sortOrder: row.sortOrder,
      updatedAt: now(),
    })
    await enqueueSync('update', 'templateItem', row.id)
  }
  await updateTemplate(templateId, {})
}

export { addInstanceFromTemplate as copyTemplateToDay } from './days'
