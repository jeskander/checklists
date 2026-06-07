import { getChildren } from './completion'

export type FlatItem = { id: string; depth: number }

export type ItemTreeRow = {
  id: string
  parentItemId?: string
  sortOrder: number
}

export type ItemTreeStructureRow = {
  id: string
  parentItemId?: string
  sortOrder: number
}

export function getItemDepth<T extends { id: string; parentItemId?: string }>(
  items: T[],
  itemId: string
): number {
  let depth = 0
  let current = items.find((i) => i.id === itemId)
  while (current?.parentItemId) {
    depth++
    current = items.find((i) => i.id === current!.parentItemId)
  }
  return depth
}

export function flattenItemTree<T extends ItemTreeRow>(items: T[]): FlatItem[] {
  const result: FlatItem[] = []
  const walk = (parentId: string | undefined, depth: number) => {
    const children = getChildren(items, parentId).sort((a, b) => a.sortOrder - b.sortOrder)
    for (const child of children) {
      result.push({ id: child.id, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(undefined, 0)
  return result
}

export function extractSubtreeBlock(flat: FlatItem[], itemId: string): FlatItem[] {
  const start = flat.findIndex((e) => e.id === itemId)
  if (start < 0) return []
  const startDepth = flat[start].depth
  let end = start + 1
  while (end < flat.length && flat[end].depth > startDepth) end++
  return flat.slice(start, end)
}

export function rebuildParentsFromFlat(flat: FlatItem[]): Map<string, string | undefined> {
  const parents = new Map<string, string | undefined>()
  const stack: FlatItem[] = []
  for (const entry of flat) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= entry.depth) {
      stack.pop()
    }
    parents.set(entry.id, stack.length > 0 ? stack[stack.length - 1].id : undefined)
    stack.push(entry)
  }
  return parents
}

/** Move a block (item + descendants) to the drop target's position; aligns to target depth. */
export function moveItemBlockInFlat(
  flat: FlatItem[],
  activeId: string,
  overId: string
): FlatItem[] {
  const block = extractSubtreeBlock(flat, activeId)
  if (!block.length) return flat

  const without = flat.filter((e) => !block.some((b) => b.id === e.id))
  const overIdx = without.findIndex((e) => e.id === overId)
  if (overIdx < 0) return flat

  const targetDepth = without[overIdx].depth
  const depthDelta = targetDepth - block[0].depth
  const moved = block.map((e) => ({
    id: e.id,
    depth: Math.max(0, e.depth + depthDelta),
  }))

  const next = [...without]
  next.splice(overIdx, 0, ...moved)
  return next
}

export function flatToStructure(flat: FlatItem[]): ItemTreeStructureRow[] {
  const parents = rebuildParentsFromFlat(flat)
  const sortCounter = new Map<string, number>()

  return flat.map((entry) => {
    const parentItemId = parents.get(entry.id)
    const key = parentItemId ?? '__root__'
    const sortOrder = sortCounter.get(key) ?? 0
    sortCounter.set(key, sortOrder + 1)
    return { id: entry.id, parentItemId, sortOrder }
  })
}
