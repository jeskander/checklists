import type { TaskList } from '../db/types'

export const INBOX_LIST_TITLE = 'Inbox'

export function isInboxList(list: Pick<TaskList, 'title'>): boolean {
  return list.title.trim().toLowerCase() === INBOX_LIST_TITLE.toLowerCase()
}
