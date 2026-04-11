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
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Forgot password</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your email to receive a reset link</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-6 shadow-sm">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-600">{success}</p>}
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
            <input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.currentTarget.value)}
              required autoComplete="email"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <button type="submit" disabled={loading}
            className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
          <p className="text-center text-sm text-gray-500">
            Remember your password?{' '}
            <a href={loginUrl} className="underline hover:text-black">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
