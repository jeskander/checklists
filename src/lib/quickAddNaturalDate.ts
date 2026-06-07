/** Natural-language and compact date/time parsing for quick-add. */

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

export function toIsoDate(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1) return undefined
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return undefined
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function weekdayIso(relative: 'this' | 'next' | 'upcoming', dayName: string, ref = new Date()): string | undefined {
  const target = WEEKDAYS[dayName.toLowerCase()]
  if (target == null) return undefined

  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const current = d.getDay()
  let diff = target - current

  if (relative === 'this') {
    // Monday of this calendar week (may be in the past).
  } else if (relative === 'next') {
    if (diff <= 0) diff += 7
  } else {
    if (diff <= 0) diff += 7
  }

  d.setDate(d.getDate() + diff)
  return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function monthFromToken(token: string): number | undefined {
  return MONTHS[token.toLowerCase()]
}

export interface NaturalDateMatch {
  start: number
  end: number
  text: string
  iso?: string
  partial: boolean
}

const WEEKDAY_PATTERN =
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun'
const MONTH_PATTERN = Object.keys(MONTHS).join('|')

export function findNaturalDateTokens(text: string, ref = new Date()): NaturalDateMatch[] {
  const tokens: NaturalDateMatch[] = []
  const year = ref.getFullYear()

  const relativeWeekday = new RegExp(
    `(^|\\s)((?:this|next)\\s+(?:${WEEKDAY_PATTERN}))(?=\\s|$|#|\\*)`,
    'gi'
  )
  let match: RegExpExecArray | null
  while ((match = relativeWeekday.exec(text)) !== null) {
    const start = match.index + match[1].length
    const end = start + match[2].length
    const parts = match[2].toLowerCase().split(/\s+/)
    const iso = weekdayIso(parts[0] as 'this' | 'next', parts[1], ref)
    tokens.push({ start, end, text: text.slice(start, end), iso, partial: !iso })
  }

  const weekdayOnly = new RegExp(`(^|\\s)(${WEEKDAY_PATTERN})(?=\\s|$|#|\\*)`, 'gi')
  while ((match = weekdayOnly.exec(text)) !== null) {
    const start = match.index + match[1].length
    const end = start + match[2].length
    if (tokens.some((t) => start >= t.start && start < t.end)) continue
    const iso = weekdayIso('upcoming', match[2], ref)
    tokens.push({ start, end, text: text.slice(start, end), iso, partial: !iso })
  }

  const dayFirst = new RegExp(
    `(^|\\s)(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})(?:\\s+(\\d{4}))?(?=\\s|$|#|\\*)`,
    'gi'
  )
  while ((match = dayFirst.exec(text)) !== null) {
    const start = match.index + match[1].length
    const actualEnd = match.index + match[0].length
    const day = parseInt(match[2], 10)
    const month = monthFromToken(match[3])
    const y = match[4] ? parseInt(match[4], 10) : year
    const iso = month ? toIsoDate(y, month, day) : undefined
    tokens.push({
      start,
      end: actualEnd,
      text: text.slice(start, actualEnd),
      iso,
      partial: !iso,
    })
  }

  const monthFirst = new RegExp(
    `(^|\\s)(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?(?=\\s|$|#|\\*)`,
    'gi'
  )
  while ((match = monthFirst.exec(text)) !== null) {
    const start = match.index + match[1].length
    const actualEnd = match.index + match[0].length
    const month = monthFromToken(match[2])
    const day = parseInt(match[3], 10)
    const y = match[4] ? parseInt(match[4], 10) : year
    const iso = month ? toIsoDate(y, month, day) : undefined
    tokens.push({
      start,
      end: actualEnd,
      text: text.slice(start, actualEnd),
      iso,
      partial: !iso,
    })
  }

  return tokens
}

export function parseCompactDuration(text: string): { minutes: number } | null {
  if (!/^\d{4}$/.test(text)) return null
  const hours = parseInt(text.slice(0, 2), 10)
  const minutes = parseInt(text.slice(2, 4), 10)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (minutes > 59 || hours > 99) return null
  return { minutes: hours * 60 + minutes }
}
