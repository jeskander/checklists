import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  addAdHocInstance,
  addInstanceFromTaskList,
  addInstanceFromTemplate,
  type FreeSlotInsert,
  addInstanceItem,
  addInstanceItemAfter,
  applyInstanceItemTree,
  completeAllInstanceItems,
  deleteInstance,
  deleteInstanceItem,
  duplicateInstance,
  duplicateInstanceItem,
  reparentInstanceItem,
  saveInstanceAsTemplate,
  detachInstanceFromSource,
  updateInstanceItem,
  formatDateLabel,
  getOrCreateDay,
  linkInstancesAsAlternatives,
  stackInstanceInColumn,
  unlinkInstanceFromAltGroup,
  listDayFreeTimes,
  resetInstance,
  restoreInstanceReset,
  restoreDayInstance,
  restoreDayInstanceItems,
  applyFlatTimelineOrder,
  applyInstanceScheduledStartChange,
  clearFreeBlockAltGroup,
  reconcileDayTimeline,
  restoreDayTimeline,
  snapshotDayTimeline,
  startInstanceNow,
  toggleInstanceItem,
  updateInstance,
  listDayInstances,
  listInstanceItems,
} from '../services/days'
import { getTaskList, listOpenTasksDueOn, listOpenTasksOverdue } from '../services/taskLists'
import {
  endRepeatSeriesFromDate,
  getRepeatDeletePrompt,
  removeSkipOnDate,
  restoreRepeatSeries,
  skipRepeatOnDate,
  type RepeatDeletePrompt,
} from '../services/repeatDelete'
import { deleteTemplate } from '../services/templates'
import { db } from '../db/database'
import { calendarViewMonthForDate, DayCalendarPicker } from '../components/DayCalendarPicker'
import { DayDeadlineBanner } from '../components/DayDeadlineBanner'
import { todayDateString } from '../lib/ids'
import { setLastCalendarDate } from '../lib/lastCalendarDate'
import { useUndo } from '../context/UndoContext'
import type { ItemTreeStructureRow } from '../lib/itemTreeMove'
import { collectDescendantIds } from '../lib/completion'
import { reorderIds } from '../lib/reorder'
import { DayInstanceTile } from '../components/DayInstanceTile'
import { DayTimeGap } from '../components/DayTimeGap'
import { DaySplitRow } from '../components/DaySplitRow'
import { SortableDayTileInner, type BlockMenuHandlers } from '../components/SortableDayTileInner'
import { blockHeightPx } from '../lib/daySplitLayout'
import { SortableDayFreeTime } from '../components/SortableDayFreeTime'
import { DayInstanceDetailSheet } from '../components/DayInstanceDetailSheet'
import { DeleteRepeatInstanceDialog } from '../components/DeleteRepeatInstanceDialog'
import {
  buildTimeline,
  chainTimelineFromDayStart,
  groupTimelineForDisplay,
  flattenTimelineSortableIds,
  findAdjacentStandaloneInstance,
  isFreeTimelineDragId,
  parseSideDropId,
  parseStackBelowDropId,
  parseTimelineDragId,
  isSideOrStackDropId,
} from '../lib/dayTimelineLayout'
import '../components/DaySplitRow.css'
import { formatTime24h } from '../lib/scheduleTime'
import type { TimeGap } from '../lib/dayTimeline'
import type { DayFreeTime, DayInstance, DayInstanceItem } from '../db/types'
import './DayPage.css'

const dayTimelineCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args)
  const dropHits = pointerHits.filter(({ id }) => isSideOrStackDropId(String(id)))
  if (dropHits.length > 0) return dropHits

  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(({ id }) => !isSideOrStackDropId(String(id))),
  })
}

export function DayPage() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()
  const { showUndo } = useUndo()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarView, setCalendarView] = useState(() =>
    date ? calendarViewMonthForDate(date) : { year: new Date().getFullYear(), month: new Date().getMonth() }
  )
  const calendarAnchorRef = useRef<HTMLDivElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInsert, setPickerInsert] = useState<FreeSlotInsert | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editTitleOnOpen, setEditTitleOnOpen] = useState(false)
  const [editScheduleOnOpen, setEditScheduleOnOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ targetId: string; side: 'left' | 'right' } | null>(null)
  const [stackHintId, setStackHintId] = useState<string | null>(null)
  const [repeatDeletePrompt, setRepeatDeletePrompt] = useState<{
    inst: DayInstance
    instItems: DayInstanceItem[]
    prompt: RepeatDeletePrompt
  } | null>(null)

  const day = useLiveQuery(
    () => (date ? db.days.where('date').equals(date).first() : undefined),
    [date]
  )

  useEffect(() => {
    if (!date || day) return
    void getOrCreateDay(date)
  }, [date, day])

  const instances = useLiveQuery(
    () => (day?.id ? db.dayInstances.where('dayId').equals(day.id).sortBy('sortOrder') : []),
    [day?.id]
  )

  const freeTimes = useLiveQuery(
    () => (day?.id ? db.dayFreeTimes.where('dayId').equals(day.id).sortBy('sortOrder') : []),
    [day?.id]
  )

  const dueTasks = useLiveQuery(
    () => (date ? listOpenTasksDueOn(date) : []),
    [date]
  )

  const overdueTasks = useLiveQuery(
    () => (date && date === todayDateString() ? listOpenTasksOverdue(date) : []),
    [date]
  )

  const instanceIds = useMemo(() => (instances ?? []).map((i) => i.id), [instances])
  const instanceIdsKey = instanceIds.join(',')

  const allItems = useLiveQuery(
    async () => {
      if (!instanceIds.length) return {}
      const items = await db.dayInstanceItems.where('instanceId').anyOf(instanceIds).toArray()
      const map: Record<string, DayInstanceItem[]> = {}
      for (const item of items.sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (!map[item.instanceId]) map[item.instanceId] = []
        map[item.instanceId].push(item)
      }
      return map
    },
    [instanceIdsKey]
  )

  const templates = useLiveQuery(
    () => (pickerOpen ? db.checklistTemplates.orderBy('sortOrder').toArray() : []),
    [pickerOpen]
  )

  const taskLists = useLiveQuery(
    () => (pickerOpen ? db.taskLists.orderBy('sortOrder').toArray() : []),
    [pickerOpen]
  )

  useEffect(() => {
    if (!day || !date) return
    void reconcileDayTimeline(day.id, date)
  }, [day?.id, date])

  useEffect(() => {
    if (date) setLastCalendarDate(date)
  }, [date])

  useEffect(() => {
    if (!date) return
    setCalendarView(calendarViewMonthForDate(date))
  }, [date])

  useEffect(() => {
    if (!pickerOpen) return
    setPickerQuery('')
  }, [pickerOpen])

  const pickerQueryTrim = pickerQuery.trim()
  const pickerQueryNorm = pickerQueryTrim.toLowerCase()
  const filteredTemplates = pickerQueryNorm
    ? (templates ?? []).filter((t) => t.title.toLowerCase().includes(pickerQueryNorm))
    : (templates ?? [])
  const filteredTaskLists = pickerQueryNorm
    ? (taskLists ?? []).filter((t) => t.title.toLowerCase().includes(pickerQueryNorm))
    : (taskLists ?? [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const blockDidDragRef = useRef(false)

  const detailInstance = detailId ? instances?.find((i) => i.id === detailId) : undefined

  if (!date) return null

  const isViewingToday = date === todayDateString()
  const dueHeading = isViewingToday ? 'Due today' : `Due · ${formatDateLabel(date)}`

  const shiftDate = (delta: number) => {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    navigate(`/calendar/${d.toISOString().slice(0, 10)}`)
  }

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    if (instances?.some((i) => i.id === id)) {
      blockDidDragRef.current = true
      setDraggingId(id)
    } else if (isFreeTimelineDragId(id)) {
      setDraggingId(id)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : ''
    const side = parseSideDropId(overId)
    setDropHint(side ? { targetId: side.instanceId, side: side.side } : null)
    setStackHintId(parseStackBelowDropId(overId))
  }

  const clearDragState = () => {
    setDraggingId(null)
    setDropHint(null)
    setStackHintId(null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    clearDragState()
    if (!over || !instances || !day || !date || active.id === over.id) return

    const activeId = String(active.id)
    const overId = String(over.id)
    const isActiveInstance = instances.some((i) => i.id === activeId)
    const sideDrop = parseSideDropId(overId)
    const stackTargetId = parseStackBelowDropId(overId)

    if (isActiveInstance && stackTargetId && stackTargetId !== activeId) {
      const targetInst = instances.find((i) => i.id === stackTargetId)
      const activeInst = instances.find((i) => i.id === activeId)
      if (
        activeInst?.altGroupId &&
        activeInst.altGroupId === targetInst?.altGroupId &&
        (activeInst.altGroupIndex ?? 0) === (targetInst?.altGroupIndex ?? 0)
      ) {
        return
      }
      const before = snapshotDayTimeline(instances, freeTimes ?? [])
      await stackInstanceInColumn(activeId, stackTargetId)
      showUndo('Stacked in column', async () => {
        await restoreDayTimeline(before)
      })
      return
    }

    if (isActiveInstance && sideDrop && sideDrop.instanceId !== activeId) {
      const activeInst = instances.find((i) => i.id === activeId)
      const targetInst = instances.find((i) => i.id === sideDrop.instanceId)
      if (
        activeInst?.altGroupId &&
        activeInst.altGroupId === targetInst?.altGroupId &&
        (activeInst.altGroupIndex ?? 0) === (targetInst?.altGroupIndex ?? 0)
      ) {
        return
      }

      const before = snapshotDayTimeline(instances, freeTimes ?? [])
      await linkInstancesAsAlternatives(activeId, sideDrop.instanceId, sideDrop.side)
      showUndo('Placed side by side', async () => {
        await restoreDayTimeline(before)
      })
      return
    }

    const isActiveFree = isFreeTimelineDragId(activeId)
    let resolveOverId = overId
    if (isActiveFree) {
      if (sideDrop) resolveOverId = sideDrop.instanceId
      else if (stackTargetId) resolveOverId = stackTargetId
    }

    let currentInstances = instances
    let currentFreeTimes = freeTimes ?? []
    const activeInst = instances.find((i) => i.id === activeId)
    if (isActiveInstance && activeInst?.altGroupId && !sideDrop && !stackTargetId) {
      await unlinkInstanceFromAltGroup(activeId)
      currentInstances = await listDayInstances(day.id)
    }
    if (isActiveFree) {
      const freeId = parseTimelineDragId(activeId).id
      const activeFree = currentFreeTimes.find((f) => f.id === freeId)
      if (activeFree?.altGroupId) {
        await clearFreeBlockAltGroup(freeId)
        currentFreeTimes = await listDayFreeTimes(day.id)
      }
    }

    const timeline = buildTimeline(currentInstances, currentFreeTimes)
    const flatIds = flattenTimelineSortableIds(timeline, currentInstances, currentFreeTimes)
    const before = snapshotDayTimeline(currentInstances, currentFreeTimes)
    const newFlatIds = reorderIds(
      flatIds.map((id) => ({ id })),
      activeId,
      resolveOverId
    )

    await applyFlatTimelineOrder(date, day.id, newFlatIds, currentInstances)

    showUndo('Day schedule changed', async () => {
      await restoreDayTimeline(before)
    })
  }

  async function performDeleteInstance(inst: DayInstance, instItems: DayInstanceItem[]) {
    const snapInst = { ...inst }
    const snapItems = [...instItems]
    if (detailId === inst.id) setDetailId(null)
    await deleteInstance(inst.id)
    showUndo('Block removed', async () => {
      await restoreDayInstance(snapInst)
      await restoreDayInstanceItems(snapItems)
    })
  }

  async function requestDeleteInstance(inst: DayInstance, instItems: DayInstanceItem[]) {
    if (!date) {
      await performDeleteInstance(inst, instItems)
      return
    }
    const prompt = await getRepeatDeletePrompt(inst, date, formatDateLabel)
    if (prompt) {
      setRepeatDeletePrompt({ inst, instItems, prompt })
      return
    }
    await performDeleteInstance(inst, instItems)
  }

  async function handleRepeatDeleteChoice(mode: 'one' | 'future' | 'cancel') {
    if (!repeatDeletePrompt || !date || mode === 'cancel') {
      setRepeatDeletePrompt(null)
      return
    }

    const { inst, instItems, prompt } = repeatDeletePrompt
    const { source } = prompt

    if (mode === 'one') {
      const snapInst = { ...inst }
      const snapItems = [...instItems]
      await skipRepeatOnDate(source, date)
      if (detailId === inst.id) setDetailId(null)
      await deleteInstance(inst.id)
      setRepeatDeletePrompt(null)
      showUndo('Event skipped', async () => {
        await restoreDayInstance(snapInst)
        await restoreDayInstanceItems(snapItems)
        await removeSkipOnDate(source, date)
      })
      return
    }

    const snapshot = await endRepeatSeriesFromDate(source, date)
    if (detailId === inst.id) setDetailId(null)
    setRepeatDeletePrompt(null)
    if (snapshot) {
      showUndo('Repeat ended', async () => {
        await restoreRepeatSeries(snapshot, source, restoreDayInstance, restoreDayInstanceItems)
      })
    }
  }

  const instanceHandlers = (inst: DayInstance) => {
    const instItems = allItems?.[inst.id] ?? []
    const neighborAbove = instances
      ? findAdjacentStandaloneInstance(inst.id, instances, freeTimes ?? [], 'above')
      : undefined
    const neighborBelow = instances
      ? findAdjacentStandaloneInstance(inst.id, instances, freeTimes ?? [], 'below')
      : undefined

    const blockMenu: BlockMenuHandlers = {
      canSplitWithAbove: Boolean(neighborAbove),
      canSplitWithBelow: Boolean(neighborBelow),
      hasTemplateSource: Boolean(inst.sourceTemplateId),
      hasTaskListSource: Boolean(inst.sourceTaskListId),
      hasLinkedSource: Boolean(inst.sourceTemplateId || inst.sourceTaskListId),
      onStartNow: () => void startInstanceNow(inst.id),
      onReset: async () => {
        const prevItems = [...instItems]
        const prevAddedAt = inst.addedAt
        const prevTimer = inst.timerStartedAt
        await resetInstance(inst.id)
        showUndo('Block reset', async () => {
          await restoreInstanceReset(inst.id, prevItems, prevAddedAt, prevTimer)
        })
      },
      onMarkComplete: async () => {
        const snap = instItems.map((i) => ({ ...i }))
        await completeAllInstanceItems(inst.id)
        showUndo('Block marked complete', async () => {
          await restoreDayInstanceItems(snap)
        })
      },
      onDuplicate: async () => {
        const newId = await duplicateInstance(inst.id)
        showUndo('Block duplicated', async () => {
          await deleteInstance(newId)
        })
      },
      onSaveToLibrary: async () => {
        const templateId = await saveInstanceAsTemplate(inst.id)
        showUndo('Saved to library', async () => {
          await deleteTemplate(templateId)
        })
      },
      onDetachFromSource: async () => {
        const snapInst = { ...inst }
        await detachInstanceFromSource(inst.id)
        showUndo('Detached from source', async () => {
          await restoreDayInstance(snapInst)
        })
      },
      onChangeRepeatRule: () => {
        if (inst.sourceTemplateId) navigate(`/library/${inst.sourceTemplateId}`)
        else if (inst.sourceTaskListId) navigate(`/tasks/${inst.sourceTaskListId}`)
      },
      onSplitWithAbove: async () => {
        if (!neighborAbove || !instances || !freeTimes) return
        const before = snapshotDayTimeline(instances, freeTimes)
        await linkInstancesAsAlternatives(inst.id, neighborAbove.id, 'right')
        showUndo('Added to split plan', async () => {
          await restoreDayTimeline(before)
        })
      },
      onSplitWithBelow: async () => {
        if (!neighborBelow || !instances || !freeTimes) return
        const before = snapshotDayTimeline(instances, freeTimes)
        await linkInstancesAsAlternatives(inst.id, neighborBelow.id, 'left')
        showUndo('Added to split plan', async () => {
          await restoreDayTimeline(before)
        })
      },
      onUnlinkFromSplit: async () => {
        if (!inst.altGroupId || !instances || !freeTimes) return
        const before = snapshotDayTimeline(instances, freeTimes)
        await unlinkInstanceFromAltGroup(inst.id)
        showUndo('Removed from split plan', async () => {
          await restoreDayTimeline(before)
        })
      },
      onDelete: () => void requestDeleteInstance(inst, instItems),
    }

    return {
      onOpen: () => setDetailId(inst.id),
      blockMenu,
      onStartNow: blockMenu.onStartNow,
      onReset: blockMenu.onReset,
      onNoteChange: (json: string) => void updateInstance(inst.id, { noteJson: json }),
      onTitleChange: (title: string) => void updateInstance(inst.id, { title }),
      onDurationChange: (durationMin: number) => void updateInstance(inst.id, { durationMin }),
      onScheduledStartChange: (scheduledStartMs: number) =>
        void applyInstanceScheduledStartChange(inst.id, scheduledStartMs),
      onToggleItem: (id: string, completed: boolean) => void toggleInstanceItem(id, completed),
      onAddItem: (title: string, parentId?: string) => void addInstanceItem(inst.id, title, parentId),
      onUpdateItemTitle: (itemId: string, title: string) => void updateInstanceItem(itemId, { title }),
      onUpdateItemDuration: (itemId: string, durationMin: number) =>
        void updateInstanceItem(itemId, { durationMin }),
      onAddItemAfter: (afterItemId: string, title?: string) =>
        addInstanceItemAfter(inst.id, afterItemId, title ?? '').then((item) => item.id),
      onReparentItem: (itemId: string, parentId?: string) => reparentInstanceItem(itemId, parentId),
      onApplyItemStructure: (structure: ItemTreeStructureRow[]) =>
        applyInstanceItemTree(inst.id, structure),
      onDeleteItem: async (itemId: string) => {
        const snap = instItems.find((i) => i.id === itemId)
        if (!snap) return
        const descendantSnaps = instItems.filter((i) =>
          collectDescendantIds(instItems, itemId).includes(i.id)
        )
        await deleteInstanceItem(itemId)
        showUndo('Item deleted', async () => {
          await restoreDayInstanceItems([snap, ...descendantSnaps])
        })
      },
      onDuplicateItem: async (itemId: string) => {
        const newRootId = await duplicateInstanceItem(itemId)
        showUndo('Item duplicated', async () => {
          const currentItems = await listInstanceItems(inst.id)
          const toDelete = [newRootId, ...collectDescendantIds(currentItems, newRootId)]
          for (const id of [...toDelete].reverse()) {
            await deleteInstanceItem(id)
          }
        })
      },
    }
  }

  return (
    <>
      <header className="page-header day-header">
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => shiftDate(-1)} aria-label="Previous day">
          ‹
        </button>
        <div className="day-header-center-wrap" ref={calendarAnchorRef}>
          <button
            type="button"
            className="day-header-center day-header-date-btn"
            onClick={() => setCalendarOpen((open) => !open)}
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
            aria-label={`${formatDateLabel(date)}, choose a day`}
          >
            <h1>{formatDateLabel(date)}</h1>
            <div className="day-header-meta">
              <p>{date}</p>
              {!isViewingToday && (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon day-today-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/calendar/${todayDateString()}`)
                  }}
                  aria-label="Go to today"
                  title="Today"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                    <path
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              )}
            </div>
          </button>
          <DayCalendarPicker
            selectedDate={date}
            open={calendarOpen}
            onClose={() => setCalendarOpen(false)}
            onSelectDate={(d) => {
              navigate(`/calendar/${d}`)
              setCalendarOpen(false)
            }}
            viewYear={calendarView.year}
            viewMonth={calendarView.month}
            onViewMonthChange={(year, month) => setCalendarView({ year, month })}
            containerRef={calendarAnchorRef}
          />
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => shiftDate(1)} aria-label="Next day">
          ›
        </button>
      </header>

      <DayDeadlineBanner variant="overdue" tasks={overdueTasks ?? []} heading="Overdue" />
      <DayDeadlineBanner variant="due" tasks={dueTasks ?? []} heading={dueHeading} />

      <div className="day-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setPickerInsert(null)
            setPickerOpen(true)
          }}
        >
          + Add block
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={dayTimelineCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={clearDragState}
        onDragEnd={(e) => void handleDragEnd(e)}
      >
        <DayTimelineList
          date={date}
          instances={instances ?? []}
          freeTimes={freeTimes ?? []}
          allItems={allItems ?? {}}
          instanceHandlers={instanceHandlers}
          blockDidDragRef={blockDidDragRef}
          draggingId={draggingId}
          dropHint={dropHint}
          stackHintId={stackHintId}
          onFreeSlotClick={(freeId, gap) => {
            setPickerInsert({ freeId, scheduledStartMs: gap.startMs })
            setPickerOpen(true)
          }}
        />
        <DragOverlay dropAnimation={null}>
          {draggingId && instances && freeTimes && date
            ? (() => {
                const inst = instances.find((i) => i.id === draggingId)
                if (inst) {
                  const variant = inst.altGroupId ? 'split' : 'default'
                  const minHeight = variant === 'split' ? blockHeightPx(inst.durationMin) : undefined
                  return (
                    <div
                      className={[
                        'sortable-day-wrap sortable-day-wrap--overlay',
                        variant === 'split' ? 'sortable-day-wrap--split' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="day-drag day-drag--collapsed" aria-hidden="true">
                        ⋮⋮
                      </span>
                      <div
                        className="sortable-day-card"
                        style={minHeight ? { minHeight: `${minHeight}px` } : undefined}
                      >
                        <DayInstanceTile
                          instance={inst}
                          items={allItems?.[inst.id] ?? []}
                          variant={variant}
                          onOpen={() => {}}
                          onDelete={() => {}}
                        />
                      </div>
                    </div>
                  )
                }

                if (isFreeTimelineDragId(draggingId)) {
                  const { id: freeId } = parseTimelineDragId(draggingId)
                  const free = freeTimes.find((f) => f.id === freeId)
                  if (!free) return null
                  const timeline = buildTimeline(instances, freeTimes)
                  const { freeGaps } = chainTimelineFromDayStart(date, timeline, instances, freeTimes)
                  const gap = freeGaps.get(freeId)
                  if (!gap) return null
                  const isSplit = Boolean(free.altGroupId)
                  return (
                    <div
                      className={[
                        'sortable-day-wrap sortable-day-wrap--overlay sortable-day-wrap--gap',
                        isSplit ? 'sortable-day-wrap--split-gap' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="day-drag day-drag--collapsed" aria-hidden="true">
                        ⋮⋮
                      </span>
                      <div className="sortable-day-card sortable-day-card--gap">
                        <DayTimeGap gap={gap} />
                      </div>
                    </div>
                  )
                }

                return null
              })()
            : null}
        </DragOverlay>
      </DndContext>

      {detailInstance && date && (
        <DayInstanceDetailSheet
          instance={detailInstance}
          dayDate={date}
          items={allItems?.[detailInstance.id] ?? []}
          editTitleOnOpen={editTitleOnOpen}
          editScheduleOnOpen={editScheduleOnOpen}
          onClose={() => {
            setDetailId(null)
            setEditTitleOnOpen(false)
            setEditScheduleOnOpen(false)
          }}
          onDone={() => {
            setDetailId(null)
            setEditTitleOnOpen(false)
            setEditScheduleOnOpen(false)
          }}
          {...instanceHandlers(detailInstance)}
        />
      )}

      {repeatDeletePrompt ? (
        <DeleteRepeatInstanceDialog
          blockTitle={repeatDeletePrompt.prompt.blockTitle}
          subtitle={repeatDeletePrompt.prompt.subtitle}
          futureCount={repeatDeletePrompt.prompt.futureCount}
          showFutureOption={repeatDeletePrompt.prompt.showFutureOption}
          onChoose={(mode) => void handleRepeatDeleteChoice(mode)}
          onDismiss={() => setRepeatDeletePrompt(null)}
        />
      ) : null}

      {pickerOpen && (
        <div
          className="modal-overlay"
          onClick={() => {
            setPickerOpen(false)
            setPickerInsert(null)
          }}
        >
          <div className="modal-sheet picker-sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Add to day</h2>
            {pickerInsert ? (
              <p className="picker-slot-hint">
                Starting at {formatTime24h(new Date(pickerInsert.scheduledStartMs))}
              </p>
            ) : null}
            <input
              type="search"
              className="field picker-search"
              placeholder="Search or create block…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const title = e.currentTarget.value.trim()
                  if (title) void handleAddAdHoc(title)
                }
              }}
              autoFocus
              aria-label="Search or create block"
            />
            {pickerQueryTrim ? (
              <div className="chip-row picker-results">
                <button
                  type="button"
                  className="chip chip--create"
                  onClick={() => void handleAddAdHoc(pickerQueryTrim)}
                >
                  Create “{pickerQueryTrim}”
                </button>
              </div>
            ) : null}
            {(templates ?? []).length > 0 && (
              <>
                <p className="picker-label">From library</p>
                {filteredTemplates.length > 0 ? (
                  <div className="chip-row picker-results">
                    {filteredTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="chip"
                        onClick={() => void handleAddFromTemplate(t.id)}
                      >
                        {t.title}
                      </button>
                    ))}
                  </div>
                ) : pickerQueryNorm ? (
                  <p className="picker-empty">No templates match “{pickerQueryTrim}”</p>
                ) : null}
              </>
            )}
            {(taskLists ?? []).length > 0 && (
              <>
                <p className="picker-label">From task lists</p>
                <div className="chip-row picker-results">
                  {filteredTaskLists.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="chip chip--task-list"
                      onClick={() => void handleAddFromTaskList(t.id)}
                    >
                      {t.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )

  async function handleAddFromTemplate(templateId: string) {
    if (!day) return
    await addInstanceFromTemplate(templateId, day.id, pickerInsert ?? undefined)
    closePicker()
  }

  async function handleAddFromTaskList(taskListId: string) {
    if (!day) return
    const taskList = (taskLists ?? []).find((t) => t.id === taskListId) ?? (await getTaskList(taskListId))
    const durationMin = taskList?.defaultDurationMin ?? 60
    await addInstanceFromTaskList(taskListId, day.id, durationMin, pickerInsert ?? undefined)
    closePicker()
  }

  async function handleAddAdHoc(title: string) {
    if (!day) return
    const id = await addAdHocInstance(day.id, title, 15, pickerInsert ?? undefined)
    closePicker()
    setEditTitleOnOpen(false)
    setEditScheduleOnOpen(false)
    setDetailId(id)
  }

  function closePicker() {
    setPickerOpen(false)
    setPickerInsert(null)
  }
}

function DayTimelineList({
  date,
  instances,
  freeTimes,
  allItems,
  instanceHandlers,
  blockDidDragRef,
  draggingId,
  dropHint,
  stackHintId,
  onFreeSlotClick,
}: {
  date: string
  instances: DayInstance[]
  freeTimes: DayFreeTime[]
  allItems: Record<string, DayInstanceItem[]>
  instanceHandlers: (inst: DayInstance) => {
    onOpen: () => void
    blockMenu: BlockMenuHandlers
  }
  blockDidDragRef: React.MutableRefObject<boolean>
  draggingId: string | null
  dropHint: { targetId: string; side: 'left' | 'right' } | null
  stackHintId: string | null
  onFreeSlotClick: (freeId: string, gap: TimeGap) => void
}) {
  const timeline = buildTimeline(instances, freeTimes)
  const display = groupTimelineForDisplay(timeline, instances, freeTimes)
  const { freeGaps, instanceStarts } = chainTimelineFromDayStart(date, timeline, instances, freeTimes)
  const sortableIds = flattenTimelineSortableIds(timeline, instances, freeTimes)

  if (!instances.length && !freeTimes.length) {
    return (
      <div className="day-instances">
        <div className="empty-state compact">
          <p className="display">A clear day</p>
          <p>Add a block from your library or create one for today.</p>
        </div>
      </div>
    )
  }

  return (
    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
      <div className={`day-instances${draggingId ? ' day-instances--dragging' : ''}`}>
        {display.map((entry) =>
          entry.kind === 'free' ? (
            <SortableDayFreeTime
              key={entry.free.id}
              freeId={entry.free.id}
              gap={freeGaps.get(entry.free.id)!}
              onSlotClick={() => onFreeSlotClick(entry.free.id, freeGaps.get(entry.free.id)!)} 
            />
          ) : entry.kind === 'split' ? (
            <DaySplitRow
              key={entry.altGroupId}
              altGroupId={entry.altGroupId}
              columns={entry.columns}
              rowMinutes={entry.rowMinutes}
              instanceStarts={instanceStarts}
              allItems={allItems}
              freeGaps={freeGaps}
              dropHint={dropHint}
              stackHintId={stackHintId}
              blockDidDragRef={blockDidDragRef}
              instanceHandlers={instanceHandlers}
            />
          ) : (
            <SortableDayTileInner
              key={entry.instance.id}
              instance={entry.instance}
              items={allItems[entry.instance.id] ?? []}
              dropHint={dropHint}
              stackHintId={stackHintId}
              didDragRef={blockDidDragRef}
              {...instanceHandlers(entry.instance)}
            />
          )
        )}
      </div>
    </SortableContext>
  )
}
