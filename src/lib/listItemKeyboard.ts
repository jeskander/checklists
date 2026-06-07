import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  focusListItemInput,
  focusListItemInputAfterUpdate,
  getPreviousSibling,
  type ListItemRow,
} from './listItems'

export type ListItemKeyboardActions = {
  items: ListItemRow[]
  itemId: string
  onAddAfter: (afterItemId: string) => void | Promise<string | void>
  onReparent: (itemId: string, parentItemId?: string) => void | Promise<void>
}

export function handleListItemKeyDown(
  e: ReactKeyboardEvent<HTMLInputElement>,
  actions: ListItemKeyboardActions
): void {
  const { items, itemId, onAddAfter, onReparent } = actions
  const item = items.find((i) => i.id === itemId)

  if (e.key === 'Enter') {
    e.preventDefault()
    void Promise.resolve(onAddAfter(itemId)).then((newId) => {
      if (typeof newId === 'string') focusListItemInput(newId)
    })
    return
  }

  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    const prev = getPreviousSibling(items, itemId)
    if (!prev) return
    void Promise.resolve(onReparent(itemId, prev.id)).then(() =>
      focusListItemInputAfterUpdate(itemId)
    )
    return
  }

  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault()
    if (!item?.parentItemId) return
    const parent = items.find((i) => i.id === item.parentItemId)
    void Promise.resolve(onReparent(itemId, parent?.parentItemId)).then(() =>
      focusListItemInputAfterUpdate(itemId)
    )
  }
}
