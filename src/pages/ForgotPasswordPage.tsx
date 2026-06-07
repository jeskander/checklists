import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import './AuthPages.css'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <h1 className="auth-wordmark">Checklists</h1>
        <p className="auth-subtitle">Reset your password</p>

        {sent ? (
          <>
            <p className="auth-success">
              Check your inbox — we've sent a password reset link to <strong>{email}</strong>.
            </p>
            <div className="auth-links">
              <Link className="auth-link" to="/login">Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="auth-field-wrap">
                <label className="auth-label" htmlFor="email">Email</label>
                <input
                  id="email"
                  className="field"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>

              {error && <p className="auth-error">{error}</p>}

              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <div className="auth-links">
              <Link className="auth-link" to="/login">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
