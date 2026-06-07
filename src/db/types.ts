import type { TemplateRepeat } from '../lib/templateRepeat'

export interface ChecklistTemplate {
  id: string
  title: string
  defaultDurationMin: number
  sortOrder: number
  /** When set, the block is auto-added to matching calendar days. */
  repeat?: TemplateRepeat
  notionPageId?: string
  updatedAt: number
}

export interface TemplateItem {
  id: string
  templateId: string
  parentItemId?: string
  title: string
  sortOrder: number
  notionPageId?: string
  updatedAt: number
}

export interface Day {
  id: string
  date: string
  notionPageId?: string
  updatedAt: number
}

/** Movable free-time block on a day timeline (between or around blocks). */
export interface DayFreeTime {
  id: string
  dayId: string
  sortOrder: number
  durationMin: number
  /** When set, free time lives inside a parallel split column. */
  altGroupId?: string
  altGroupIndex?: number
  altStackIndex?: number
  updatedAt: number
}

export type TaskImportance = 1 | 2 | 3 | 4

export interface TaskList {
  id: string
  title: string
  /** Default session length when this list is added to a day. */
  defaultDurationMin: number
  sortOrder: number
  /** When set, the block is auto-added to matching calendar days. */
  repeat?: TemplateRepeat
  updatedAt: number
}

export interface TaskListItem {
  id: string
  taskListId: string
  title: string
  /** 1 = highest priority when packing into a day session. */
  importance: TaskImportance
  durationMin: number
  sortOrder: number
  /** Set when consumed from a day session; hidden from task list UI. */
  completedAt?: number
  /** Optional YYYY-MM-DD — surfaced on that calendar day. */
  deadline?: string
  updatedAt: number
}

export interface DayInstance {
  id: string
  dayId: string
  sourceTemplateId?: string
  sourceTaskListId?: string
  title: string
  /** Planned length (editable on calendar; copied from template default when added). */
  durationMin: number
  sortOrder: number
  /** When the block is scheduled to start on this day (editable). */
  scheduledStartMs: number
  /** Manual early start for elapsed-time bar; otherwise bar starts at scheduled time. */
  timerStartedAt?: number
  /** Legacy / reset bookkeeping */
  addedAt: number
  noteJson?: string
  collapsed: boolean
  /** When set, instances sharing this id are alternative plans shown side-by-side. */
  altGroupId?: string
  /** Left-to-right column index within a split group. */
  altGroupIndex?: number
  /** Top-to-bottom stack index within a split column. */
  altStackIndex?: number
  notionPageId?: string
  updatedAt: number
}

export interface DayInstanceItem {
  id: string
  instanceId: string
  parentItemId?: string
  sourceTaskListItemId?: string
  title: string
  /** Copied from task list items when packed into a session. */
  durationMin?: number
  deadline?: string
  completed: boolean
  sortOrder: number
  notionPageId?: string
  updatedAt: number
}

export interface SyncMeta {
  id: string
  lastPullAt?: number
  lastPushAt?: number
  notionDataSourceIds?: Record<string, string>
}

export type SyncOp = {
  type: 'create' | 'update' | 'delete'
  entity: string
  entityId: string
  notionPageId?: string
}

export type SyncQueueEntry = SyncOp & {
  id: string
  createdAt: number
}
