export function reorderIds<T extends { id: string }>(
  items: T[],
  activeId: string,
  overId: string
): string[] {
  const ids = items.map((i) => i.id)
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex < 0 || newIndex < 0) return ids
  const next = [...ids]
  const [removed] = next.splice(oldIndex, 1)
  next.splice(newIndex, 0, removed)
  return next
}

export async function applySortOrder(
  ids: string[],
  updateFn: (id: string, sortOrder: number) => Promise<void>
): Promise<void> {
  await Promise.all(ids.map((id, index) => updateFn(id, index)))
}
