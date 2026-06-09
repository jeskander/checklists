import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../context/AuthContext'
import { useTheme, type Theme } from '../context/ThemeContext'
import { db } from '../db/database'
import { supabase } from '../lib/supabaseClient'
import { resetLocalFromCloud, runSync, subscribeSyncStatus } from '../sync/syncEngine'
import './SettingsPage.css'

function formatLastSynced(ts?: number): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { session } = useAuth()
  const [syncStatus, setSyncStatus] = useState({ busy: false, message: '', online: true })

  const syncMeta = useLiveQuery(() => db.syncMeta.get('main'), [])
  const pendingCount = useLiveQuery(() => db.syncQueue.count(), []) ?? 0

  useEffect(() => subscribeSyncStatus(setSyncStatus), [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const handleSyncNow = () => {
    void runSync({ fullPull: true })
  }

  const handleResetFromCloud = () => {
    if (
      !window.confirm(
        'Clear all local data on this device and re-download from the cloud? Any failed uploads on this device will be discarded.'
      )
    ) {
      return
    }
    void resetLocalFromCloud()
  }

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
        <p>Personal preferences</p>
      </header>

      <section className="settings-section">
        <h2 className="section-label">Appearance</h2>
        <div className="theme-toggle">
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${theme === t ? ' active' : ''}`}
              onClick={() => setTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {session && (
        <section className="settings-section">
          <h2 className="section-label">Sync</h2>
          <p className="settings-hint">
            This app requires an internet connection. Your data is stored in the cloud and
            cached locally for speed. On each visit the app downloads a fresh copy from the cloud.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncStatus.busy || !syncStatus.online}
            onClick={handleSyncNow}
          >
            {syncStatus.busy ? 'Syncing…' : 'Sync now'}
          </button>
          <p className="sync-status">
            {syncStatus.message ||
              (syncStatus.online ? 'Up to date' : 'Offline — connect to save changes')}
          </p>
          <p className="sync-status">
            Last synced: {formatLastSynced(syncMeta?.lastPushAt)}
          </p>
          {pendingCount > 0 && (
            <p className="sync-status sync-status-warn">
              {pendingCount} change{pendingCount === 1 ? '' : 's'} failed to upload — tap Sync now to retry
            </p>
          )}
          <div className="settings-danger-zone">
            <p className="settings-hint">
              If this device looks wrong or stuck, reset local cache and download a fresh copy
              from the cloud.
            </p>
            <button
              type="button"
              className="btn btn-ghost settings-danger-btn"
              disabled={syncStatus.busy || !syncStatus.online}
              onClick={handleResetFromCloud}
            >
              {syncStatus.busy ? 'Resetting…' : 'Reset from cloud'}
            </button>
          </div>
        </section>
      )}

      <section className="settings-section">
        <h2 className="section-label">Account</h2>
        {!session && (
          <p className="settings-hint">
            Sign in to sync changes across devices.
          </p>
        )}
        {session && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        )}
      </section>
    </>
  )
}
