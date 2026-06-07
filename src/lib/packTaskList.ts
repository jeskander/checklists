import type { TaskListItem } from '../db/types'

/** Pack open tasks into a session budget; importance 1 is highest. Only tasks that fit are chosen. */
export function packTasksForSession(items: TaskListItem[], budgetMin: number): TaskListItem[] {
  if (budgetMin <= 0 || items.length === 0) return []

  const pool = items.filter((item) => item.completedAt == null)
  const picked: TaskListItem[] = []
  let remaining = budgetMin

  while (remaining > 0 && pool.length > 0) {
    const candidates = pool.filter((item) => item.durationMin <= remaining)
    if (candidates.length === 0) break

    const best = candidates.reduce((a, b) => {
      if (a.importance !== b.importance) return a.importance < b.importance ? a : b
      return a.sortOrder <= b.sortOrder ? a : b
    })

    picked.push(best)
    remaining -= best.durationMin
    const idx = pool.findIndex((item) => item.id === best.id)
    if (idx >= 0) pool.splice(idx, 1)
  }

  return picked
}
