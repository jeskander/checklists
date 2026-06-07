import { useEffect, useRef } from 'react'
import { hasFullNotionSchema, hasNotionConfig } from './notionClient'
import { runSync } from './syncEngine'

const VISIBILITY_SYNC_MIN_MS = 60_000

/** Pull from Notion on load; re-sync when returning to tab (throttled). */
export function NotionSync() {
  const lastSyncAt = useRef(0)
  const started = useRef(false)

  useEffect(() => {
    if (!hasNotionConfig() || !hasFullNotionSchema()) return

    const trigger = () => {
      lastSyncAt.current = Date.now()
      void runSync()
    }

    if (!started.current) {
      started.current = true
      trigger()
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastSyncAt.current < VISIBILITY_SYNC_MIN_MS) return
      trigger()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return null
}
