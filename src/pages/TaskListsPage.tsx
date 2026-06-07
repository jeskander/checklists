import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
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
import { formatDuration } from '../lib/duration'
import { formatTemplateRepeat } from '../lib/templateRepeat'
import { reorderIds } from '../lib/reorder'
import { createTaskList, ensureInboxList, isInboxList, setTaskListSortOrders } from '../services/taskLists'
import type { TaskList } from '../db/types'
import './TaskListsPage.css'

export function TaskListsPage() {
  const navigate = useNavigate()
  const lists = useLiveQuery(() => db.taskLists.orderBy('sortOrder').toArray(), [])
  const openItems = useLiveQuery(
    () => db.taskListItems.filter((item) => item.completedAt == null).toArray(),
    []
  )
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    void ensureInboxList()
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const statsByListId = new Map<string, { count: number; totalMin: number }>()
  for (const item of openItems ?? []) {
    const prev = statsByListId.get(item.taskListId) ?? { count: 0, totalMin: 0 }
    statsByListId.set(item.taskListId, {
      count: prev.count + 1,
      totalMin: prev.totalMin + item.durationMin,
    })
  }

  const handleCreate = async () => {
    const list = await createTaskList('New task list')
    navigate(`/tasks/${list.id}`)
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over || !lists?.length || active.id === over.id) return
    const newOrder = reorderIds(lists, String(active.id), String(over.id))
    await setTaskListSortOrders(newOrder)
  }

  const activeList = activeId ? lists?.find((l) => l.id === activeId) : undefined

  return (
    <>
      <header className="page-header task-lists-header">
        <div>
          <h1>Tasks</h1>
          <p>One-shot tasks grouped by context</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
          + New
        </button>
      </header>

      {!lists?.length ? (
        <div className="empty-state">
          <p className="display">Loading task lists…</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <div className="template-list">
              {lists.map((list) => {
                const stats = statsByListId.get(list.id) ?? { count: 0, totalMin: 0 }
                return (
                  <SortableTaskListCard
                    key={list.id}
                    list={list}
                    stats={stats}
                    isDragging={activeId === list.id}
                    isInbox={isInboxList(list)}
                  />
                )
              })}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeList ? (
              <div className="list-card task-list-card-overlay">
                <div className="list-card-row">
                  <span className="list-card-title">{activeList.title}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {lists?.length ? (
        <p className="task-lists-dnd-hint">Drag to reorder lists</p>
      ) : null}
    </>
  )
}

function SortableTaskListCard({
  list,
  stats,
  isDragging,
  isInbox,
}: {
  list: TaskList
  stats: { count: number; totalMin: number }
  isDragging: boolean
  isInbox: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: list.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  const meta = isInbox
    ? stats.count === 0
      ? 'No open tasks'
      : `${stats.count} task${stats.count === 1 ? '' : 's'} · ${formatDuration(stats.totalMin)}`
    : stats.count === 0
      ? `${formatDuration(list.defaultDurationMin)} default${list.repeat ? ` · ${formatTemplateRepeat(list.repeat)}` : ''}`
      : `${stats.count} task${stats.count === 1 ? '' : 's'} · ${formatDuration(stats.totalMin)} · ${formatDuration(list.defaultDurationMin)} default${list.repeat ? ` · ${formatTemplateRepeat(list.repeat)}` : ''}`

  return (
    <div ref={setNodeRef} style={style} className="task-list-sortable">
      <button
        type="button"
        className="task-list-drag-handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <Link to={`/tasks/${list.id}`} className="list-card task-list-link">
        <div className="list-card-row">
          <span className="list-card-title">{list.title}</span>
          <span className="list-card-meta">{meta}</span>
        </div>
      </Link>
    </div>
  )
}
