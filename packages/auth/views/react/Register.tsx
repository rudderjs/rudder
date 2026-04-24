import '@/index.css'
import { useState } from 'react'
import { navigate } from 'vike/client/router'

// URL this view is served at — see Login.tsx for rationale.
export const route = '/register'

export interface RegisterProps {
  submitUrl?: string
  loginUrl?:  string
  homeUrl?:   string
}

export default function Register(props: RegisterProps) {
  const submitUrl = props.submitUrl ?? '/api/auth/sign-up/email'
  const loginUrl  = props.loginUrl  ?? '/login'
  const homeUrl   = props.homeUrl   ?? '/'

  const [name, setName]         = useState('')
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
      body:    JSON.stringify({ name, email, password }),
    })
    if (res.ok) {
      await navigate(homeUrl)
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string }
      setError(body.message ?? 'Could not create account. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-head">
          <h1 className="heading-lg">Create an account</h1>
          <p className="muted">Get started in seconds</p>
        </div>
        <form onSubmit={handleSubmit} className="form-card">
          {error && <p className="form-error">{error}</p>}
          <div>
            <label className="form-label" htmlFor="name">Name</label>
            <input
              id="name" type="text" placeholder="Alice Smith"
              value={name} onChange={e => setName(e.currentTarget.value)}
              required autoComplete="name"
              className="form-input"
            />
          </div>
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
              required autoComplete="new-password" minLength={8}
              className="form-input"
            />
          </div>
          <button type="submit" disabled={loading} className="form-submit">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
          <p className="auth-head muted">
            Already have an account?{' '}
            <a href={loginUrl} className="auth-link">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
