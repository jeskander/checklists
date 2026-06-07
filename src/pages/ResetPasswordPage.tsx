import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import './AuthPages.css'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success, USER_UPDATED fires → isRecovery clears → app renders
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <h1 className="auth-wordmark">Checklists</h1>
        <p className="auth-subtitle">Set a new password</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field-wrap">
            <label className="auth-label" htmlFor="password">New password</label>
            <input
              id="password"
              className="field"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="auth-field-wrap">
            <label className="auth-label" htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              className="field"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
