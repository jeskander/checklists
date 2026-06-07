import { getChildren, collectDescendantIds } from './completion'

export type ListItemRow = {
  id: string
  parentItemId?: string
  sortOrder: number
}

export function getPreviousSibling<T extends ListItemRow>(items: T[], itemId: string): T | undefined {
  const item = items.find((i) => i.id === itemId)
  if (!item) return undefined
  const siblings = getChildren(items, item.parentItemId).sort((a, b) => a.sortOrder - b.sortOrder)
  const idx = siblings.findIndex((s) => s.id === itemId)
  return idx > 0 ? siblings[idx - 1] : undefined
}

export function canReparentUnder<T extends ListItemRow>(
  items: T[],
  itemId: string,
  newParentId: string
): boolean {
  if (newParentId === itemId) return false
  return !collectDescendantIds(items, itemId).includes(newParentId)
}

/** Default label for newly created items (shown as placeholder, not stored). */
export const NEW_ITEM_PLACEHOLDER = 'New item'

export function isNewItemPlaceholderTitle(title: string): boolean {
  return title === '' || title === NEW_ITEM_PLACEHOLDER
}

export function listItemInputId(itemId: string): string {
  return `list-item-input-${itemId}`
}

/** Refocus after DOM moves (e.g. indent/unindent). Retries until the input remounts. */
export function focusListItemInput(itemId: string, attemptsLeft = 16): void {
  const el = document.getElementById(listItemInputId(itemId)) as HTMLInputElement | null
  if (el) {
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
    return
  }
  if (attemptsLeft > 0) {
    requestAnimationFrame(() => focusListItemInput(itemId, attemptsLeft - 1))
  }
}

/** Call after async DB updates that reorder the list (indent/outdent). */
export function focusListItemInputAfterUpdate(itemId: string): void {
  focusListItemInput(itemId)
  setTimeout(() => focusListItemInput(itemId), 0)
  setTimeout(() => focusListItemInput(itemId), 50)
}
