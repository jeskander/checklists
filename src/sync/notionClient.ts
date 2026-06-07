import { Client } from '@notionhq/client'

const token = import.meta.env.VITE_NOTION_TOKEN as string | undefined
const NOTION_VERSION = '2022-06-28'

export function hasNotionConfig(): boolean {
  return Boolean(token?.length)
}

/** Same-origin proxy — Notion blocks direct browser requests to api.notion.com. */
export function getNotionProxyBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/notion`
  }
  return 'https://api.notion.com'
}

export function getNotionClient(): Client | null {
  if (!token) return null
  return new Client({ auth: token, baseUrl: getNotionProxyBase() })
}

export const NOTION_DS = {
  templates: import.meta.env.VITE_NOTION_TEMPLATES_DB as string | undefined,
  templateItems: import.meta.env.VITE_NOTION_TEMPLATE_ITEMS_DB as string | undefined,
  days: import.meta.env.VITE_NOTION_DAYS_DB as string | undefined,
  dayInstances: import.meta.env.VITE_NOTION_DAY_INSTANCES_DB as string | undefined,
  dayInstanceItems: import.meta.env.VITE_NOTION_DAY_INSTANCE_ITEMS_DB as string | undefined,
}

export function hasFullNotionSchema(): boolean {
  return Object.values(NOTION_DS).every(Boolean)
}

type NotionListResponse<T> = {
  results: T[]
  has_more: boolean
  next_cursor: string | null
}

/** SDK v5 dropped databases.query; the REST endpoint still works via our proxy. */
export async function queryNotionDatabase<T = unknown>(
  databaseId: string,
  startCursor?: string
): Promise<NotionListResponse<T>> {
  if (!token) throw new Error('No Notion token configured')

  const res = await fetch(`${getNotionProxyBase()}/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(startCursor ? { start_cursor: startCursor } : {}),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(err?.message ?? `Notion query failed (${res.status})`)
  }

  return res.json() as Promise<NotionListResponse<T>>
}
