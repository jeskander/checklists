import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { EditableItemList } from '../components/EditableItemList'
import {
  addTemplateItem,
  addTemplateItemAfter,
  applyTemplateItemTree,
  deleteTemplate,
  deleteTemplateItem,
  reparentTemplateItem,
  restoreTemplate,
  restoreTemplateItems,
  updateTemplate,
  updateTemplateItem,
} from '../services/templates'
import { DurationInput } from '../components/DurationInput'
import { TemplateRepeatEditor } from '../components/TemplateRepeatEditor'
import type { TemplateRepeat } from '../lib/templateRepeat'
import { processCalendarRepeats } from '../services/templateRepeat'
import { useDebouncedDraft } from '../hooks/useDebouncedDraft'
import { useUndo } from '../context/UndoContext'
import './TemplateEditorPage.css'

export function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showUndo } = useUndo()

  const template = useLiveQuery(() => (id ? db.checklistTemplates.get(id) : undefined), [id])
  const items = useLiveQuery(
    () =>
      id
        ? db.templateItems.where('templateId').equals(id).sortBy('sortOrder')
        : [],
    [id]
  )

  const titleDraft = useDebouncedDraft(template?.title ?? '', (title) => {
    if (id) void updateTemplate(id, { title })
  })

  if (!id) return null
  if (template === undefined) return <p className="empty-state">Loading…</p>
  if (!template) return <p className="empty-state">Template not found</p>

  const sorted = items ?? []

  const handleDeleteTemplate = async () => {
    const snapshot = { template, items: [...sorted] }
    await deleteTemplate(id)
    showUndo('Template deleted', async () => {
      await restoreTemplate(snapshot.template)
      await restoreTemplateItems(snapshot.items)
    })
    navigate('/library')
  }

  return (
    <>
      <header className="page-header editor-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/library')}>
          ← Back
        </button>
        <div className="editor-header-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void handleDeleteTemplate()}>
            Delete
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/library')}>
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
        />
        <label className="duration-label">
          Default duration
          <DurationInput
            className="field duration-field"
            minutes={template.defaultDurationMin}
            onChange={(defaultDurationMin) => void updateTemplate(id, { defaultDurationMin })}
          />
        </label>
      </div>

      <TemplateRepeatEditor
        repeat={template.repeat}
        onChange={(repeat: TemplateRepeat | undefined) => {
          void updateTemplate(id, { repeat }).then(() => processCalendarRepeats())
        }}
      />

      <h2 className="section-label">Items</h2>

      <EditableItemList
        items={sorted}
        onApplyStructure={(structure) => applyTemplateItemTree(id, structure)}
        onUpdateTitle={(itemId, title) => void updateTemplateItem(itemId, { title })}
        onDelete={async (itemId) => {
          const snap = sorted.find((i) => i.id === itemId)
          if (!snap) return
          const childSnaps = sorted.filter((i) => i.parentItemId === itemId)
          await deleteTemplateItem(itemId)
          showUndo('Item deleted', async () => {
            await restoreTemplateItems([snap, ...childSnaps])
          })
        }}
        onAddAfter={(afterId) => addTemplateItemAfter(id, afterId).then((i) => i.id)}
        onReparent={(itemId, parentId) => reparentTemplateItem(itemId, parentId)}
      />

      <div className="editor-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void addTemplateItem(id, '')}>
          + Item
        </button>
      </div>
    </>
  )
}
