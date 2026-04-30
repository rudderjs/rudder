import '@/index.css'
import { useState } from 'react'
import { navigate } from 'vike/client/router'

// URL this view is served at — MUST match the controller route registered
// by registerAuthRoutes() in the consumer project. If you override
// `opts.paths.login` when calling registerAuthRoutes, update this too so
// Vike's client router can SPA-navigate here instead of full-reloading.
export const route = '/login'

export interface LoginProps {
  submitUrl?:        string
  registerUrl?:      string
  forgotPasswordUrl?: string
  homeUrl?:          string
}

export default function Login(props: LoginProps) {
  const submitUrl         = props.submitUrl         ?? '/api/auth/sign-in/email'
  const registerUrl       = props.registerUrl       ?? '/register'
  const forgotPasswordUrl = props.forgotPasswordUrl ?? '/forgot-password'
  const homeUrl           = props.homeUrl           ?? '/'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch(submitUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    })
    if (res.ok) {
      const params = new URLSearchParams(window.location.search)
      const redirect = params.get('redirect')
      await navigate(redirect && redirect.startsWith('/') ? redirect : homeUrl)
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string }
      setError(body.message ?? 'Invalid email or password.')
    }
    setLoading(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-head">
          <h1 className="heading-lg">Welcome back</h1>
          <p className="muted">Sign in to your account</p>
        </div>
        <form onSubmit={handleSubmit} className="form-card">
          {error && <p className="form-error">{error}</p>}
          <div>
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.currentTarget.value)}
              required autoComplete="email"
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.currentTarget.value)}
              required autoComplete="current-password"
              className="form-input"
            />
          </div>
          <button type="submit" disabled={loading} className="form-submit">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="form-link-row">
            <a href={forgotPasswordUrl} className="auth-link">Forgot password?</a>
            <a href={registerUrl} className="auth-link">Register</a>
          </div>
        </form>
      </div>
    </div>
  )
}
