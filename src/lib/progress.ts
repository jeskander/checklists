import { getEffectiveTimerStart } from './timer'

export function timeProgress(timerStartMs: number, durationMin: number): number {
  if (durationMin <= 0) return 0
  const elapsedMs = Date.now() - timerStartMs
  const plannedMs = durationMin * 60_000
  const pct = (elapsedMs / plannedMs) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

export function timeProgressForInstance(instance: {
  scheduledStartMs: number
  timerStartedAt?: number
  addedAt: number
  durationMin: number
}): number {
  const start = getEffectiveTimerStart(instance)
  if (start == null) return 0
  return timeProgress(start, instance.durationMin)
}
