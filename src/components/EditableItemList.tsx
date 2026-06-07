import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ListItemInput } from './ListItemInput'
import { DurationInput } from './DurationInput'
import { isItemComplete } from '../lib/completion'
import {
  flatToStructure,
  flattenItemTree,
  moveItemBlockInFlat,
  type ItemTreeStructureRow,
} from '../lib/itemTreeMove'
import type { ListItemRow } from '../lib/listItems'
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
  onAddAfter: (afterItemId: string) => Promise<string | void>
  onReparent: (itemId: string, parentId?: string) => Promise<void>
  onToggle?: (id: string, completed: boolean) => void
  compact?: boolean
}

export function EditableItemList({
  items,
  onApplyStructure,
  onUpdateTitle,
  onUpdateDuration,
  onDelete,
  onAddAfter,
  onReparent,
  onToggle,
  compact,
}: Props) {
  const flat = flattenItemTree(items)
  const sortableIds = flat.map((e) => e.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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

  if (!flat.length) return null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
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
  )
}

function SortableBlockRow({
  item,
  depth,
  allItems,
  onUpdateTitle,
  onUpdateDuration,
  onDelete,
  onToggle,
  itemKeyboard,
}: {
  item: EditableListItem
  depth: number
  allItems: EditableListItem[]
  onUpdateTitle: (id: string, title: string) => void
  onUpdateDuration?: (id: string, durationMin: number) => void
  onDelete?: (id: string) => void
  onToggle?: (id: string, completed: boolean) => void
  itemKeyboard: {
    items: EditableListItem[]
    onAddAfter: (afterItemId: string) => Promise<string | void>
    onReparent: (itemId: string, parentId?: string) => Promise<void>
  }
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
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
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
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
      {onDelete && (
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => onDelete(item.id)}>
          ×
        </button>
      )}
    </li>
  )
}
