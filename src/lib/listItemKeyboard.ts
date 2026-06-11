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
  value: string
  onAddAfter: (afterItemId: string, title?: string) => void | Promise<string | void>
  onCommitTitle: (itemId: string, title: string) => void
  onReparent: (itemId: string, parentItemId?: string) => void | Promise<void>
}

export function handleListItemKeyDown(
  e: ReactKeyboardEvent<HTMLInputElement>,
  actions: ListItemKeyboardActions
): void {
  const { items, itemId, value, onAddAfter, onCommitTitle, onReparent } = actions
  const item = items.find((i) => i.id === itemId)

  if (e.key === 'Enter') {
    e.preventDefault()
    const input = e.currentTarget
    const pos = input.selectionStart ?? value.length

    if (pos === 0) {
      const prev = getPreviousSibling(items, itemId)
      const anchorId = prev?.id ?? itemId
      void Promise.resolve(onAddAfter(anchorId, '')).then((newId) => {
        if (typeof newId === 'string') focusListItemInput(newId)
      })
      return
    }

    if (pos < value.length) {
      const before = value.slice(0, pos)
      const after = value.slice(pos)
      onCommitTitle(itemId, before)
      void Promise.resolve(onAddAfter(itemId, after)).then((newId) => {
        if (typeof newId === 'string') focusListItemInput(newId, 16, 'start')
      })
      return
    }

    void Promise.resolve(onAddAfter(itemId, '')).then((newId) => {
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
