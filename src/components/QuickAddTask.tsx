import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useUndo } from '../context/UndoContext'
import { useLongPress, useVoiceDictation, isVoiceDictationSupported } from '../hooks/useVoiceDictation'
import type { TaskList } from '../db/types'
import {
  applyListSelection,
  filterTaskListsForQuery,
  parseQuickAddInput,
  resolveTaskListId,
} from '../lib/quickAddTask'
import { createTaskFromDictation, hasAnthropicConfig } from '../services/dictationTask'
import { DictationMicMeter } from './DictationMicMeter'
import {
  addTaskListItem,
  deleteTaskListItem,
  ensureInboxList,
  listTaskLists,
} from '../services/taskLists'
import './QuickAddTask.css'

function formatDurationMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatDeadlineDisplay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const IMPORTANCE_LABELS: Record<number, string> = {
  1: 'Highest',
  2: 'High',
  3: 'Normal',
  4: 'Low',
}

export function QuickAddTask() {
  const location = useLocation()
  const { showUndo } = useUndo()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [lists, setLists] = useState<TaskList[]>([])
  const [inboxListId, setInboxListId] = useState<string | undefined>()
  const [selectedListId, setSelectedListId] = useState<string | undefined>()
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [listCaret, setListCaret] = useState(0)
  const [dictationError, setDictationError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listsRef = useRef<TaskList[]>([])
  const inboxListIdRef = useRef<string | undefined>(undefined)

  const voice = useVoiceDictation()

  const hidden = location.pathname.startsWith('/settings')
  const parsed = parseQuickAddInput(text, listCaret)
  const filteredLists = parsed.showListDropdown
    ? filterTaskListsForQuery(lists, parsed.listQuery)
    : []

  const loadLists = useCallback(async () => {
    const inbox = await ensureInboxList()
    setInboxListId(inbox.id)
    inboxListIdRef.current = inbox.id
    const nextLists = await listTaskLists()
    setLists(nextLists)
    listsRef.current = nextLists
  }, [])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  useEffect(() => {
    if (!dictationError) return
    const id = window.setTimeout(() => setDictationError(null), 5000)
    return () => window.clearTimeout(id)
  }, [dictationError])

  useEffect(() => {
    setHighlightIndex(0)
  }, [parsed.listQuery, parsed.showListDropdown])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [open])

  const close = () => {
    setOpen(false)
    setText('')
    setListCaret(0)
    setSelectedListId(undefined)
    setError(null)
    setHighlightIndex(0)
  }

  const syncListCaret = () => {
    const el = inputRef.current
    if (el && text.includes('#')) {
      setListCaret(el.selectionStart ?? 0)
    }
  }

  const pickList = (list: TaskList) => {
    setSelectedListId(list.id)
    const next = applyListSelection(text, parsed.hashIndex, list.title)
    setText(next)
    setListCaret(next.length)
    setError(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(next.length, next.length)
      }
    })
  }

  const submit = async () => {
    if (submitting) return
    const caret = inputRef.current?.selectionStart ?? text.length
    const result = parseQuickAddInput(text, caret)
    const taskListId = resolveTaskListId(lists, result.listQuery, selectedListId, inboxListId)

    if (!result.title.trim()) {
      setError('Add a task name')
      return
    }
    if (!taskListId) {
      setError('Pick a list with #listname')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const item = await addTaskListItem(
        taskListId,
        result.title.trim(),
        result.importance ?? 2,
        result.durationMin ?? 15,
        result.deadline
      )
      const listTitle = lists.find((l) => l.id === taskListId)?.title ?? 'list'
      showUndo(`Added to ${listTitle}`, () => deleteTaskListItem(item.id))
      close()
    } catch {
      setError('Could not add task')
    } finally {
      setSubmitting(false)
    }
  }

  const finishDictation = useCallback(
    async (transcript: string) => {
      voice.setProcessing()
      setDictationError(null)
      try {
        const inbox = await ensureInboxList()
        inboxListIdRef.current = inbox.id
        const freshLists = await listTaskLists()
        listsRef.current = freshLists

        const { item, listTitle } = await createTaskFromDictation(
          transcript,
          freshLists,
          inbox.id
        )
        showUndo(`Added to ${listTitle}`, () => deleteTaskListItem(item.id))
      } catch (err) {
        setDictationError(err instanceof Error ? err.message : 'Could not create task')
      } finally {
        voice.reset()
      }
    },
    [showUndo, voice]
  )

  const handleLongPressStart = useCallback(() => {
    if (!isVoiceDictationSupported()) {
      setDictationError('Speech recognition is not supported in this browser')
      return
    }
    setDictationError(null)
    void loadLists()
    voice.startListening()
  }, [loadLists, voice])

  const handleLongPressEnd = useCallback(() => {
    if (!voice.isSessionActive()) return
    void (async () => {
      const ready = await voice.waitUntilListening()
      if (!ready) {
        voice.reset()
        setDictationError(voice.error ?? 'Could not start microphone')
        return
      }
      const transcript = await voice.stopListening()
      if (!transcript) {
        voice.reset()
        setDictationError(voice.error ?? 'No speech detected')
        return
      }
      await finishDictation(transcript)
    })()
  }, [finishDictation, voice])

  const longPress = useLongPress(
    () => setOpen(true),
    handleLongPressStart,
    handleLongPressEnd
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (parsed.showListDropdown && filteredLists.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIndex((i) => (i + 1) % filteredLists.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIndex((i) => (i - 1 + filteredLists.length) % filteredLists.length)
        return
      }
      if (e.key === 'Tab' && filteredLists.length > 0) {
        e.preventDefault()
        pickList(filteredLists[highlightIndex] ?? filteredLists[0])
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const resolvedListId = resolveTaskListId(lists, parsed.listQuery, selectedListId, inboxListId)
  const resolvedListTitle = lists.find((l) => l.id === resolvedListId)?.title

  const dictationActive = voice.phase === 'listening' || voice.phase === 'processing'
  const fabListening = voice.phase === 'listening'

  if (hidden) return null

  return (
    <>
      <button
        type="button"
        className={`quick-add-fab${fabListening ? ' quick-add-fab--listening' : ''}`}
        aria-label={fabListening ? 'Listening — release to add task' : 'Add task. Long press to dictate.'}
        onPointerDown={longPress.pointerDown}
        onPointerUp={longPress.pointerUp}
        onPointerCancel={longPress.pointerCancel}
        onClick={longPress.click}
        onContextMenu={longPress.contextMenu}
      >
        {fabListening ? (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zM11 18.1v2.9h2v-2.9a7 7 0 01-7-7H4a9 9 0 0016 0h-2a7 7 0 01-7 7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {dictationActive && (
        <div className="dictation-overlay" aria-live="polite">
          <div className="dictation-card">
            <DictationMicMeter bars={voice.bars} processing={voice.phase === 'processing'} />
            <p className="dictation-status">
              {voice.phase === 'listening' ? 'Listening…' : 'Creating task…'}
            </p>
            {voice.transcript ? (
              <p className="dictation-transcript">&ldquo;{voice.transcript}&rdquo;</p>
            ) : voice.phase === 'listening' ? (
              <p className="dictation-transcript dictation-transcript--hint">Speak your task</p>
            ) : null}
            {voice.phase === 'listening' && (
              <p className="dictation-hint">Release to add · defaults to Inbox</p>
            )}
          </div>
        </div>
      )}

      {dictationError && !dictationActive && (
        <div className="dictation-toast" role="alert">
          {dictationError}
        </div>
      )}

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-sheet quick-add-sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Add task</h2>
            <p className="quick-add-hint">
              Duration: <strong>01:30</strong> or <strong>0130</strong> · Due:{' '}
              <strong>15/06/2026</strong>, <strong>1st of July</strong>, <strong>this Monday</strong>{' '}
              · Priority: <strong>*1</strong> (highest) · List: <strong>#name</strong> (defaults to Inbox)
              {!hasAnthropicConfig() && (
                <>
                  {' '}
                  · Long-press <strong>+</strong> to dictate (add <strong>VITE_ANTHROPIC_API_KEY</strong>{' '}
                  for AI parsing)
                </>
              )}
            </p>

            <textarea
              ref={inputRef}
              className="quick-add-input field"
              value={text}
              rows={3}
              placeholder="*1 Review slides 1900 this Monday #Work"
              aria-label="Quick add task"
              onChange={(e) => {
                setText(e.target.value)
                setSelectedListId(undefined)
                setError(null)
                if (e.target.value.includes('#')) {
                  setListCaret(e.target.selectionStart ?? e.target.value.length)
                }
              }}
              onSelect={syncListCaret}
              onKeyUp={syncListCaret}
              onClick={syncListCaret}
              onKeyDown={onKeyDown}
            />

            {text.length > 0 && (
              <div className="quick-add-preview" aria-hidden="true">
                {parsed.spans.map((span, i) => (
                  <span key={i} className={`quick-add-token quick-add-token--${span.kind}`}>
                    {span.text}
                  </span>
                ))}
              </div>
            )}

            <div className="quick-add-detected" aria-live="polite">
              {parsed.importance != null && (
                <span className="quick-add-tag quick-add-tag--importance">
                  Priority {IMPORTANCE_LABELS[parsed.importance]}
                </span>
              )}
              {parsed.durationMin != null && (
                <span className="quick-add-tag quick-add-tag--duration">
                  Duration {formatDurationMin(parsed.durationMin)}
                </span>
              )}
              {parsed.deadline && (
                <span className="quick-add-tag quick-add-tag--date">
                  Due {formatDeadlineDisplay(parsed.deadline)}
                </span>
              )}
              {resolvedListTitle && (
                <span className="quick-add-tag quick-add-tag--list">List {resolvedListTitle}</span>
              )}
            </div>

            {parsed.showListDropdown && (
              <div className="quick-add-list-menu" role="listbox" aria-label="Task lists">
                {filteredLists.length > 0 ? (
                  filteredLists.map((list, index) => (
                    <button
                      key={list.id}
                      type="button"
                      role="option"
                      aria-selected={index === highlightIndex}
                      className={`quick-add-list-option${index === highlightIndex ? ' active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickList(list)}
                    >
                      {list.title}
                    </button>
                  ))
                ) : (
                  <p className="quick-add-list-option" style={{ color: 'var(--ink-muted)' }}>
                    No lists match
                  </p>
                )}
              </div>
            )}

            {error && <p className="quick-add-error">{error}</p>}

            <div className="quick-add-actions">
              <button type="button" className="btn btn-ghost" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => void submit()}
              >
                Add task
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
