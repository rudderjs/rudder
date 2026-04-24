import '@/index.css'
import { useState, useEffect } from 'react'

// URL this view is served at — see Login.tsx for rationale.
export const route = '/reset-password'

export interface ResetPasswordProps {
  submitUrl?:        string
  loginUrl?:         string
  forgotPasswordUrl?: string
}

export default function ResetPassword(props: ResetPasswordProps) {
  const submitUrl        = props.submitUrl        ?? '/api/auth/reset-password'
  const loginUrl         = props.loginUrl         ?? '/login'
  const forgotPasswordUrl = props.forgotPasswordUrl ?? '/forgot-password'

  const [password, setPassword]       = useState('')
  const [confirmPassword, setConfirm] = useState('')
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState('')
  const [loading, setLoading]         = useState(false)
  const [token, setToken]             = useState<string | null>(null)
  const [email, setEmail]             = useState<string | null>(null)
  const [mounted, setMounted]         = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setToken(params.get('token'))
    setEmail(params.get('email'))
    setMounted(true)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(submitUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, email, newPassword: password }),
      })
      if (res.ok) {
        setSuccess('Your password has been reset successfully.')
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string }
        setError(body.message ?? 'Invalid or expired token.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  if (!mounted) {
    return (
      <div className="auth-wrap">
        <div className="muted">Loading...</div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="form-card">
            <p className="form-error">Missing reset token.</p>
            <p className="auth-head muted">
              <a href={forgotPasswordUrl} className="auth-link">Request a new reset link</a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-head">
          <h1 className="heading-lg">Reset password</h1>
          <p className="muted">Enter your new password</p>
        </div>
        <form onSubmit={handleSubmit} className="form-card">
          {error && <p className="form-error">{error}</p>}
          {success && (
            <>
              <p className="form-success">{success}</p>
              <p className="auth-head muted">
                <a href={loginUrl} className="auth-link">Sign in</a>
              </p>
            </>
          )}
          {!success && (
            <>
              <div>
                <label className="form-label" htmlFor="password">New password</label>
                <input
                  id="password" type="password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.currentTarget.value)}
                  required minLength={8} autoComplete="new-password"
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password" type="password" placeholder="••••••••"
                  value={confirmPassword} onChange={e => setConfirm(e.currentTarget.value)}
                  required minLength={8} autoComplete="new-password"
                  className="form-input"
                />
              </div>
              <button type="submit" disabled={loading} className="form-submit">
                {loading ? 'Resetting...' : 'Reset password'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
