import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useDebouncedDraft } from '../hooks/useDebouncedDraft'
import { handleListItemKeyDown, type ListItemKeyboardActions } from '../lib/listItemKeyboard'
import {
  isNewItemPlaceholderTitle,
  listItemInputId,
  NEW_ITEM_PLACEHOLDER,
  type ListItemRow,
} from '../lib/listItems'

type Props = {
  itemId: string
  value: string
  onChange: (value: string) => void
  className?: string
  items: ListItemRow[]
  onAddAfter: ListItemKeyboardActions['onAddAfter']
  onReparent: ListItemKeyboardActions['onReparent']
  placeholder?: string
}

export function ListItemInput({
  itemId,
  value,
  onChange,
  className,
  items,
  onAddAfter,
  onReparent,
  placeholder = NEW_ITEM_PLACEHOLDER,
}: Props) {
  const external = isNewItemPlaceholderTitle(value) ? '' : value
  const draft = useDebouncedDraft(external, onChange)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    handleListItemKeyDown(e, {
      items,
      itemId,
      value: draft.value,
      onAddAfter,
      onCommitTitle: (id, title) => {
        if (id === itemId) draft.commitNow(title)
      },
      onReparent,
    })
  }

  return (
    <input
      id={listItemInputId(itemId)}
      className={className ? `${className} list-item-input` : 'list-item-input'}
      value={draft.value}
      placeholder={placeholder}
      onChange={(e) => draft.onChange(e.target.value)}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      onKeyDown={onKeyDown}
    />
  )
}
