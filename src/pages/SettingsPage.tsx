import { useTheme, type Theme } from '../context/ThemeContext'
import { supabase } from '../lib/supabaseClient'
import './SettingsPage.css'

export function SettingsPage() {
  const { theme, setTheme } = useTheme()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
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
        <h2 className="section-label">Account</h2>
        <p className="settings-hint">
          Changes save instantly on this device and sync to the cloud when you&apos;re online.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void handleSignOut()}
        >
          Sign out
        </button>
      </section>
    </>
  )
}
