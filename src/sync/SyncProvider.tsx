import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { bootstrapSync, queueSync, runSync, setSyncOnline } from './syncEngine'

const VISIBILITY_SYNC_MIN_MS = 60_000

const REALTIME_TABLES = [
  'library_blocks',
  'block_items',
  'days',
  'day_instances',
  'day_free_times',
  'day_instance_items',
] as const

/** Bootstrap pull on login; push/pull on reconnect and tab focus. */
export function SyncProvider() {
  const { session } = useAuth()
  const lastSyncAt = useRef(0)
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (!session) {
      bootstrapped.current = false
      return
    }

    if (!bootstrapped.current) {
      bootstrapped.current = true
      void bootstrapSync()
    }
  }, [session])

  useEffect(() => {
    const onOnline = () => {
      setSyncOnline(true)
      queueSync()
    }
    const onOffline = () => setSyncOnline(false)

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    setSyncOnline(navigator.onLine)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!session) return

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastSyncAt.current < VISIBILITY_SYNC_MIN_MS) return
      lastSyncAt.current = Date.now()
      void runSync()
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [session])

  useEffect(() => {
    if (!session) return

    const channel = supabase.channel(`sync-${session.user.id}`)

    for (const table of REALTIME_TABLES) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table },
        () => queueSync()
      )
    }

    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session])

  return null
}
