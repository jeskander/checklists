import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
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
import { reorderIds } from '../lib/reorder'
import {
  createTemplate,
  mergeTemplateInto,
  setTemplateSortOrders,
} from '../services/templates'
import { formatTemplateRepeat } from '../lib/templateRepeat'
import type { ChecklistTemplate } from '../db/types'
import './LibraryPage.css'

function pointerFromDrag(
  activatorEvent: Event | null,
  delta: { x: number; y: number }
): { x: number; y: number } | null {
  if (!activatorEvent) return null
  if (activatorEvent instanceof MouseEvent) {
    return { x: activatorEvent.clientX + delta.x, y: activatorEvent.clientY + delta.y }
  }
  if (activatorEvent instanceof TouchEvent && activatorEvent.changedTouches[0]) {
    const t = activatorEvent.changedTouches[0]
    return { x: t.clientX + delta.x, y: t.clientY + delta.y }
  }
  return null
}

function mergeTargetAtPointer(x: number, y: number, activeId: string): string | null {
  const elements = document.elementsFromPoint(x, y)
  for (const el of elements) {
    const row = el.closest('[data-merge-target]') as HTMLElement | null
    if (!row) continue
    const id = row.getAttribute('data-merge-target')
    if (id && id !== activeId) return id
  }
  return null
}

export function LibraryPage() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.checklistTemplates.orderBy('sortOrder').toArray(), [])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleCreate = async () => {
    const t = await createTemplate('New block', 15)
    navigate(`/library/${t.id}`)
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragMove = (event: {
    active: { id: unknown }
    activatorEvent: Event | null
    delta: { x: number; y: number }
  }) => {
    const pt = pointerFromDrag(event.activatorEvent, event.delta)
    setMergeTargetId(pt ? mergeTargetAtPointer(pt.x, pt.y, String(event.active.id)) : null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const list = templates ?? []

    if (!list.length) return

    const activeTemplateId = String(active.id)
    const pt = pointerFromDrag(event.activatorEvent, event.delta)
    const mergeFromPointer = pt ? mergeTargetAtPointer(pt.x, pt.y, activeTemplateId) : null
    const mergeInto =
      mergeTargetId && mergeTargetId !== activeTemplateId ? mergeTargetId : mergeFromPointer

    setActiveId(null)
    setMergeTargetId(null)

    if (mergeInto) {
      await mergeTemplateInto(activeTemplateId, mergeInto)
      return
    }

    if (!over || active.id === over.id) return
    const newOrder = reorderIds(list, activeTemplateId, String(over.id))
    await setTemplateSortOrders(newOrder)
  }

  const activeTemplate = activeId ? templates?.find((t) => t.id === activeId) : undefined

  return (
    <>
      <header className="page-header library-header">
        <div>
          <h1>Library</h1>
          <p>Reusable block templates</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void handleCreate()}>
          + New
        </button>
      </header>

      {!templates?.length ? (
        <div className="empty-state">
          <p className="display">No templates yet</p>
          <p>Create a block you use often — like preparing your bag.</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: '1.25rem' }} onClick={() => void handleCreate()}>
            Create first template
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <SortableContext items={templates.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="template-list">
              {templates.map((t) => (
                <SortableLibraryCard
                  key={t.id}
                  template={t}
                  isMergeTarget={mergeTargetId === t.id}
                  isDragging={activeId === t.id}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeTemplate ? (
              <div className="list-card template-card-overlay">
                <div className="list-card-row">
                  <span className="list-card-title">{activeTemplate.title}</span>
                  <span className="list-card-meta">
                    {formatDuration(activeTemplate.defaultDurationMin)} default
                    {activeTemplate.repeat ? ` · ${formatTemplateRepeat(activeTemplate.repeat)}` : ''}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <p className="library-dnd-hint">Drop onto a list to combine · drop between lists to reorder</p>
    </>
  )
}

function SortableLibraryCard({
  template,
  isMergeTarget,
  isDragging,
}: {
  template: ChecklistTemplate
  isMergeTarget: boolean
  isDragging: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: template.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`template-sortable${isMergeTarget ? ' template-sortable--merge-target' : ''}`}
      data-merge-target={template.id}
    >
      <button
        type="button"
        className="template-drag-handle"
        aria-label="Drag to reorder or combine"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <Link to={`/library/${template.id}`} className="list-card template-link">
        <div className="list-card-row">
          <span className="list-card-title">{template.title}</span>
          <span className="list-card-meta">
            {formatDuration(template.defaultDurationMin)} default
            {template.repeat ? ` · ${formatTemplateRepeat(template.repeat)}` : ''}
          </span>
        </div>
      </Link>
    </div>
  )
}
