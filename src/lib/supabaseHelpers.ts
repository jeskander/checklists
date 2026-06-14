import type { TemplateRepeat } from './templateRepeat'
import { getRepeatWeekdays } from './templateRepeat'
import type { TaskImportance } from '../db/types'

// ─── Timestamp conversion ────────────────────────────────────────────────────

export function toMs(iso: string): number {
  return new Date(iso).getTime()
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

export function nowIso(): string {
  return new Date().toISOString()
}

// ─── Importance mapping ──────────────────────────────────────────────────────

const IMPORTANCE_TO_DB: Record<number, string> = {
  1: 'urgent',
  2: 'high',
  3: 'normal',
  4: 'low',
}

const DB_TO_IMPORTANCE: Record<string, TaskImportance> = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
}

export function importanceToDb(n: TaskImportance): string {
  return IMPORTANCE_TO_DB[n] ?? 'normal'
}

export function dbToImportance(s: string | null): TaskImportance {
  return DB_TO_IMPORTANCE[s ?? 'normal'] ?? 2
}

// ─── Repeat rule mapping ─────────────────────────────────────────────────────

/** Encode weekly repeat days in repeat_weekday (legacy 0–6 = single day; 100+ = bitmask). */
function weekdaysToColumn(weekdays: number[]): number | null {
  if (!weekdays.length) return null
  if (weekdays.length === 1) return weekdays[0]
  const bitmask = weekdays.reduce((mask, day) => mask | (1 << day), 0)
  return 100 + bitmask
}

function columnToWeekdays(value: number | null): number[] | undefined {
  if (value == null) return undefined
  if (value <= 6) return [value]
  if (value >= 100) {
    const bits = value - 100
    const days: number[] = []
    for (let day = 0; day <= 6; day++) {
      if (bits & (1 << day)) days.push(day)
    }
    return days.length ? days : undefined
  }
  return [value]
}

export interface RepeatColumns {
  repeat_every: number | null
  repeat_unit: string | null
  repeat_time_hhmm: string | null
  repeat_anchor_date: string | null
  repeat_weekday: number | null
  repeat_weekday_times: Record<string, string> | null
  repeat_skipped_dates: string[] | null
  repeat_day_of_month: number | null
  repeat_month: number | null
}

function weekdayTimesToColumn(
  repeat: TemplateRepeat
): Record<string, string> | null {
  if (repeat.unit !== 'week' || !repeat.weekdayTimes) return null
  const out: Record<string, string> = {}
  for (const [day, time] of Object.entries(repeat.weekdayTimes)) {
    if (time) out[String(day)] = time
  }
  return Object.keys(out).length ? out : null
}

function columnToWeekdayTimes(
  value: Record<string, string> | null | undefined
): Partial<Record<number, string>> | undefined {
  if (!value) return undefined
  const times: Partial<Record<number, string>> = {}
  for (const [day, time] of Object.entries(value)) {
    const n = parseInt(day, 10)
    if (Number.isFinite(n) && n >= 0 && n <= 6 && time) times[n] = time
  }
  return Object.keys(times).length ? times : undefined
}

export function repeatToColumns(repeat: TemplateRepeat | undefined): RepeatColumns {
  if (!repeat) {
    return {
      repeat_every: null,
      repeat_unit: null,
      repeat_time_hhmm: null,
      repeat_anchor_date: null,
      repeat_weekday: null,
      repeat_weekday_times: null,
      repeat_skipped_dates: null,
      repeat_day_of_month: null,
      repeat_month: null,
    }
  }
  return {
    repeat_every: repeat.every,
    repeat_unit: repeat.unit,
    repeat_time_hhmm: repeat.timeHHMM,
    repeat_anchor_date: repeat.anchorDate,
    repeat_weekday:
      repeat.unit === 'week' ? weekdaysToColumn(getRepeatWeekdays(repeat)) : null,
    repeat_weekday_times: weekdayTimesToColumn(repeat),
    repeat_skipped_dates: repeat.skippedDates?.length ? repeat.skippedDates : null,
    repeat_day_of_month: repeat.dayOfMonth ?? null,
    repeat_month: repeat.month ?? null,
  }
}

export function columnsToRepeat(row: RepeatColumns): TemplateRepeat | undefined {
  if (row.repeat_every == null || !row.repeat_unit || !row.repeat_time_hhmm || !row.repeat_anchor_date) {
    return undefined
  }
  const weekdays =
    row.repeat_unit === 'week' ? columnToWeekdays(row.repeat_weekday) : undefined
  return {
    every: row.repeat_every,
    unit: row.repeat_unit as TemplateRepeat['unit'],
    timeHHMM: row.repeat_time_hhmm,
    anchorDate: row.repeat_anchor_date,
    weekdays,
    weekdayTimes: columnToWeekdayTimes(row.repeat_weekday_times),
    skippedDates: row.repeat_skipped_dates ?? undefined,
    dayOfMonth: row.repeat_day_of_month ?? undefined,
    month: row.repeat_month ?? undefined,
  }
}
