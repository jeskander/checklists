import { dateDigitsToIso, sanitizeDateDigits } from './dateInput'
import { minutesFromDigits } from './duration'
import { findNaturalDateTokens, parseCompactDuration } from './quickAddNaturalDate'
import type { TaskImportance, TaskList } from '../db/types'
import { isInboxList } from './inbox'

export type QuickAddSpanKind =
  | 'plain'
  | 'duration'
  | 'duration-partial'
  | 'date'
  | 'date-partial'
  | 'list'
  | 'importance'

export interface QuickAddSpan {
  kind: QuickAddSpanKind
  text: string
}

export interface QuickAddParseResult {
  spans: QuickAddSpan[]
  title: string
  durationMin?: number
  deadline?: string
  importance?: TaskImportance
  listQuery: string
  showListDropdown: boolean
  hashIndex: number
}

interface RawToken {
  start: number
  end: number
  kind: 'duration' | 'date' | 'list' | 'importance'
  partial: boolean
  durationMin?: number
  deadline?: string
  importance?: TaskImportance
}

function overlaps(a: RawToken, start: number, end: number): boolean {
  return a.start < end && a.end > start
}

function occupied(tokens: RawToken[], start: number, end: number): boolean {
  return tokens.some((t) => overlaps(t, start, end))
}

function findDurationColonTokens(text: string, existing: RawToken[]): RawToken[] {
  const tokens: RawToken[] = []
  const re = /(^|\s)(\d{1,2}):(\d{0,2})(?=\s|$|\/|#|\*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[1].length
    const end = start + match[2].length + 1 + match[3].length
    if (occupied(existing, start, end) || occupied(tokens, start, end)) continue
    const mm = match[3]
    const digits = `${match[2].padStart(2, '0')}${mm.padEnd(2, '0')}`.slice(-4)
    const parsed = mm.length === 2 ? minutesFromDigits(digits) : null
    tokens.push({
      start,
      end,
      kind: 'duration',
      partial: parsed === null,
      durationMin: parsed ?? undefined,
    })
  }
  return tokens
}

function findDurationCompactTokens(text: string, existing: RawToken[]): RawToken[] {
  const tokens: RawToken[] = []
  const re = /(^|\s)(\d{4})(?=\s|$|#|\*)(?![/\d])/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[1].length
    const end = start + 4
    if (occupied(existing, start, end) || occupied(tokens, start, end)) continue
    const parsed = parseCompactDuration(match[2])
    tokens.push({
      start,
      end,
      kind: 'duration',
      partial: !parsed,
      durationMin: parsed?.minutes,
    })
  }
  return tokens
}

function findSlashDateTokens(text: string, existing: RawToken[]): RawToken[] {
  const tokens: RawToken[] = []
  const re = /(^|\s)(\d{2}\/\d{2}(?:\/\d{0,4})?)(?=\s|$|#|\*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[1].length
    const end = start + match[2].length
    if (occupied(existing, start, end) || occupied(tokens, start, end)) continue
    const digits = sanitizeDateDigits(match[2])
    const iso = dateDigitsToIso(digits)
    tokens.push({
      start,
      end,
      kind: 'date',
      partial: !iso,
      deadline: iso,
    })
  }
  return tokens
}

function findNaturalDateTokenRaw(text: string, existing: RawToken[]): RawToken[] {
  return findNaturalDateTokens(text)
    .filter((t) => !occupied(existing, t.start, t.end))
    .map((t) => ({
      start: t.start,
      end: t.end,
      kind: 'date' as const,
      partial: t.partial,
      deadline: t.iso,
    }))
}

function findImportanceTokens(text: string, existing: RawToken[]): RawToken[] {
  const tokens: RawToken[] = []
  const re = /(^|\s)\*([1-4])(?=\s|$|#|\*|\d)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[1].length
    const end = start + 2
    if (occupied(existing, start, end) || occupied(tokens, start, end)) continue
    tokens.push({
      start,
      end,
      kind: 'importance',
      partial: false,
      importance: parseInt(match[2], 10) as TaskImportance,
    })
  }
  return tokens
}

function findListToken(text: string, reserved: RawToken[]): RawToken | null {
  const hashIndex = text.indexOf('#')
  if (hashIndex === -1) return null

  let end = text.length
  for (const token of reserved) {
    if (token.start > hashIndex && token.start < end) end = token.start
  }

  return {
    start: hashIndex,
    end,
    kind: 'list',
    partial: true,
  }
}

function collectMetadataTokens(text: string): RawToken[] {
  const naturalDates = findNaturalDateTokenRaw(text, [])
  const slashDates = findSlashDateTokens(text, naturalDates)
  const dates = mergeNonOverlapping([...naturalDates, ...slashDates])
  const colonDur = findDurationColonTokens(text, dates)
  const compactDur = findDurationCompactTokens(text, [...dates, ...colonDur])
  const durations = mergeNonOverlapping([...colonDur, ...compactDur])
  const importance = findImportanceTokens(text, [...dates, ...durations])
  return mergeNonOverlapping([...dates, ...durations, ...importance])
}

function mergeNonOverlapping(tokens: RawToken[]): RawToken[] {
  return tokens
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((token, index, all) => {
      if (index === 0) return true
      const prev = all[index - 1]
      return token.start >= prev.end
    })
}

function buildSpans(text: string, tokens: RawToken[]): QuickAddSpan[] {
  const spans: QuickAddSpan[] = []
  let cursor = 0

  for (const token of tokens) {
    if (token.start > cursor) {
      spans.push({ kind: 'plain', text: text.slice(cursor, token.start) })
    }
    const kind: QuickAddSpanKind =
      token.kind === 'list'
        ? 'list'
        : token.kind === 'importance'
          ? 'importance'
          : token.kind === 'duration'
            ? token.partial
              ? 'duration-partial'
              : 'duration'
            : token.partial
              ? 'date-partial'
              : 'date'
    spans.push({ kind, text: text.slice(token.start, token.end) })
    cursor = token.end
  }

  if (cursor < text.length) {
    spans.push({ kind: 'plain', text: text.slice(cursor) })
  }

  if (spans.length === 0 && text.length > 0) {
    spans.push({ kind: 'plain', text })
  }

  return spans
}

function titleFromText(text: string, tokens: RawToken[]): string {
  if (!text.trim()) return ''

  const parts: string[] = []
  let cursor = 0
  for (const token of tokens) {
    if (token.start > cursor) {
      parts.push(text.slice(cursor, token.start))
    }
    cursor = token.end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts.join('').replace(/\s+/g, ' ').trim()
}

export function parseQuickAddInput(text: string, caret: number): QuickAddParseResult {
  const metadata = collectMetadataTokens(text)
  const listToken = findListToken(text, metadata)
  const tokens = mergeNonOverlapping([...metadata, ...(listToken ? [listToken] : [])])

  const durationMin = metadata.find((t) => t.kind === 'duration' && !t.partial)?.durationMin
  const deadline = metadata.find((t) => t.kind === 'date' && !t.partial)?.deadline
  const importance = metadata.find((t) => t.kind === 'importance')?.importance
  const hashIndex = text.indexOf('#')
  const showListDropdown = hashIndex !== -1 && caret > hashIndex
  const listEnd = listToken?.end ?? text.length
  const listQuery = showListDropdown
    ? text.slice(hashIndex + 1, Math.min(caret, listEnd)).trimStart()
    : listToken
      ? text.slice(hashIndex + 1, listEnd).trim()
      : ''

  return {
    spans: buildSpans(text, tokens),
    title: titleFromText(text, tokens),
    durationMin,
    deadline,
    importance,
    listQuery,
    showListDropdown,
    hashIndex,
  }
}

export function filterTaskListsForQuery(lists: TaskList[], query: string): TaskList[] {
  const q = query.trim().toLowerCase()
  if (!q) return lists
  return lists.filter((list) => list.title.toLowerCase().includes(q))
}

export function resolveTaskListId(
  lists: TaskList[],
  listQuery: string,
  selectedListId?: string,
  inboxListId?: string
): string | undefined {
  if (selectedListId) return selectedListId
  const q = listQuery.trim().toLowerCase()
  if (!q) {
    return inboxListId ?? lists.find((list) => isInboxList(list))?.id
  }

  const exact = lists.find((list) => list.title.toLowerCase() === q)
  if (exact) return exact.id

  const starts = lists.filter((list) => list.title.toLowerCase().startsWith(q))
  if (starts.length === 1) return starts[0].id

  const includes = lists.filter((list) => list.title.toLowerCase().includes(q))
  if (includes.length === 1) return includes[0].id

  return undefined
}

export function applyListSelection(text: string, hashIndex: number, listTitle: string): string {
  const before = text.slice(0, hashIndex)
  const metadata = collectMetadataTokens(text)
  const listToken = findListToken(text, metadata)
  const afterEnd = listToken?.end ?? text.length

  const after = text.slice(afterEnd)
  const spacer = after.length > 0 && !after.startsWith(' ') ? ' ' : ''
  return `${before}#${listTitle}${spacer}${after.trimStart()}`
}
