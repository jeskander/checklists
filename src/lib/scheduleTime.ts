/** True when value is HH:mm with minutes 0–59 and hours within limit. */
export function isValidHhMm(value: string, hoursMax = 23): boolean {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return false
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return Number.isFinite(hours) && Number.isFinite(minutes) && hours <= hoursMax && minutes <= 59
}

/** 24-hour clock string HH:mm */
export function msToTimeInputValue(ms: number): string {
  const d = new Date(ms)
  return formatClockFromParts(d.getHours(), d.getMinutes())
}

export function formatClockFromParts(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatTime24h(d: Date): string {
  return formatClockFromParts(d.getHours(), d.getMinutes())
}

/** Set clock time on a calendar day (local). */
export function applyTimeOnDate(dateStr: string, timeHHMM: string): number {
  const [h, m] = timeHHMM.split(':').map((x) => parseInt(x, 10))
  const d = new Date(`${dateStr}T00:00:00`)
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
  return d.getTime()
}

/** First block on a day starts at 06:00 on that date. */
export const DAY_START_TIME = '06:00'

export function defaultFirstSlotOnDay(dateStr: string): number {
  return applyTimeOnDate(dateStr, DAY_START_TIME)
}

export function endMsFromSchedule(scheduledStartMs: number, durationMin: number): number {
  return scheduledStartMs + durationMin * 60_000
}

/** Whole minutes from start to end; null when end is not after start. */
export function durationMinFromScheduleEnd(scheduledStartMs: number, endMs: number): number | null {
  const minutes = Math.round((endMs - scheduledStartMs) / 60_000)
  return minutes > 0 ? minutes : null
}

/** Next slot after the last block on the day (by sort order). */
export function nextScheduledStart(
  dateStr: string,
  previous: { scheduledStartMs: number; durationMin: number } | undefined
): number {
  if (!previous) return defaultFirstSlotOnDay(dateStr)
  return previous.scheduledStartMs + previous.durationMin * 60_000
}

export type ScheduleSlot = {
  scheduledStartMs: number
  durationMin: number
}

/** After reorder: first tile keeps its start; each next starts when the previous ends. */
export function chainScheduleStarts(slots: ScheduleSlot[]): number[] {
  if (slots.length === 0) return []
  const starts = new Array<number>(slots.length)
  starts[0] = slots[0].scheduledStartMs
  for (let i = 1; i < slots.length; i++) {
    starts[i] = starts[i - 1] + slots[i - 1].durationMin * 60_000
  }
  return starts
}
