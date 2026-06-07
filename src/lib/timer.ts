/** When the elapsed-time bar begins counting (ms), or null if not started yet. */
export function getEffectiveTimerStart(instance: {
  scheduledStartMs: number
  timerStartedAt?: number
  addedAt: number
}): number | null {
  const t = Date.now()
  if (instance.timerStartedAt != null) return instance.timerStartedAt
  // Only auto-start at scheduled time if that time was not already past when the block was added.
  if (t >= instance.scheduledStartMs && instance.scheduledStartMs >= instance.addedAt) {
    return instance.scheduledStartMs
  }
  return null
}

export function canStartTimerNow(instance: {
  scheduledStartMs: number
  timerStartedAt?: number
  addedAt: number
}): boolean {
  return getEffectiveTimerStart(instance) == null && instance.timerStartedAt == null
}
