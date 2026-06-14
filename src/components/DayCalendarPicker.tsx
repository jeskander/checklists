import { useEffect, useId, type RefObject } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  WEEKDAY_LABELS,
  addCalendarMonths,
  formatMonthLabel,
  monthGridCells,
  monthGridDateRange,
  monthPartsFromDate,
} from '../lib/calendarGrid'
import { todayDateString } from '../lib/ids'
import { getDayStatusesForRange, type DayCalendarStatus } from '../services/dayCalendarStatus'
import './DayCalendarPicker.css'

type Props = {
  selectedDate: string
  open: boolean
  onClose: () => void
  onSelectDate: (date: string) => void
  viewYear: number
  viewMonth: number
  onViewMonthChange: (year: number, month: number) => void
  containerRef: RefObject<HTMLElement | null>
}

const STATUS_CLASS: Record<DayCalendarStatus, string> = {
  neutral: '',
  complete: 'day-cal-cell--complete',
  incomplete: 'day-cal-cell--incomplete',
  urgent: 'day-cal-cell--urgent',
}

export function DayCalendarPicker({
  selectedDate,
  open,
  onClose,
  onSelectDate,
  viewYear,
  viewMonth,
  onViewMonthChange,
  containerRef,
}: Props) {
  const titleId = useId()

  const range = monthGridDateRange(viewYear, viewMonth)
  const statuses = useLiveQuery(
    () => (open ? getDayStatusesForRange(range.start, range.end) : undefined),
    [open, range.start, range.end]
  )

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose, containerRef])

  if (!open) return null

  const today = todayDateString()
  const cells = monthGridCells(viewYear, viewMonth)

  const shiftMonth = (delta: number) => {
    const next = addCalendarMonths(viewYear, viewMonth, delta)
    onViewMonthChange(next.year, next.month)
  }

  return (
    <div
      className="day-cal-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="day-cal-picker-nav">
        <button
          type="button"
          className="btn btn-ghost btn-icon day-cal-picker-shift"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h2 id={titleId} className="day-cal-picker-title">
          {formatMonthLabel(viewYear, viewMonth)}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon day-cal-picker-shift"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="day-cal-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="day-cal-weekday">
            {label}
          </span>
        ))}
      </div>

      <div className="day-cal-grid" role="grid">
        {cells.map(({ date, inMonth }) => {
          const status = statuses?.get(date) ?? 'neutral'
          const isToday = date === today
          const isSelected = date === selectedDate
          const dayNum = parseCalendarDay(date)

          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              className={[
                'day-cal-cell',
                STATUS_CLASS[status],
                inMonth ? '' : 'day-cal-cell--outside',
                isToday ? 'day-cal-cell--today' : '',
                isSelected ? 'day-cal-cell--selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDate(date)}
              aria-label={cellAriaLabel(date, status, isToday, isSelected)}
              aria-current={isSelected ? 'date' : undefined}
            >
              {dayNum}
            </button>
          )
        })}
      </div>

      <ul className="day-cal-legend" aria-label="Day status legend">
        <li>
          <span className="day-cal-legend-swatch day-cal-legend-swatch--complete" aria-hidden="true" />
          Complete
        </li>
        <li>
          <span className="day-cal-legend-swatch day-cal-legend-swatch--incomplete" aria-hidden="true" />
          Incomplete
        </li>
        <li>
          <span className="day-cal-legend-swatch day-cal-legend-swatch--urgent" aria-hidden="true" />
          Urgent
        </li>
      </ul>
    </div>
  )
}

function parseCalendarDay(dateStr: string): number {
  return parseInt(dateStr.slice(8, 10), 10)
}

function cellAriaLabel(
  dateStr: string,
  status: DayCalendarStatus,
  isToday: boolean,
  isSelected: boolean
): string {
  const d = new Date(dateStr + 'T12:00:00')
  const label = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const parts = [label]
  if (isToday) parts.push('today')
  if (isSelected) parts.push('selected')
  if (status !== 'neutral') parts.push(status)
  return parts.join(', ')
}

/** Sync view month when the selected date changes (e.g. via prev/next arrows). */
export function calendarViewMonthForDate(dateStr: string): { year: number; month: number } {
  return monthPartsFromDate(dateStr)
}
