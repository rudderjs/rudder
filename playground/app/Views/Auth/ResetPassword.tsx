import '@/index.css'
import { useState, useEffect } from 'react'

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
      <div className="flex min-h-svh items-center justify-center p-4">
        <div className="text-sm text-gray-500">Loading...</div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-4 rounded-lg border p-6 shadow-sm">
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">Missing reset token.</p>
            <p className="text-center text-sm text-gray-500">
              <a href={forgotPasswordUrl} className="underline hover:text-black">Request a new reset link</a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Reset password</h1>
          <p className="text-sm text-gray-500 mt-1">Enter your new password</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-6 shadow-sm">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && (
            <div className="space-y-2">
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-600">{success}</p>
              <p className="text-center text-sm text-gray-500">
                <a href={loginUrl} className="underline hover:text-black">Sign in</a>
              </p>
            </div>
          )}
          {!success && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="password">New password</label>
                <input
                  id="password" type="password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.currentTarget.value)}
                  required minLength={8} autoComplete="new-password"
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password" type="password" placeholder="••••••••"
                  value={confirmPassword} onChange={e => setConfirm(e.currentTarget.value)}
                  required minLength={8} autoComplete="new-password"
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
                {loading ? 'Resetting...' : 'Reset password'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
