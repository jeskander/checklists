import type {
  ChecklistTemplate,
  Day,
  DayFreeTime,
  DayInstance,
  DayInstanceItem,
  TaskList,
  TaskListItem,
  TemplateItem,
} from '../db/types'
import { importanceToDb, repeatToColumns, toIso } from '../lib/supabaseHelpers'

// ─── App → Supabase ──────────────────────────────────────────────────────────

export function templateToRow(t: ChecklistTemplate): Record<string, unknown> {
  return {
    id: t.id,
    kind: 'checklist',
    title: t.title,
    default_duration_min: t.defaultDurationMin,
    sort_order: t.sortOrder,
    updated_at: toIso(t.updatedAt),
    ...repeatToColumns(t.repeat),
  }
}

export function taskListToRow(l: TaskList): Record<string, unknown> {
  return {
    id: l.id,
    kind: 'task_list',
    title: l.title,
    default_duration_min: l.defaultDurationMin,
    sort_order: l.sortOrder,
    updated_at: toIso(l.updatedAt),
    ...repeatToColumns(l.repeat),
  }
}

export function templateItemToRow(i: TemplateItem): Record<string, unknown> {
  return {
    id: i.id,
    block_id: i.templateId,
    parent_item_id: i.parentItemId ?? null,
    title: i.title,
    sort_order: i.sortOrder,
    duration_min: 0,
    updated_at: toIso(i.updatedAt),
  }
}

export function taskListItemToRow(i: TaskListItem): Record<string, unknown> {
  return {
    id: i.id,
    block_id: i.taskListId,
    parent_item_id: i.parentItemId ?? null,
    title: i.title,
    importance: importanceToDb(i.importance),
    duration_min: i.durationMin,
    sort_order: i.sortOrder,
    completed_at: i.completedAt ? toIso(i.completedAt) : null,
    deadline: i.deadline ?? null,
    updated_at: toIso(i.updatedAt),
  }
}

export function dayToRow(d: Day): Record<string, unknown> {
  return {
    id: d.id,
    date: d.date,
    updated_at: toIso(d.updatedAt),
  }
}

export function dayInstanceToRow(i: DayInstance): Record<string, unknown> {
  return {
    id: i.id,
    day_id: i.dayId,
    source_block_id: i.sourceTemplateId ?? i.sourceTaskListId ?? null,
    title: i.title,
    duration_min: i.durationMin,
    sort_order: i.sortOrder,
    scheduled_start: toIso(i.scheduledStartMs),
    timer_started_at: i.timerStartedAt ? toIso(i.timerStartedAt) : null,
    added_at: toIso(i.addedAt),
    note_json: i.noteJson ?? null,
    collapsed: i.collapsed,
    alt_group_id: i.altGroupId ?? null,
    alt_group_index: i.altGroupIndex ?? null,
    alt_stack_index: i.altStackIndex ?? null,
    updated_at: toIso(i.updatedAt),
  }
}

export function dayFreeTimeToRow(f: DayFreeTime): Record<string, unknown> {
  return {
    id: f.id,
    day_id: f.dayId,
    sort_order: f.sortOrder,
    duration_min: f.durationMin,
    alt_group_id: f.altGroupId ?? null,
    alt_group_index: f.altGroupIndex ?? null,
    alt_stack_index: f.altStackIndex ?? null,
    updated_at: toIso(f.updatedAt),
  }
}

export function dayInstanceItemToRow(i: DayInstanceItem): Record<string, unknown> {
  return {
    id: i.id,
    instance_id: i.instanceId,
    parent_item_id: i.parentItemId ?? null,
    source_block_item_id: i.sourceTaskListItemId ?? null,
    title: i.title,
    duration_min: i.durationMin ?? 0,
    deadline: i.deadline ?? null,
    completed: i.completed,
    sort_order: i.sortOrder,
    updated_at: toIso(i.updatedAt),
  }
}
