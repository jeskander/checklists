import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'
import { DurationInput } from './DurationInput'
import { DeadlineInput } from './DeadlineInput'
import { ImportanceInput } from './ImportanceInput'
import { ListItemInput } from './ListItemInput'
import type { TaskListItem } from '../db/types'
import { getChildren } from '../lib/completion'
import { extractSubtreeBlock, flattenItemTree } from '../lib/itemTreeMove'
import { reorderIds } from '../lib/reorder'
import type { ListItemRow } from '../lib/listItems'

type Props = {
  items: TaskListItem[]
  onReorderRoots: (rootIds: string[]) => Promise<void>
  onUpdateTitle: (id: string, title: string) => void
  onUpdateImportance: (id: string, importance: TaskListItem['importance']) => void
  onUpdateDuration: (id: string, durationMin: number) => void
  onUpdateDeadline: (id: string, deadline: string | undefined) => void
  onDeleteTask: (rootId: string) => void
  onDeleteSubitem: (itemId: string) => void
  onAddAfter: (afterItemId: string, title?: string) => Promise<string | void>
  onReparent: (itemId: string, parentId?: string) => Promise<void>
}

export function EditableTaskItemList({
  items,
  onReorderRoots,
  onUpdateTitle,
  onUpdateImportance,
  onUpdateDuration,
  onUpdateDeadline,
  onDeleteTask,
  onDeleteSubitem,
  onAddAfter,
  onReparent,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const roots = useMemo(
    () => getChildren(items, undefined).sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  )

  const subitemsByRoot = useMemo(() => {
    const flat = flattenItemTree(items)
    const map = new Map<string, TaskListItem[]>()
    for (const root of roots) {
      const block = extractSubtreeBlock(flat, root.id)
      const subIds = block.slice(1).map((e) => e.id)
      map.set(
        root.id,
        subIds.map((id) => items.find((i) => i.id === id)).filter((i): i is TaskListItem => i != null)
      )
    }
    return map
  }, [items, roots])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const itemKeyboard = {
    items: items as ListItemRow[],
    onAddAfter,
    onReparent,
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return
    const newOrder = reorderIds(roots, String(active.id), String(over.id))
    await onReorderRoots(newOrder)
  }

  const activeRoot = activeId ? roots.find((r) => r.id === activeId) : undefined

  if (!roots.length) return null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <SortableContext items={roots.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <div className="task-items-list">
          {roots.map((root) => (
            <SortableTaskGroupCard
              key={root.id}
              root={root}
              subitems={subitemsByRoot.get(root.id) ?? []}
              isDragging={activeId === root.id}
              onUpdateTitle={onUpdateTitle}
              onUpdateImportance={onUpdateImportance}
              onUpdateDuration={onUpdateDuration}
              onUpdateDeadline={onUpdateDeadline}
              onDeleteTask={onDeleteTask}
              onDeleteSubitem={onDeleteSubitem}
              itemKeyboard={itemKeyboard}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeRoot ? (
          <div className="task-item-overlay">
            <span className="task-item-overlay-title">{activeRoot.title || 'Untitled task'}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function SortableTaskGroupCard({
  root,
  subitems,
  isDragging,
  onUpdateTitle,
  onUpdateImportance,
  onUpdateDuration,
  onUpdateDeadline,
  onDeleteTask,
  onDeleteSubitem,
  itemKeyboard,
}: {
  root: TaskListItem
  subitems: TaskListItem[]
  isDragging: boolean
  onUpdateTitle: (id: string, title: string) => void
  onUpdateImportance: (id: string, importance: TaskListItem['importance']) => void
  onUpdateDuration: (id: string, durationMin: number) => void
  onUpdateDeadline: (id: string, deadline: string | undefined) => void
  onDeleteTask: (rootId: string) => void
  onDeleteSubitem: (itemId: string) => void
  itemKeyboard: {
    items: ListItemRow[]
    onAddAfter: (afterItemId: string, title?: string) => Promise<string | void>
    onReparent: (itemId: string, parentId?: string) => Promise<void>
  }
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: root.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-item-card task-item-card--imp-${root.importance}${isDragging ? ' task-item-card--dragging' : ''}`}
    >
      <div className="task-item-card-top">
        <button
          type="button"
          className="task-item-drag"
          aria-label="Drag to reorder task"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <div className="task-item-title-wrap">
          <ListItemInput
            itemId={root.id}
            className="field task-item-title"
            value={root.title}
            placeholder="What needs doing?"
            onChange={(title) => onUpdateTitle(root.id, title)}
            {...itemKeyboard}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost task-item-delete"
          onClick={() => onDeleteTask(root.id)}
          aria-label="Delete task"
        >
          ×
        </button>
      </div>

      {subitems.length > 0 ? (
        <ul className="task-item-subitems">
          {subitems.map((sub) => (
            <li key={sub.id} className="task-item-subrow">
              <ListItemInput
                itemId={sub.id}
                className="field task-item-subtitle"
                value={sub.title}
                placeholder="Sub-step"
                onChange={(title) => onUpdateTitle(sub.id, title)}
                {...itemKeyboard}
              />
              <button
                type="button"
                className="btn btn-ghost task-item-subdelete"
                onClick={() => onDeleteSubitem(sub.id)}
                aria-label="Delete sub-step"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="task-item-card-details">
        <label className="task-meta-field">
          <span className="task-meta-label">Priority</span>
          <ImportanceInput
            value={root.importance}
            onChange={(importance) => onUpdateImportance(root.id, importance)}
            aria-label="Priority level"
          />
        </label>
        <label className="task-meta-field task-meta-field--duration">
          <span className="task-meta-label">Duration</span>
          <DurationInput
            className="field"
            minutes={root.durationMin}
            onChange={(durationMin) => onUpdateDuration(root.id, durationMin)}
          />
        </label>
        <label className="task-meta-field task-meta-field--deadline">
          <span className="task-meta-label">Due date</span>
          <DeadlineInput
            value={root.deadline}
            onChange={(deadline) => onUpdateDeadline(root.id, deadline)}
          />
        </label>
      </div>
    </article>
  )
}
