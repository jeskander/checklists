const STORAGE_KEY = 'checklists-last-calendar-date'

function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(`${date}T12:00:00`)
  return !Number.isNaN(d.getTime())
}

export function getLastCalendarDate(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored || !isValidDateString(stored)) return null
  return stored
}

export function setLastCalendarDate(date: string): void {
  if (!isValidDateString(date)) return
  localStorage.setItem(STORAGE_KEY, date)
}
