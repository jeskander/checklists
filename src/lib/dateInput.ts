/** Calendar dates as YYYY-MM-DD; UI entry as DD/MM/YYYY digit groups. */

export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [yyyy, mm, dd] = iso.split('-').map((x) => parseInt(x, 10))
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return false
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  const date = new Date(yyyy, mm - 1, dd)
  return date.getFullYear() === yyyy && date.getMonth() === mm - 1 && date.getDate() === dd
}

export function sanitizeDateDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8)
}

export function isoToDateDigits(iso?: string): string {
  if (!iso) return ''
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${match[3]}${match[2]}${match[1]}`
}

export function formatDateDigitsMask(digits: string): string {
  const d = digits.slice(0, 8)
  if (d.length === 0) return ''
  if (d.length === 8) {
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`
  }
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

export function dateDigitsComplete(digits: string): boolean {
  return digits.length === 8
}

export function nextDateSegment(segment: DateSegment): DateSegment | null {
  if (segment === 'day') return 'month'
  if (segment === 'month') return 'year'
  return null
}

export function dateSegmentLength(segment: DateSegment): number {
  return segment === 'year' ? 4 : 2
}

export function dateDigitsToIso(digits: string): string | undefined {
  if (digits.length !== 8) return undefined
  const dd = parseInt(digits.slice(0, 2), 10)
  const mm = parseInt(digits.slice(2, 4), 10)
  const yyyy = parseInt(digits.slice(4, 8), 10)
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return undefined
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1) return undefined

  const date = new Date(yyyy, mm - 1, dd)
  if (date.getFullYear() !== yyyy || date.getMonth() !== mm - 1 || date.getDate() !== dd) return undefined

  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

export type DateSegment = 'day' | 'month' | 'year'

export function dateSegmentAtCaret(caret: number): DateSegment {
  if (caret <= 2) return 'day'
  if (caret <= 5) return 'month'
  return 'year'
}

export function dateSegmentRange(segment: DateSegment): [number, number] {
  switch (segment) {
    case 'day':
      return [0, 2]
    case 'month':
      return [3, 5]
    case 'year':
      return [6, 10]
  }
}
