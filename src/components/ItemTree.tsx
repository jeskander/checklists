import { ListItemInput } from './ListItemInput'
import { getChildren, isItemComplete } from '../lib/completion'
import type { CheckableItem } from '../lib/completion'
import type { ListItemRow } from '../lib/listItems'
import './ItemTree.css'

export type TreeItem = CheckableItem & {
  id: string
  title: string
  parentItemId?: string
  sortOrder: number
}

type Props = {
  items: TreeItem[]
  onToggle: (id: string, completed: boolean) => void
  readOnly?: boolean
  onEditTitle?: (id: string, title: string) => void
  onAddAfter?: (afterItemId: string, title?: string) => Promise<string | void>
  onReparent?: (itemId: string, parentItemId?: string) => Promise<void>
  compact?: boolean
}

export function ItemTree({ items, onToggle, readOnly, onEditTitle, onAddAfter, onReparent, compact }: Props) {
  const tops = getChildren(items, undefined)
  const editable = Boolean(onEditTitle && onAddAfter && onReparent)
  const listRows: ListItemRow[] = items

  return (
    <ul className={`item-tree${compact ? ' item-tree--compact' : ''}`}>
      {tops.map((item) => (
        <ItemNode
          key={item.id}
          item={item}
          items={items}
          listRows={listRows}
          editable={editable}
          onToggle={onToggle}
          readOnly={readOnly}
          onEditTitle={onEditTitle}
          onAddAfter={onAddAfter}
          onReparent={onReparent}
        />
      ))}
    </ul>
  )
}

function ItemNode({
  item,
  items,
  listRows,
  editable,
  onToggle,
  readOnly,
  onEditTitle,
  onAddAfter,
  onReparent,
}: {
  item: TreeItem
  items: TreeItem[]
  listRows: ListItemRow[]
  editable: boolean
  onToggle: (id: string, completed: boolean) => void
  readOnly?: boolean
  onEditTitle?: (id: string, title: string) => void
  onAddAfter?: (afterItemId: string, title?: string) => Promise<string | void>
  onReparent?: (itemId: string, parentItemId?: string) => Promise<void>
}) {
  const children = getChildren(items, item.id)
  const hasChildren = children.length > 0
  const complete = isItemComplete(item.id, items)

  const handleCheck = () => {
    if (readOnly) return
    const next = hasChildren ? !complete : !item.completed
    onToggle(item.id, next)
  }

  return (
    <li className="item-node">
      <div className="item-row">
        <button
          type="button"
          className={`item-check${complete ? ' done' : ''}${hasChildren ? ' parent' : ''}`}
          onClick={handleCheck}
          disabled={readOnly}
          aria-pressed={complete}
        >
          {complete && <span className="check-mark">✓</span>}
        </button>
        {editable && onEditTitle && onAddAfter && onReparent ? (
          <ListItemInput
            itemId={item.id}
            className="item-title-input"
            value={item.title}
            onChange={(title) => onEditTitle(item.id, title)}
            items={listRows}
            onAddAfter={onAddAfter}
            onReparent={onReparent}
          />
        ) : (
          <span className={`item-title${complete ? ' done' : ''}`}>{item.title}</span>
        )}
      </div>
      {hasChildren && (
        <ul className="item-children">
          {children.map((child) => (
            <ItemNode
              key={child.id}
              item={child}
              items={items}
              listRows={listRows}
              editable={editable}
              onToggle={onToggle}
              readOnly={readOnly}
              onEditTitle={onEditTitle}
              onAddAfter={onAddAfter}
              onReparent={onReparent}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
