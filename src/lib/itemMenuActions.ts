import { focusListItemInputAfterUpdate, getPreviousSibling, type ListItemRow } from './listItems'

export function canIndentItem<T extends ListItemRow>(items: T[], itemId: string): boolean {
  return getPreviousSibling(items, itemId) != null
}

export function canOutdentItem<T extends ListItemRow>(items: T[], itemId: string): boolean {
  const item = items.find((i) => i.id === itemId)
  return item?.parentItemId != null
}

export async function indentItem<T extends ListItemRow>(
  items: T[],
  itemId: string,
  onReparent: (itemId: string, parentId?: string) => Promise<void>
): Promise<void> {
  const prev = getPreviousSibling(items, itemId)
  if (!prev) return
  await onReparent(itemId, prev.id)
  focusListItemInputAfterUpdate(itemId)
}

export async function outdentItem<T extends ListItemRow>(
  items: T[],
  itemId: string,
  onReparent: (itemId: string, parentId?: string) => Promise<void>
): Promise<void> {
  const item = items.find((i) => i.id === itemId)
  if (!item?.parentItemId) return
  const parent = items.find((i) => i.id === item.parentItemId)
  await onReparent(itemId, parent?.parentItemId)
  focusListItemInputAfterUpdate(itemId)
}
