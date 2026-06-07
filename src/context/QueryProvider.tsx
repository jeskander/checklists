import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useAuth } from './AuthContext'
import { clearLocalStore } from '../db/clearLocalStore'
import { SyncProvider } from '../sync/SyncProvider'

/** Clears local data on sign-out; mounts sync engine when signed in. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const prevSessionRef = useRef<typeof session>(undefined)

  useEffect(() => {
    if (loading) return
    const prev = prevSessionRef.current
    prevSessionRef.current = session
    if (prev && !session) {
      void clearLocalStore()
    }
  }, [session, loading])

  return (
    <>
      {session ? <SyncProvider /> : null}
      {children}
    </>
  )
}
