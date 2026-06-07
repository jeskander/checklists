import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import './AuthPages.css'

export function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

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
    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else if (!data.session) {
      // Email confirmation is enabled — ask them to check their inbox
      setConfirmationSent(true)
      setLoading(false)
    }
    // If data.session exists, onAuthStateChange fires and the app renders automatically
  }

  if (confirmationSent) {
    return (
      <div className="auth-root">
        <div className="auth-card">
          <h1 className="auth-wordmark">Checklists</h1>
          <p className="auth-subtitle">Check your inbox</p>
          <p className="auth-success">
            We've sent a confirmation link to <strong>{email}</strong>. Click it to activate your account and sign in.
          </p>
          <div className="auth-links">
            <Link className="auth-link" to="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <h1 className="auth-wordmark">Checklists</h1>
        <p className="auth-subtitle">Create your account</p>

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

          <div className="auth-field-wrap">
            <label className="auth-label" htmlFor="password">Password</label>
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
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="auth-links">
          <Link className="auth-link" to="/login">
            Already have an account? <strong>Sign in</strong>
          </Link>
        </div>
      </div>
    </div>
  )
}
