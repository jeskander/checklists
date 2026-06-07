import { formatDuration } from './duration'
import { applyTimeOnDate, DAY_START_TIME, formatTime24h } from './scheduleTime'

/** Day planning window: 06:00 through midnight (18 hours). */
export const DAY_WINDOW_HOURS = 18
export const DAY_WINDOW_MINUTES = DAY_WINDOW_HOURS * 60

export type TimeGap = {
  startMs: number
  endMs: number
  minutes: number
}

export function dayWindowStartMs(dateStr: string): number {
  return applyTimeOnDate(dateStr, DAY_START_TIME)
}

export function dayWindowEndMs(dateStr: string): number {
  return dayWindowStartMs(dateStr) + DAY_WINDOW_HOURS * 60 * 60_000
}

export function formatGapLabel(gap: TimeGap): string {
  const start = new Date(gap.startMs)
  const end = new Date(gap.endMs)
  return `${formatTime24h(start)}–${formatTime24h(end)} · ${formatDuration(gap.minutes)} free`
}

/** Visual height for a gap; capped so long breaks do not dominate the page. */
export function gapHeightPx(minutes: number): number {
  const pxPerMin = 1.25
  const minPx = 28
  const maxPx = 140
  return Math.min(maxPx, Math.max(minPx, Math.round(minutes * pxPerMin)))
}

const MIN_GAP_MINUTES = 10

function gapIfEnough(startMs: number, endMs: number): TimeGap | null {
  const minutes = Math.round((endMs - startMs) / 60_000)
  if (minutes < MIN_GAP_MINUTES) return null
  return { startMs, endMs, minutes }
}

export function gapBeforeFirstInstance(
  dateStr: string,
  first: { scheduledStartMs: number }
): TimeGap | null {
  return gapIfEnough(dayWindowStartMs(dateStr), first.scheduledStartMs)
}

export function gapBetweenInstances(
  prev: { scheduledStartMs: number; durationMin: number },
  next: { scheduledStartMs: number }
): TimeGap | null {
  const prevEnd = prev.scheduledStartMs + prev.durationMin * 60_000
  return gapIfEnough(prevEnd, next.scheduledStartMs)
}

export function gapAfterLastInstance(
  dateStr: string,
  last: { scheduledStartMs: number; durationMin: number }
): TimeGap | null {
  const lastEnd = last.scheduledStartMs + last.durationMin * 60_000
  return gapIfEnough(lastEnd, dayWindowEndMs(dateStr))
}
