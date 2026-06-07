import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
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
import { db } from '../db/database'
import { DurationInput } from '../components/DurationInput'
import { TemplateRepeatEditor } from '../components/TemplateRepeatEditor'
import type { TemplateRepeat } from '../lib/templateRepeat'
import { processCalendarRepeats } from '../services/templateRepeat'
import { DeadlineInput } from '../components/DeadlineInput'
import '../components/DateInput.css'
import { ImportanceInput } from '../components/ImportanceInput'
import { useDebouncedDraft } from '../hooks/useDebouncedDraft'
import { useUndo } from '../context/UndoContext'
import { reorderIds } from '../lib/reorder'
import {
  addTaskListItem,
  addTaskListItemAfter,
  deleteTaskList,
  deleteTaskListItem,
  isInboxList,
  listAllTaskListItems,
  setTaskListItemSortOrders,
  updateTaskList,
  updateTaskListItem,
} from '../services/taskLists'
import type { TaskListItem } from '../db/types'
import './TaskListEditorPage.css'
import './TemplateEditorPage.css'

export function TaskListEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showUndo } = useUndo()
  const [activeId, setActiveId] = useState<string | null>(null)

  const list = useLiveQuery(() => (id ? db.taskLists.get(id) : undefined), [id])
  const items = useLiveQuery(
    async () => (id ? listAllTaskListItems(id) : []),
    [id]
  )

  const openItems = (items ?? []).filter((item) => item.completedAt == null)

  const titleDraft = useDebouncedDraft(list?.title ?? '', (title) => {
    if (id) void updateTaskList(id, { title })
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  if (!id || list === undefined) return <p className="empty-state">Loading…</p>
  if (!list) return <p className="empty-state">Task list not found</p>

  const inbox = isInboxList(list)

  const handleDeleteList = async () => {
    const snapshot = { list, items: [...(items ?? [])] }
    await deleteTaskList(id)
    showUndo('Task list deleted', async () => {
      await db.taskLists.put(snapshot.list)
      await db.taskListItems.bulkPut(snapshot.items)
    })
    navigate('/tasks')
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || !openItems.length || active.id === over.id) return
    const newOrder = reorderIds(openItems, String(active.id), String(over.id))
    await setTaskListItemSortOrders(newOrder)
  }

  const activeItem = activeId ? openItems.find((item) => item.id === activeId) : undefined

  return (
    <>
      <header className="page-header editor-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/tasks')}>
          ← Back
        </button>
        <div className="editor-header-actions">
          {!inbox && (
            <button type="button" className="btn btn-ghost" onClick={() => void handleDeleteList()}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => navigate('/tasks')}>
            Done
          </button>
        </div>
      </header>

      <div className="editor-meta">
        <input
          className="editor-title field"
          value={titleDraft.value}
          onChange={(e) => titleDraft.onChange(e.target.value)}
          onFocus={titleDraft.onFocus}
          onBlur={titleDraft.onBlur}
          readOnly={inbox}
          aria-readonly={inbox}
        />
        {!inbox ? (
          <label className="duration-label">
            Default duration
            <DurationInput
              className="field duration-field"
              minutes={list.defaultDurationMin}
              onChange={(defaultDurationMin) => void updateTaskList(id, { defaultDurationMin })}
            />
          </label>
        ) : null}
      </div>

      {!inbox ? (
        <TemplateRepeatEditor
          repeat={list.repeat}
          onChange={(repeat: TemplateRepeat | undefined) => {
            void updateTaskList(id, { repeat }).then(() => processCalendarRepeats())
          }}
        />
      ) : null}

      <h2 className="section-label">Tasks</h2>
      <p className="section-hint">
        {inbox
          ? 'Tasks added without a list land here. Priority 1 is highest.'
          : 'Priority 1 is highest. Optional due dates show on the day view. Tasks disappear once completed.'}
      </p>

      {!openItems.length ? (
        <p className="empty-state" style={{ padding: '1rem 0' }}>
          No tasks yet — add one below.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext items={openItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="task-items-list">
              {openItems.map((item) => (
                <SortableTaskItemRow
                  key={item.id}
                  item={item}
                  isDragging={activeId === item.id}
                  onUpdateTitle={(title) => void updateTaskListItem(item.id, { title })}
                  onUpdateImportance={(importance) => void updateTaskListItem(item.id, { importance })}
                  onUpdateDuration={(durationMin) => void updateTaskListItem(item.id, { durationMin })}
                  onUpdateDeadline={(deadline) => void updateTaskListItem(item.id, { deadline })}
                  onDelete={async () => {
                    const snap = { ...item }
                    await deleteTaskListItem(item.id)
                    showUndo('Task deleted', async () => {
                      await db.taskListItems.put(snap)
                    })
                  }}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <div className="task-item-overlay">
                <span className="task-item-overlay-title">{activeItem.title || 'Untitled task'}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <div className="editor-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void addTaskListItem(id, '')}>
          + Task
        </button>
      </div>
    </>
  )
}

function SortableTaskItemRow({
  item,
  isDragging,
  onUpdateTitle,
  onUpdateImportance,
  onUpdateDuration,
  onUpdateDeadline,
  onDelete,
}: {
  item: TaskListItem
  isDragging: boolean
  onUpdateTitle: (title: string) => void
  onUpdateImportance: (importance: TaskListItem['importance']) => void
  onUpdateDuration: (durationMin: number) => void
  onUpdateDeadline: (deadline: string | undefined) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`task-item-card task-item-card--imp-${item.importance}${isDragging ? ' task-item-card--dragging' : ''}`}
    >
      <div className="task-item-card-top">
        <button
          type="button"
          className="task-item-drag"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <div className="task-item-title-wrap">
          <input
            className="field task-item-title"
            value={item.title}
            placeholder="What needs doing?"
            onChange={(e) => onUpdateTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addTaskListItemAfter(item.taskListId, item.id)
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost task-item-delete"
          onClick={() => void onDelete()}
          aria-label="Delete task"
        >
          ×
        </button>
      </div>
      <div className="task-item-card-details">
        <label className="task-meta-field">
          <span className="task-meta-label">Priority</span>
          <ImportanceInput value={item.importance} onChange={onUpdateImportance} aria-label="Priority level" />
        </label>
        <label className="task-meta-field task-meta-field--duration">
          <span className="task-meta-label">Duration</span>
          <DurationInput
            className="field"
            minutes={item.durationMin}
            onChange={onUpdateDuration}
          />
        </label>
        <label className="task-meta-field task-meta-field--deadline">
          <span className="task-meta-label">Due date</span>
          <DeadlineInput value={item.deadline} onChange={onUpdateDeadline} />
        </label>
      </div>
    </article>
  )
}
