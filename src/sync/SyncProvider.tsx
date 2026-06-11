import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { handleRemoteDelete } from './remoteDelete'
import {
  bootstrapSync,
  flushPendingPush,
  queuePull,
  resetBootstrapState,
  runSync,
  setSyncOnline,
} from './syncEngine'

const VISIBILITY_SYNC_MIN_MS = 30_000

const REALTIME_TABLES = [
  'library_blocks',
  'block_items',
  'days',
  'day_instances',
  'day_free_times',
  'day_instance_items',
] as const

/** Online-first: full cloud load on login; live pull on remote changes. */
export function SyncProvider() {
  const { session } = useAuth()
  const lastSyncAt = useRef(0)
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (!session) {
      bootstrapped.current = false
      resetBootstrapState()
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

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingPush()
        return
      }
      if (Date.now() - lastSyncAt.current < VISIBILITY_SYNC_MIN_MS) return
      lastSyncAt.current = Date.now()
      void runSync({ fullPull: true, pullOnly: true })
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [session])

  useEffect(() => {
    if (!session) return

    const channel = supabase.channel(`sync-${session.user.id}`)

    for (const table of REALTIME_TABLES) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'DELETE', schema: 'public', table },
        (payload: { old: Record<string, unknown> }) => {
          void handleRemoteDelete(table, payload.old ?? {})
        }
      )
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table },
        () => queuePull()
      )
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table },
        () => queuePull()
      )
    }

    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [session])

  return null
}
