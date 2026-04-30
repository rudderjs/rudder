import '@/index.css'
import { useState } from 'react'

// URL this view is served at — see Login.tsx for rationale.
export const route = '/forgot-password'

export interface ForgotPasswordProps {
  submitUrl?:       string
  loginUrl?:        string
  resetPasswordUrl?: string
}

export default function ForgotPassword(props: ForgotPasswordProps) {
  const submitUrl       = props.submitUrl       ?? '/api/auth/request-password-reset'
  const loginUrl        = props.loginUrl        ?? '/login'
  const resetPasswordUrl = props.resetPasswordUrl ?? '/reset-password'

  const [email, setEmail]     = useState('')
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const res = await fetch(submitUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, redirectTo: resetPasswordUrl }),
      })
      if (res.ok) {
        setSuccess('If an account exists with that email, a password reset link has been sent.')
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string }
        setError(body.message ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-head">
          <h1 className="heading-lg">Forgot password</h1>
          <p className="muted">Enter your email to receive a reset link</p>
        </div>
        <form onSubmit={handleSubmit} className="form-card">
          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}
          <div>
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.currentTarget.value)}
              required autoComplete="email"
              className="form-input"
            />
          </div>
          <button type="submit" disabled={loading} className="form-submit">
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
          <p className="auth-head muted">
            Remember your password?{' '}
            <a href={loginUrl} className="auth-link">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
