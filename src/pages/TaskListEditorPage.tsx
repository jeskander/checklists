import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { DurationInput } from '../components/DurationInput'
import { EditableTaskItemList } from '../components/EditableTaskItemList'
import { TemplateRepeatEditor } from '../components/TemplateRepeatEditor'
import type { TemplateRepeat } from '../lib/templateRepeat'
import { processCalendarRepeats } from '../services/templateRepeat'
import '../components/DateInput.css'
import { useDebouncedDraft } from '../hooks/useDebouncedDraft'
import { useUndo } from '../context/UndoContext'
import { collectDescendantIds } from '../lib/completion'
import {
  addTaskListItem,
  addTaskListItemAfter,
  deleteTaskList,
  deleteTaskListItem,
  isInboxList,
  reparentTaskListItem,
  restoreTaskList,
  restoreTaskListItems,
  setTaskListRootSortOrders,
  updateTaskList,
  updateTaskListGroupMeta,
  updateTaskListItem,
} from '../services/taskLists'
import './TaskListEditorPage.css'
import './TemplateEditorPage.css'

export function TaskListEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showUndo } = useUndo()

  const list = useLiveQuery(() => (id ? db.taskLists.get(id) : undefined), [id])
  const items = useLiveQuery(
    () =>
      id
        ? db.taskListItems.where('taskListId').equals(id).sortBy('sortOrder')
        : [],
    [id]
  )

  const openItems = (items ?? []).filter((item) => item.completedAt == null)

  const titleDraft = useDebouncedDraft(list?.title ?? '', (title) => {
    if (id) void updateTaskList(id, { title })
  })

  if (!id) return null
  if (list === undefined) return <p className="empty-state">Loading…</p>
  if (!list) return <p className="empty-state">Task list not found</p>

  const inbox = isInboxList(list)

  const handleDeleteList = async () => {
    const snapshot = { list, items: [...(items ?? [])] }
    await deleteTaskList(id)
    showUndo('Task list deleted', async () => {
      await restoreTaskList(snapshot.list)
      await restoreTaskListItems(snapshot.items)
    })
    navigate('/tasks')
  }

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
          ? 'Tab on a line to add a sub-step inside the same task. Priority, duration, and due date apply to the whole task.'
          : 'Tab to add sub-steps inside a task. Priority, duration, and due date apply to the whole task. Completed tasks disappear from this list.'}
      </p>

      {!openItems.length ? (
        <p className="empty-state" style={{ padding: '1rem 0' }}>
          No tasks yet — add one below.
        </p>
      ) : (
        <EditableTaskItemList
          items={openItems}
          onReorderRoots={(rootIds) => setTaskListRootSortOrders(rootIds)}
          onUpdateTitle={(itemId, title) => void updateTaskListItem(itemId, { title })}
          onUpdateImportance={(itemId, importance) => void updateTaskListGroupMeta(itemId, { importance })}
          onUpdateDuration={(itemId, durationMin) => void updateTaskListGroupMeta(itemId, { durationMin })}
          onUpdateDeadline={(itemId, deadline) => void updateTaskListGroupMeta(itemId, { deadline })}
          onDeleteTask={async (rootId) => {
            const snap = openItems.find((i) => i.id === rootId)
            if (!snap) return
            const childSnaps = openItems.filter((i) => collectDescendantIds(openItems, rootId).includes(i.id))
            await deleteTaskListItem(rootId)
            showUndo('Task deleted', async () => {
              await restoreTaskListItems([snap, ...childSnaps])
            })
          }}
          onDeleteSubitem={async (itemId) => {
            const snap = openItems.find((i) => i.id === itemId)
            if (!snap) return
            const childSnaps = openItems.filter((i) => collectDescendantIds(openItems, itemId).includes(i.id))
            await deleteTaskListItem(itemId)
            showUndo('Sub-step deleted', async () => {
              await restoreTaskListItems([snap, ...childSnaps])
            })
          }}
          onAddAfter={(afterId) => addTaskListItemAfter(id, afterId).then((i) => i.id)}
          onReparent={(itemId, parentId) => reparentTaskListItem(itemId, parentId)}
        />
      )}

      <div className="editor-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void addTaskListItem(id, '')}>
          + Task
        </button>
      </div>
    </>
  )
}
