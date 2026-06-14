import { applyTimeOnDate, DAY_START_TIME } from './scheduleTime'
import { todayDateString } from './ids'

export type RepeatUnit = 'day' | 'week' | 'month' | 'year'

/** @deprecated Legacy shape; normalized on read */
type LegacyTemplateRepeat = {
  interval: 'weekly'
  weekday: number
  timeHHMM: string
}

export interface TemplateRepeat {
  every: number
  unit: RepeatUnit
  timeHHMM: string
  /** First date the rule applies (YYYY-MM-DD) */
  anchorDate: string
  /** 0 = Sunday … 6 = Saturday — for `week` (legacy single day) */
  weekday?: number
  /** 0 = Sunday … 6 = Saturday — for `week` (one or more days) */
  weekdays?: number[]
  /** Weekly overrides only — days omitted use `timeHHMM`. */
  weekdayTimes?: Partial<Record<number, string>>
  /** YYYY-MM-DD dates to omit from the repeat schedule. */
  skippedDates?: string[]
  /** 1–31 — for `month` and `year` */
  dayOfMonth?: number
  /** 1–12 — for `year` only */
  month?: number
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

const UNIT_LABEL: Record<RepeatUnit, [singular: string, plural: string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? WEEKDAY_LABELS[0]
}

/** Selected weekdays for a weekly repeat (defaults to Sunday). */
export function getRepeatWeekdays(repeat: TemplateRepeat | LegacyTemplateRepeat): number[] {
  const normalized = 'unit' in repeat ? repeat : null
  if (normalized?.weekdays?.length) {
    return [...normalized.weekdays].sort((a, b) => a - b)
  }
  if (normalized?.weekday != null) return [normalized.weekday]
  if ('weekday' in repeat && repeat.weekday != null) return [repeat.weekday]
  return [0]
}

function withWeekdays(repeat: TemplateRepeat): TemplateRepeat {
  if (repeat.unit !== 'week') {
    const { weekdayTimes: _t, weekday: _w, weekdays: _d, ...rest } = repeat
    return rest
  }
  const weekdays = getRepeatWeekdays(repeat)
  const { weekday: _w, ...rest } = repeat
  return pruneWeekdayTimes({ ...rest, weekdays })
}

function pruneWeekdayTimes(repeat: TemplateRepeat): TemplateRepeat {
  if (repeat.unit !== 'week' || !repeat.weekdayTimes) return repeat

  const cleaned: Partial<Record<number, string>> = {}
  for (const day of getRepeatWeekdays(repeat)) {
    const time = repeat.weekdayTimes[day]
    if (time && time !== repeat.timeHHMM) cleaned[day] = time
  }

  if (Object.keys(cleaned).length === 0) {
    const { weekdayTimes: _t, ...rest } = repeat
    return rest
  }
  return { ...repeat, weekdayTimes: cleaned }
}

/** True when a weekly rule stores per-day time overrides. */
export function hasPerWeekdayTimes(repeat: TemplateRepeat): boolean {
  return repeat.unit === 'week' && Object.keys(repeat.weekdayTimes ?? {}).length > 0
}

/** Effective HH:mm for a weekday in a weekly rule. */
export function repeatTimeForWeekday(repeat: TemplateRepeat, weekday: number): string {
  const normalized = normalizeTemplateRepeat(repeat)
  return normalized.weekdayTimes?.[weekday] ?? normalized.timeHHMM
}

/** Effective HH:mm for a calendar date. */
export function repeatTimeHHMMForDate(
  raw: TemplateRepeat | LegacyTemplateRepeat,
  dateStr: string
): string {
  const repeat = normalizeTemplateRepeat(raw)
  if (repeat.unit === 'week') {
    const weekday = parseDate(dateStr).getDay()
    return repeatTimeForWeekday(repeat, weekday)
  }
  return repeat.timeHHMM
}

export function monthLabel(month: number): string {
  return MONTH_LABELS[month - 1] ?? MONTH_LABELS[0]
}

export function normalizeTemplateRepeat(
  repeat: TemplateRepeat | LegacyTemplateRepeat
): TemplateRepeat {
  if ('unit' in repeat && repeat.every >= 1) {
    return clampRepeat(withWeekdays(repeat))
  }
  const legacy = repeat as LegacyTemplateRepeat
  const today = todayDateString()
  return clampRepeat(
    withWeekdays({
      every: 1,
      unit: 'week',
      weekdays: [legacy.weekday],
      timeHHMM: legacy.timeHHMM,
      anchorDate: today,
    })
  )
}

function clampRepeat(repeat: TemplateRepeat): TemplateRepeat {
  const every = Math.min(99, Math.max(1, Math.round(repeat.every) || 1))
  const next = { ...repeat, every }
  if (!next.skippedDates?.length) {
    const { skippedDates: _s, ...rest } = next
    return rest
  }
  return { ...next, skippedDates: [...new Set(next.skippedDates)].sort() }
}

export function defaultTemplateRepeat(referenceDate = new Date()): TemplateRepeat {
  const anchorDate = todayDateString()
  return {
    every: 1,
    unit: 'week',
    weekdays: [referenceDate.getDay()],
    timeHHMM: DAY_START_TIME,
    anchorDate,
  }
}

export function repeatNeedsOnDay(unit: RepeatUnit): boolean {
  return unit !== 'day'
}

export function formatTemplateRepeat(raw: TemplateRepeat | LegacyTemplateRepeat): string {
  const repeat = normalizeTemplateRepeat(raw)
  const [, plural] = UNIT_LABEL[repeat.unit]
  const interval =
    repeat.every === 1
      ? `Every ${UNIT_LABEL[repeat.unit][0]}`
      : `Every ${repeat.every} ${plural}`

  let on = ''
  if (repeat.unit === 'week') {
    const weekdays = getRepeatWeekdays(repeat)
    if (hasPerWeekdayTimes(repeat)) {
      const slots = weekdays.map((day) => `${weekdayLabel(day)} ${repeatTimeForWeekday(repeat, day)}`)
      on = ` on ${slots.join(', ')}`
      return `${interval}${on}`
    }
    on = ` on ${weekdays.map(weekdayLabel).join(', ')}`
  } else if (repeat.unit === 'month' && repeat.dayOfMonth != null) {
    on = ` on the ${ordinal(repeat.dayOfMonth)}`
  } else if (repeat.unit === 'year' && repeat.month != null && repeat.dayOfMonth != null) {
    on = ` on ${monthLabel(repeat.month)} ${repeat.dayOfMonth}`
  }

  return `${interval}${on} at ${repeat.timeHHMM}`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`)
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const d = parseDate(dateStr)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysBetween(from: string, to: string): number {
  const a = parseDate(from).getTime()
  const b = parseDate(to).getTime()
  return Math.round((b - a) / 86_400_000)
}

function monthsBetween(from: string, to: string): number {
  const a = parseDate(from)
  const b = parseDate(to)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function yearsBetween(from: string, to: string): number {
  return parseDate(to).getFullYear() - parseDate(from).getFullYear()
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function effectiveDayOfMonth(year: number, monthIndex: number, dayOfMonth: number): number {
  return Math.min(dayOfMonth, daysInMonth(year, monthIndex))
}

/** First calendar date on or after `from` with the given weekday (0–6). */
function alignToWeekday(from: string, weekday: number): string {
  let cursor = from
  for (let i = 0; i < 7; i++) {
    if (parseDate(cursor).getDay() === weekday) return cursor
    cursor = addDaysToDateString(cursor, 1)
  }
  return from
}

export function isRepeatSkippedOnDate(
  raw: TemplateRepeat | LegacyTemplateRepeat,
  dateStr: string
): boolean {
  const repeat = normalizeTemplateRepeat(raw)
  return repeat.skippedDates?.includes(dateStr) ?? false
}

export function isRepeatDueOnDate(
  raw: TemplateRepeat | LegacyTemplateRepeat,
  dateStr: string
): boolean {
  const repeat = normalizeTemplateRepeat(raw)
  if (daysBetween(repeat.anchorDate, dateStr) < 0) return false
  if (isRepeatSkippedOnDate(repeat, dateStr)) return false

  const d = parseDate(dateStr)

  switch (repeat.unit) {
    case 'day': {
      const diff = daysBetween(repeat.anchorDate, dateStr)
      return diff % repeat.every === 0
    }
    case 'week': {
      const weekdays = getRepeatWeekdays(repeat)
      if (!weekdays.includes(d.getDay())) return false
      const aligned = alignToWeekday(repeat.anchorDate, d.getDay())
      const weeks = Math.floor(daysBetween(aligned, dateStr) / 7)
      return weeks % repeat.every === 0
    }
    case 'month': {
      const dom = repeat.dayOfMonth ?? 1
      const effective = effectiveDayOfMonth(d.getFullYear(), d.getMonth(), dom)
      if (d.getDate() !== effective) return false
      const months = monthsBetween(repeat.anchorDate, dateStr)
      return months % repeat.every === 0
    }
    case 'year': {
      const month = repeat.month ?? 1
      const dom = repeat.dayOfMonth ?? 1
      if (d.getMonth() + 1 !== month) return false
      const effective = effectiveDayOfMonth(d.getFullYear(), d.getMonth(), dom)
      if (d.getDate() !== effective) return false
      const years = yearsBetween(repeat.anchorDate, dateStr)
      return years % repeat.every === 0
    }
    default:
      return false
  }
}

export function repeatHorizonDays(raw: TemplateRepeat | LegacyTemplateRepeat): number {
  const repeat = normalizeTemplateRepeat(raw)
  switch (repeat.unit) {
    case 'day':
      return Math.max(21, repeat.every * 14)
    case 'week':
      return Math.max(28, repeat.every * 7 * 4)
    case 'month':
      return Math.max(93, repeat.every * 31 * 3)
    case 'year':
      return Math.max(366, repeat.every * 366)
    default:
      return 21
  }
}

export function repeatScheduledStartMs(
  raw: TemplateRepeat | LegacyTemplateRepeat,
  dateStr: string
): number {
  return applyTimeOnDate(dateStr, repeatTimeHHMMForDate(raw, dateStr))
}

/** Defaults when switching repeat unit in the editor */
export function repeatDefaultsForUnit(
  unit: RepeatUnit,
  referenceDate = new Date()
): Pick<TemplateRepeat, 'weekdays' | 'dayOfMonth' | 'month'> {
  switch (unit) {
    case 'week':
      return { weekdays: [referenceDate.getDay()] }
    case 'month':
      return { dayOfMonth: referenceDate.getDate() }
    case 'year':
      return { month: referenceDate.getMonth() + 1, dayOfMonth: referenceDate.getDate() }
    default:
      return {}
  }
}
