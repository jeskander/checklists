/** Stored durations are whole minutes. UI uses HH:MM (hours:minutes), e.g. 00:15, 11:00. */

export const DEFAULT_DURATION_MIN = 15
export const MAX_DURATION_MIN = 24 * 60

export function minutesToDurationValue(minutes: number): string {
  const total = Math.max(0, Math.min(MAX_DURATION_MIN, Math.round(minutes || 0)))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Four digit buffer for masked entry (e.g. "0015" → 00:15). */
export function minutesToDigits(minutes: number): string {
  return minutesToDurationValue(minutes).replace(':', '')
}

export function formatDigitsMask(digits: string): string {
  if (digits.length === 0) return ''
  const d = digits.padStart(4, '0').slice(-4)
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`
}

export function sanitizeDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(-4)
}

export function minutesFromDigits(digits: string): number | null {
  if (digits.length === 0) return 0
  return parseDurationValue(formatDigitsMask(digits))
}

export function parseDurationValue(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!match) return null

  const hours = Number(match[1])
  const mins = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins > 59) return null

  return hours * 60 + mins
}

/** Persisted value: 00:00 (or empty/zero) becomes the default 15 minutes. */
export function resolveDurationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_DURATION_MIN
  return Math.min(MAX_DURATION_MIN, Math.round(minutes))
}

export function parseDurationInput(value: string, fallbackMinutes: number): number {
  const parsed = parseDurationValue(value)
  if (parsed === null) return resolveDurationMinutes(fallbackMinutes)
  return resolveDurationMinutes(parsed)
}

/** Display label for cards and schedule subtitles. */
export function formatDuration(minutes: number): string {
  return minutesToDurationValue(minutes)
}
