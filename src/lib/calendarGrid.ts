export type MonthGridCell = {
  date: string
  inMonth: boolean
}

export function parseCalendarDate(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00')
}

export function shiftCalendarDate(dateStr: string, deltaDays: number): string {
  const d = parseCalendarDate(dateStr)
  d.setDate(d.getDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export function monthPartsFromDate(dateStr: string): { year: number; month: number } {
  const d = parseCalendarDate(dateStr)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function addCalendarMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1, 12, 0, 0)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1, 12, 0, 0).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

/** Sunday-start grid (42 cells) for a calendar month. */
export function monthGridCells(year: number, month: number): MonthGridCell[] {
  const first = new Date(year, month, 1, 12, 0, 0)
  const start = new Date(first)
  start.setDate(start.getDate() - first.getDay())

  const cells: MonthGridCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push({
      date: d.toISOString().slice(0, 10),
      inMonth: d.getMonth() === month,
    })
  }
  return cells
}

export function monthGridDateRange(year: number, month: number): { start: string; end: string } {
  const cells = monthGridCells(year, month)
  return { start: cells[0].date, end: cells[cells.length - 1].date }
}

export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
