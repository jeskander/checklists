import { db } from '../db/database'
import type { ChecklistTemplate, TemplateItem } from '../db/types'
import { newId, now } from '../lib/ids'
import { flatToStructure, flattenItemTree, type ItemTreeStructureRow } from '../lib/itemTreeMove'
import { canReparentUnder } from '../lib/listItems'
import { enqueueSync } from '../sync/syncEngine'

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
  const count = await db.checklistTemplates.count()
  const template: ChecklistTemplate = {
    id: newId(),
    title,
    defaultDurationMin,
    sortOrder: count,
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
  await db.checklistTemplates.update(id, (row) => {
    Object.assign(row, patch)
    if ('repeat' in patch && patch.repeat === undefined) delete row.repeat
    row.updatedAt = now()
  })
  await enqueueSync('update', 'template', id)
}

export async function deleteTemplate(id: string): Promise<void> {
  const t = await db.checklistTemplates.get(id)
  const items = await db.templateItems.where('templateId').equals(id).toArray()
  await db.transaction('rw', db.checklistTemplates, db.templateItems, async () => {
    await db.templateItems.bulkDelete(items.map((i) => i.id))
    await db.checklistTemplates.delete(id)
  })
  for (const item of items) {
    await enqueueSync('delete', 'templateItem', item.id, item.notionPageId)
  }
  await enqueueSync('delete', 'template', id, t?.notionPageId)
}

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
    .filter((i) => (i.parentItemId ?? undefined) === (parentItemId ?? undefined))
    .toArray()
  const item: TemplateItem = {
    id: newId(),
    templateId,
    parentItemId,
    title,
    sortOrder: siblings.length,
    updatedAt: now(),
  }
  await db.templateItems.add(item)
  await db.checklistTemplates.update(templateId, { updatedAt: now() })
  await enqueueSync('create', 'templateItem', item.id)
  return item
}

export async function addTemplateItemAfter(
  templateId: string,
  afterItemId: string,
  title = ''
): Promise<TemplateItem> {
  const after = await db.templateItems.get(afterItemId)
  if (!after) return addTemplateItem(templateId, title)

  const parentItemId = after.parentItemId
  const siblings = (await db.templateItems.where('templateId').equals(templateId).toArray())
    .filter((i) => (i.parentItemId ?? undefined) === (parentItemId ?? undefined))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const insertAt = after.sortOrder + 1
  await Promise.all(
    siblings
      .filter((s) => s.sortOrder >= insertAt)
      .map((s) => db.templateItems.update(s.id, { sortOrder: s.sortOrder + 1, updatedAt: now() }))
  )

  const item: TemplateItem = {
    id: newId(),
    templateId,
    parentItemId,
    title,
    sortOrder: insertAt,
    updatedAt: now(),
  }
  await db.templateItems.add(item)
  await db.checklistTemplates.update(templateId, { updatedAt: now() })
  await enqueueSync('create', 'templateItem', item.id)
  return item
}

export async function reparentTemplateItem(
  itemId: string,
  newParentId?: string
): Promise<void> {
  const item = await db.templateItems.get(itemId)
  if (!item) return
  if ((item.parentItemId ?? undefined) === (newParentId ?? undefined)) return

  const all = await db.templateItems.where('templateId').equals(item.templateId).toArray()
  if (newParentId && !canReparentUnder(all, itemId, newParentId)) return

  const newSiblings = all.filter(
    (i) => i.id !== itemId && (i.parentItemId ?? undefined) === (newParentId ?? undefined)
  )
  const newSortOrder = newSiblings.length
    ? Math.max(...newSiblings.map((s) => s.sortOrder)) + 1
    : 0

  await db.templateItems.update(itemId, (row) => {
    if (newParentId) row.parentItemId = newParentId
    else delete row.parentItemId
    row.sortOrder = newSortOrder
    row.updatedAt = now()
  })
  await db.checklistTemplates.update(item.templateId, { updatedAt: now() })
  await enqueueSync('update', 'templateItem', itemId)
}

export async function updateTemplateItem(
  id: string,
  patch: Partial<Pick<TemplateItem, 'title' | 'sortOrder' | 'parentItemId'>>
): Promise<void> {
  const item = await db.templateItems.get(id)
  if (!item) return

  if ('parentItemId' in patch) {
    await reparentTemplateItem(id, patch.parentItemId)
  }

  const { parentItemId: _parent, ...rest } = patch
  if (Object.keys(rest).length > 0) {
    await db.templateItems.update(id, { ...rest, updatedAt: now() })
    await db.checklistTemplates.update(item.templateId, { updatedAt: now() })
    await enqueueSync('update', 'templateItem', id)
  }
}

export async function deleteTemplateItem(id: string): Promise<void> {
  const item = await db.templateItems.get(id)
  if (!item) return
  const children = await db.templateItems.where('parentItemId').equals(id).toArray()
  await db.transaction('rw', db.templateItems, async () => {
    for (const c of children) await db.templateItems.delete(c.id)
    await db.templateItems.delete(id)
  })
  for (const c of children) await enqueueSync('delete', 'templateItem', c.id, c.notionPageId)
  await enqueueSync('delete', 'templateItem', id, item.notionPageId)
}

export async function setTemplateItemSortOrders(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, sortOrder) => updateTemplateItem(id, { sortOrder }))
  )
}

export async function setTemplateSortOrders(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, sortOrder) => updateTemplate(id, { sortOrder })))
}

/** Move all items from source into the bottom of target, then delete source. */
export async function mergeTemplateInto(
  sourceTemplateId: string,
  targetTemplateId: string
): Promise<void> {
  if (sourceTemplateId === targetTemplateId) return

  const sourceTemplate = await db.checklistTemplates.get(sourceTemplateId)
  const targetItems = await listTemplateItems(targetTemplateId)
  const sourceItems = await listTemplateItems(sourceTemplateId)

  if (!sourceItems.length) {
    await deleteTemplate(sourceTemplateId)
    return
  }

  const combined = [...flattenItemTree(targetItems), ...flattenItemTree(sourceItems)]
  const structure = flatToStructure(combined)
  const t = now()

  await db.transaction('rw', db.checklistTemplates, db.templateItems, async () => {
    for (const item of sourceItems) {
      await db.templateItems.update(item.id, (row) => {
        row.templateId = targetTemplateId
        row.updatedAt = t
      })
    }
    for (const row of structure) {
      await db.templateItems.update(row.id, (item) => {
        if (row.parentItemId) item.parentItemId = row.parentItemId
        else delete item.parentItemId
        item.sortOrder = row.sortOrder
        item.updatedAt = t
      })
    }
    await db.checklistTemplates.update(targetTemplateId, { updatedAt: t })
    await db.checklistTemplates.delete(sourceTemplateId)
  })

  await enqueueSync('update', 'template', targetTemplateId)
  for (const row of structure) await enqueueSync('update', 'templateItem', row.id)
  await enqueueSync('delete', 'template', sourceTemplateId, sourceTemplate?.notionPageId)
}

export async function applyTemplateItemTree(
  templateId: string,
  structure: ItemTreeStructureRow[]
): Promise<void> {
  const all = await db.templateItems.where('templateId').equals(templateId).toArray()
  await db.transaction('rw', db.templateItems, async () => {
    for (const row of structure) {
      if (row.parentItemId && !canReparentUnder(all, row.id, row.parentItemId)) continue
      await db.templateItems.update(row.id, (item) => {
        if (row.parentItemId) item.parentItemId = row.parentItemId
        else delete item.parentItemId
        item.sortOrder = row.sortOrder
        item.updatedAt = now()
      })
    }
  })
  await db.checklistTemplates.update(templateId, { updatedAt: now() })
  for (const row of structure) await enqueueSync('update', 'templateItem', row.id)
}

export { addInstanceFromTemplate as copyTemplateToDay } from './days'
