import { useEffect, useState } from 'react'
import { useTheme, type Theme } from '../context/ThemeContext'
import { hasFullNotionSchema, hasNotionConfig } from '../sync/notionClient'
import { runSync, subscribeSyncStatus } from '../sync/syncEngine'
import './SettingsPage.css'

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)

  const notionReady = hasNotionConfig() && hasFullNotionSchema()

  useEffect(() => subscribeSyncStatus(({ busy, message }) => {
    setSyncBusy(busy)
    if (message) setSyncStatus(message)
  }), [])

  const handleSync = async () => {
    const result = await runSync()
    if (!syncBusy) setSyncStatus(result.message)
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

      <section className="settings-section">
        <h2 className="section-label">Notion</h2>
        <p className="settings-hint">
          {notionReady
            ? 'Notion is the source of truth. The app syncs on load, when you return to the tab, and after edits.'
            : 'Add VITE_NOTION_TOKEN and database IDs to .env.local, then rebuild.'}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!notionReady || syncBusy}
          onClick={() => void handleSync()}
        >
          {syncBusy ? 'Syncing…' : 'Sync now'}
        </button>
        {syncStatus && <p className="sync-status">{syncStatus}</p>}
      </section>
    </>
  )
}
