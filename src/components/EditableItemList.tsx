import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useRef, useState } from 'react'
import { ListItemInput } from './ListItemInput'
import { DurationInput } from './DurationInput'
import { OptionsMenu, type OptionsMenuAction } from './OptionsMenu'
import { isItemComplete } from '../lib/completion'
import {
  canIndentItem,
  canOutdentItem,
  indentItem,
  outdentItem,
} from '../lib/itemMenuActions'
import {
  flatToStructure,
  flattenItemTree,
  moveItemBlockInFlat,
  type ItemTreeStructureRow,
} from '../lib/itemTreeMove'
import type { ListItemRow } from '../lib/listItems'
import { useSortableHandleMenu } from '../hooks/useSortableHandleMenu'
import './EditableItemList.css'
import './ItemTree.css'

const INDENT_PX = 28

export type EditableListItem = ListItemRow & {
  title: string
  completed?: boolean
  durationMin?: number
}

type Props = {
  items: EditableListItem[]
  onApplyStructure: (structure: ItemTreeStructureRow[]) => Promise<void>
  onUpdateTitle: (id: string, title: string) => void
  onUpdateDuration?: (id: string, durationMin: number) => void
  onDelete?: (id: string) => void
  onDuplicate?: (id: string) => void
  onAddAfter: (afterItemId: string, title?: string) => Promise<string | void>
  onReparent: (itemId: string, parentId?: string) => Promise<void>
  onToggle?: (id: string, completed: boolean) => void
  compact?: boolean
  /** Tap ⋮⋮ for indent/outdent/delete (day block items only). */
  itemMenu?: boolean
}

export function EditableItemList({
  items,
  onApplyStructure,
  onUpdateTitle,
  onUpdateDuration,
  onDelete,
  onDuplicate,
  onAddAfter,
  onReparent,
  onToggle,
  compact,
  itemMenu = false,
}: Props) {
  const [menuState, setMenuState] = useState<{ itemId: string; anchorRect: DOMRect } | null>(null)
  const didDragRef = useRef(false)

  const flat = flattenItemTree(items)
  const sortableIds = flat.map((e) => e.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = (_event: DragStartEvent) => {
    didDragRef.current = true
    setMenuState(null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const newFlat = moveItemBlockInFlat(flat, String(active.id), String(over.id))
    await onApplyStructure(flatToStructure(newFlat))
  }

  const itemKeyboard = {
    items,
    onAddAfter,
    onReparent,
  }

  const menuItem = menuState ? items.find((i) => i.id === menuState.itemId) : undefined

  const menuItems: OptionsMenuAction[] = useMemo(() => {
    if (!menuItem || !onDelete) return []
    return [
      {
        id: 'indent',
        label: 'Indent',
        disabled: !canIndentItem(items, menuItem.id),
        onSelect: () => {
          void indentItem(items, menuItem.id, onReparent)
        },
      },
      {
        id: 'outdent',
        label: 'Outdent',
        disabled: !canOutdentItem(items, menuItem.id),
        onSelect: () => {
          void outdentItem(items, menuItem.id, onReparent)
        },
      },
      ...(onDuplicate
        ? [
            {
              id: 'duplicate',
              label: 'Duplicate',
              onSelect: () => onDuplicate(menuItem.id),
            } satisfies OptionsMenuAction,
          ]
        : []),
      {
        id: 'delete',
        label: 'Delete',
        destructive: true,
        onSelect: () => onDelete(menuItem.id),
      },
    ]
  }, [menuItem, items, onDelete, onDuplicate, onReparent])

  if (!flat.length) return null

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={(e) => void handleDragEnd(e)}
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <ul className={`block-list${compact ? ' block-list--compact' : ''}`}>
            {flat.map((entry) => {
              const item = items.find((i) => i.id === entry.id)
              if (!item) return null
              return (
                <SortableBlockRow
                  key={item.id}
                  item={item}
                  depth={entry.depth}
                  allItems={items}
                  itemMenu={itemMenu}
                  menuOpen={menuState?.itemId === item.id}
                  didDragRef={didDragRef}
                  onOpenMenu={(anchor) =>
                    setMenuState({ itemId: item.id, anchorRect: anchor.getBoundingClientRect() })
                  }
                  onUpdateTitle={onUpdateTitle}
                  onUpdateDuration={onUpdateDuration}
                  onDelete={onDelete}
                  onToggle={onToggle}
                  itemKeyboard={itemKeyboard}
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>

      {menuState && menuItems.length > 0 ? (
        <OptionsMenu
          anchorRect={menuState.anchorRect}
          items={menuItems}
          onClose={() => setMenuState(null)}
        />
      ) : null}
    </>
  )
}

function SortableBlockRow({
  item,
  depth,
  allItems,
  itemMenu,
  menuOpen,
  didDragRef,
  onOpenMenu,
  onUpdateTitle,
  onUpdateDuration,
  onDelete,
  onToggle,
  itemKeyboard,
}: {
  item: EditableListItem
  depth: number
  allItems: EditableListItem[]
  itemMenu: boolean
  menuOpen: boolean
  didDragRef: React.MutableRefObject<boolean>
  onOpenMenu: (anchor: HTMLElement) => void
  onUpdateTitle: (id: string, title: string) => void
  onUpdateDuration?: (id: string, durationMin: number) => void
  onDelete?: (id: string) => void
  onToggle?: (id: string, completed: boolean) => void
  itemKeyboard: {
    items: EditableListItem[]
    onAddAfter: (afterItemId: string, title?: string) => Promise<string | void>
    onReparent: (itemId: string, parentId?: string) => Promise<void>
  }
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const { handleProps } = useSortableHandleMenu({
    listeners,
    didDragRef,
    onOpenMenu: itemMenu ? onOpenMenu : () => {},
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${depth * INDENT_PX}px`,
  }

  const children = allItems.filter((i) => i.parentItemId === item.id)
  const hasChildren = children.length > 0
  const complete =
    item.completed !== undefined && onToggle
      ? hasChildren
        ? isItemComplete(item.id, allItems as Parameters<typeof isItemComplete>[1])
        : item.completed
      : false

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`block-row${isDragging ? ' is-dragging' : ''}`}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={itemMenu ? 'Item options. Drag to reorder.' : 'Drag to reorder'}
        aria-haspopup={itemMenu ? 'menu' : undefined}
        aria-expanded={itemMenu ? menuOpen : undefined}
        {...attributes}
        {...(itemMenu ? handleProps : listeners)}
      >
        ⋮⋮
      </button>
      {onToggle && (
        <button
          type="button"
          className={`item-check${complete ? ' done' : ''}${hasChildren ? ' parent' : ''}`}
          onClick={() => onToggle(item.id, !complete)}
          aria-pressed={complete}
        >
          {complete && <span className="check-mark">✓</span>}
        </button>
      )}
      <ListItemInput
        itemId={item.id}
        className={onToggle ? 'item-title-input' : 'field item-field'}
        value={item.title}
        onChange={(title) => onUpdateTitle(item.id, title)}
        {...itemKeyboard}
      />
      {onUpdateDuration && item.durationMin != null ? (
        <DurationInput
          className="field item-duration-input"
          minutes={item.durationMin}
          onChange={(durationMin) => onUpdateDuration(item.id, durationMin)}
        />
      ) : null}
      {onDelete && !itemMenu && (
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onDelete(item.id)}>
          ×
        </button>
      )}
    </li>
  )
}
