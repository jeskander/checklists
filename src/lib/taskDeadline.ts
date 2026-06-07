import { formatDuration } from './duration'
import type { TaskListItem } from '../db/types'

export type TaskDueOnDay = {
  item: TaskListItem
  listTitle: string
}

export function formatTaskDueMeta(item: TaskListItem, listTitle: string): string {
  const parts = [listTitle, `Imp ${item.importance}`, formatDuration(item.durationMin)]
  return parts.join(' · ')
}

export function formatDeadlineDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatTaskOverdueMeta(item: TaskListItem, listTitle: string): string {
  const dueLabel = item.deadline ? formatDeadlineDate(item.deadline) : ''
  const parts = [listTitle, dueLabel ? `Was due ${dueLabel}` : '', formatDuration(item.durationMin)]
  return parts.filter(Boolean).join(' · ')
}