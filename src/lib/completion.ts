export interface CheckableItem {
  id: string
  parentItemId?: string
  completed: boolean
}

export function getChildren<T extends { id: string; parentItemId?: string }>(
  items: T[],
  parentId: string | undefined
): T[] {
  return items.filter((i) => (i.parentItemId ?? undefined) === parentId)
}

/** All descendants of a parent (children, grandchildren, …). */
export function collectDescendantIds<T extends { id: string; parentItemId?: string }>(
  items: T[],
  parentId: string
): string[] {
  const ids: string[] = []
  const walk = (pid: string) => {
    for (const child of getChildren(items, pid)) {
      ids.push(child.id)
      walk(child.id)
    }
  }
  walk(parentId)
  return ids
}

export function isItemComplete(
  itemId: string,
  items: CheckableItem[]
): boolean {
  const children = getChildren(items, itemId)
  if (children.length === 0) {
    return items.find((i) => i.id === itemId)?.completed ?? false
  }
  return children.every((c) => isItemComplete(c.id, items))
}

export function countLeaves(items: CheckableItem[]): {
  total: number
  completed: number
} {
  const tops = getChildren(items, undefined)
  let total = 0
  let completed = 0

  const walk = (id: string) => {
    const children = getChildren(items, id)
    if (children.length === 0) {
      total++
      if (isItemComplete(id, items)) completed++
      return
    }
    children.forEach((c) => walk(c.id))
  }

  tops.forEach((t) => walk(t.id))
  return { total, completed }
}

export function taskProgress(items: CheckableItem[]): number {
  const { total, completed } = countLeaves(items)
  if (total === 0) return 0
  return Math.min(100, Math.round((completed / total) * 100))
}
