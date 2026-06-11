import { useEffect, useState, useRef, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useDebouncedDraft } from '../hooks/useDebouncedDraft'
import type { DayInstance, DayInstanceItem } from '../db/types'
import { EditableItemList } from './EditableItemList'
import type { ItemTreeStructureRow } from '../lib/itemTreeMove'
import { RichNote } from './RichNote'
import { TimeInput } from './TimeInput'
import { canStartTimerNow } from '../lib/timer'
import { DurationInput } from './DurationInput'
import { resolveDurationMinutes } from '../lib/duration'
import { formatScheduleSubtitle } from '../lib/schedule'
import { durationMinFromScheduleEnd, endMsFromSchedule } from '../lib/scheduleTime'
import { getChildren } from '../lib/completion'
import './DayInstanceDetailSheet.css'

type DetailSection = 'items' | 'notes'

type Props = {
  instance: DayInstance
  dayDate: string
  items: DayInstanceItem[]
  onClose: () => void
  onDone: () => void
  onToggleItem: (id: string, completed: boolean) => void
  onReset: () => void
  onStartNow: () => void
  onNoteChange: (json: string) => void
  onTitleChange: (title: string) => void
  onDurationChange: (durationMin: number) => void
  onScheduledStartChange: (scheduledStartMs: number) => void
  onAddItem: (title: string, parentId?: string) => void
  onUpdateItemTitle: (itemId: string, title: string) => void
  onUpdateItemDuration?: (itemId: string, durationMin: number) => void
  onAddItemAfter: (afterItemId: string, title?: string) => Promise<string | void>
  onReparentItem: (itemId: string, parentId?: string) => Promise<void>
  onApplyItemStructure: (structure: ItemTreeStructureRow[]) => Promise<void>
  onDeleteItem: (itemId: string) => void
  editTitleOnOpen?: boolean
  editScheduleOnOpen?: boolean
}

export function DayInstanceDetailSheet({
  instance,
  dayDate,
  items,
  onClose,
  onDone,
  onToggleItem,
  onReset,
  onStartNow,
  onNoteChange,
  onTitleChange,
  onDurationChange,
  onScheduledStartChange,
  onAddItem,
  onUpdateItemTitle,
  onUpdateItemDuration,
  onAddItemAfter,
  onReparentItem,
  onApplyItemStructure,
  onDeleteItem,
  editTitleOnOpen,
  editScheduleOnOpen,
}: Props) {
  const showStartNow = canStartTimerNow(instance)
  const [openSections, setOpenSections] = useState<Set<DetailSection>>(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      return new Set(['items', 'notes'])
    }
    return new Set(['items'])
  })

  const toggleSection = (section: DetailSection) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  useEffect(() => {
    document.body.classList.add('detail-sheet-open')
    return () => document.body.classList.remove('detail-sheet-open')
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="detail-overlay" onClick={onClose} role="presentation">
      <div
        className="detail-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-sheet-title"
      >
        <header className="detail-header">
          <button type="button" className="btn btn-ghost detail-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="detail-header-main">
            <EditableTitle
              id="detail-sheet-title"
              value={instance.title}
              onChange={onTitleChange}
              editOnOpen={editTitleOnOpen}
            />
            <EditableSchedule
              durationMin={instance.durationMin}
              scheduledStartMs={instance.scheduledStartMs}
              dayDate={dayDate}
              onDurationChange={onDurationChange}
              onScheduledStartChange={onScheduledStartChange}
              editOnOpen={editScheduleOnOpen}
            />
          </div>
          <div className="detail-header-actions">
            {showStartNow && (
              <button
                type="button"
                className="btn-play-now"
                onClick={onStartNow}
                title="Start now"
                aria-label="Start now"
              >
                ▶
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-icon detail-action-sm"
              onClick={onReset}
              title="Reset"
              aria-label="Reset"
            >
              ↺
            </button>
          </div>
        </header>

        <div className="detail-body">
          <div className="detail-columns">
            <CollapsibleSection
              title="Items"
              count={items.length}
              open={openSections.has('items')}
              onToggle={() => toggleSection('items')}
            >
              {items.length > 0 ? (
                <EditableItemList
                  compact
                  items={items}
                  onToggle={onToggleItem}
                  onApplyStructure={onApplyItemStructure}
                  onUpdateTitle={onUpdateItemTitle}
                  onUpdateDuration={instance.sourceTaskListId ? onUpdateItemDuration : undefined}
                  onDelete={onDeleteItem}
                  onAddAfter={onAddItemAfter}
                  onReparent={onReparentItem}
                />
              ) : (
                <p className="detail-empty-items">No items yet</p>
              )}
              <AddItemInline items={items} onAdd={(t, parentId) => onAddItem(t, parentId)} />
            </CollapsibleSection>

            <CollapsibleSection
              title="Notes"
              open={openSections.has('notes')}
              onToggle={() => toggleSection('notes')}
            >
              <RichNote key={instance.id} content={instance.noteJson} onChange={onNoteChange} />
            </CollapsibleSection>
          </div>
        </div>

        <footer className="detail-footer">
          <button type="button" className="btn btn-primary detail-done" onClick={onDone}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

function EditableTitle({
  id,
  value,
  onChange,
  editOnOpen,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  editOnOpen?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const draft = useDebouncedDraft(value, onChange)

  useEffect(() => {
    if (editOnOpen) setEditing(true)
  }, [editOnOpen])

  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    el?.focus()
    el?.select()
  }, [editing])

  if (editing) {
    return (
      <input
        ref={inputRef}
        id={id}
        className="detail-title-input"
        placeholder="Block name"
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={() => {
          draft.onBlur()
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <h2
      id={id}
      className="detail-title-display"
      onClick={() => setEditing(true)}
      onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
      role="button"
      tabIndex={0}
    >
      {value || 'Untitled'}
    </h2>
  )
}

function EditableSchedule({
  durationMin,
  scheduledStartMs,
  dayDate,
  onDurationChange,
  onScheduledStartChange,
  editOnOpen,
}: {
  durationMin: number
  scheduledStartMs: number
  dayDate: string
  onDurationChange: (n: number) => void
  onScheduledStartChange: (ms: number) => void
  editOnOpen?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [focusDuration, setFocusDuration] = useState(false)
  const label = formatScheduleSubtitle(durationMin, scheduledStartMs)
  const endMs = endMsFromSchedule(scheduledStartMs, durationMin)

  useEffect(() => {
    if (editOnOpen) {
      setEditing(true)
      setFocusDuration(false)
    }
  }, [editOnOpen])

  if (editing) {
    return (
      <div className="detail-schedule-edit-inline">
        <DurationInput
          className="detail-inline-field detail-inline-duration"
          minutes={durationMin}
          autoFocus={focusDuration}
          onChange={onDurationChange}
        />
        <span className="detail-schedule-sep">-</span>
        <TimeInput
          className="detail-inline-field detail-inline-time"
          dayDate={dayDate}
          scheduledStartMs={scheduledStartMs}
          onChange={onScheduledStartChange}
        />
        <span className="detail-schedule-sep">–</span>
        <TimeInput
          className="detail-inline-field detail-inline-time"
          dayDate={dayDate}
          scheduledStartMs={endMs}
          ariaLabel="End time (24-hour)"
          onChange={(newEndMs) => {
            const minutes = durationMinFromScheduleEnd(scheduledStartMs, newEndMs)
            if (minutes == null) return
            onDurationChange(resolveDurationMinutes(minutes))
          }}
        />
        <button type="button" className="detail-inline-done" onClick={() => setEditing(false)}>
          ✓
        </button>
      </div>
    )
  }

  return (
    <p
      className="detail-subtitle-display"
      onClick={() => {
        setEditing(true)
        setFocusDuration(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setEditing(true)
          setFocusDuration(true)
        }
      }}
      role="button"
      tabIndex={0}
    >
      {label}
    </p>
  )
}

function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className={`detail-section${open ? ' detail-section--open' : ''}`}>
      <button type="button" className="detail-section-toggle" onClick={onToggle} aria-expanded={open}>
        <span className="detail-section-chevron" aria-hidden>
          ›
        </span>
        <span className="detail-section-title">{title}</span>
        {count != null && <span className="detail-section-count">{count}</span>}
      </button>
      <div className="detail-section-panel" aria-hidden={!open}>
        <div className="detail-section-content">{children}</div>
      </div>
    </section>
  )
}

function getLastTopLevelItemId(items: DayInstanceItem[]): string | undefined {
  const tops = getChildren(items, undefined).sort((a, b) => a.sortOrder - b.sortOrder)
  return tops[tops.length - 1]?.id
}

function AddItemInline({
  items,
  onAdd,
}: {
  items: DayInstanceItem[]
  onAdd: (title: string, parentId?: string) => void
}) {
  const [val, setVal] = useState('')
  const [parentId, setParentId] = useState<string | undefined>(undefined)

  const parentItem = parentId ? items.find((i) => i.id === parentId) : undefined
  const placeholder = parentItem
    ? `Sub-item under “${parentItem.title}”…`
    : 'Add item… (Tab → sub-item)'

  const submit = () => {
    const t = val.trim()
    if (!t) return
    onAdd(t, parentId)
    setVal('')
    setParentId(undefined)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const lastTop = getLastTopLevelItemId(items)
      if (!lastTop) return
      if (parentId === lastTop) {
        setParentId(undefined)
      } else {
        setParentId(lastTop)
      }
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      setParentId(undefined)
    }
    if (e.key === 'Escape') {
      setParentId(undefined)
    }
  }

  return (
    <div className={`add-item-inline add-item-inline--compact${parentId ? ' add-item-inline--sub' : ''}`}>
      {parentId && (
        <button
          type="button"
          className="add-item-sub-cancel"
          onClick={() => setParentId(undefined)}
          title="Top-level item"
        >
          ←
        </button>
      )}
      <input
        className="field field-sm"
        placeholder={placeholder}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={submit}>
        +
      </button>
    </div>
  )
}
