import type { TaskImportance, TaskList, TaskListItem } from '../db/types'
import { askClaude, hasAnthropicConfig, parseJsonFromClaude } from '../lib/anthropicClient'
import { INBOX_LIST_TITLE } from '../lib/inbox'
import { parseQuickAddInput, resolveTaskListId } from '../lib/quickAddTask'
import { addTaskListItem } from './taskLists'

export type DictationTaskParsed = {
  title: string
  durationMin?: number | null
  deadline?: string | null
  importance?: TaskImportance | null
  listName?: string | null
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildSystemPrompt(lists: TaskList[]): string {
  const listNames = lists.map((l) => l.title).join(', ')
  return `You parse spoken task dictation into structured task fields for a personal task app.

Today's date: ${todayIso()} (YYYY-MM-DD).

Available task lists: ${listNames || 'Inbox only'}.
Default list when none mentioned: ${INBOX_LIST_TITLE}.

Rules:
- title: required, concise task name only (no dates/times/lists/priority).
- durationMin: total minutes if a duration is mentioned (e.g. "90 minutes", "an hour", "19:00" as 1140 min, "half an hour" = 30). null if not mentioned.
- deadline: YYYY-MM-DD if a due date is mentioned ("tomorrow", "next Monday", "1st of July", "15/06/2026"). null if not mentioned. Assume current year when year omitted.
- importance: integer 1-4 if priority mentioned (*1 or "urgent" = 1, highest = 1, lowest = 4). null if not mentioned.
- listName: exact name from available lists if user mentions a list/context (e.g. "work list", "laptop at home"). null → Inbox.

Reply with JSON only, no markdown:
{"title":"...","durationMin":null,"deadline":null,"importance":null,"listName":null}`
}

function normalizeParsed(raw: DictationTaskParsed): DictationTaskParsed {
  const importance = raw.importance
  const validImportance =
    importance === 1 || importance === 2 || importance === 3 || importance === 4
      ? importance
      : null

  return {
    title: raw.title?.trim() ?? '',
    durationMin:
      typeof raw.durationMin === 'number' && raw.durationMin > 0 ? Math.round(raw.durationMin) : null,
    deadline: raw.deadline?.match(/^\d{4}-\d{2}-\d{2}$/) ? raw.deadline : null,
    importance: validImportance,
    listName: raw.listName?.trim() || null,
  }
}

export async function parseDictationWithClaude(
  transcript: string,
  lists: TaskList[]
): Promise<DictationTaskParsed> {
  const raw = await askClaude(buildSystemPrompt(lists), [
    { role: 'user', content: transcript.trim() },
  ])
  return normalizeParsed(parseJsonFromClaude<DictationTaskParsed>(raw))
}

function parsedFromLocalQuickAdd(transcript: string): DictationTaskParsed {
  const parsed = parseQuickAddInput(transcript, transcript.length)
  return {
    title: parsed.title,
    durationMin: parsed.durationMin ?? null,
    deadline: parsed.deadline ?? null,
    importance: parsed.importance ?? null,
    listName: parsed.listQuery.trim() || null,
  }
}

export async function createTaskFromDictation(
  transcript: string,
  lists: TaskList[],
  inboxListId?: string
): Promise<{ item: TaskListItem; listTitle: string }> {
  const trimmed = transcript.trim()
  if (!trimmed) throw new Error('No speech detected')

  let parsed: DictationTaskParsed
  if (hasAnthropicConfig()) {
    try {
      parsed = await parseDictationWithClaude(trimmed, lists)
    } catch {
      parsed = parsedFromLocalQuickAdd(trimmed)
    }
  } else {
    parsed = parsedFromLocalQuickAdd(trimmed)
  }

  if (!parsed.title) {
    throw new Error('Could not understand task name')
  }

  const taskListId = resolveTaskListId(
    lists,
    parsed.listName ?? '',
    undefined,
    inboxListId
  )
  if (!taskListId) {
    throw new Error('Could not match a task list')
  }

  const item = await addTaskListItem(
    taskListId,
    parsed.title,
    parsed.importance ?? 2,
    parsed.durationMin ?? 15,
    parsed.deadline ?? undefined
  )

  const listTitle = lists.find((l) => l.id === taskListId)?.title ?? INBOX_LIST_TITLE
  return { item, listTitle }
}

export { hasAnthropicConfig }
