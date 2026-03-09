import '@/index.css'
import { useState } from 'react'

export default function RegisterPage() {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch('/api/auth/sign-up/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password }),
    })
    if (res.ok) {
      window.location.href = '/'
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string }
      setError(body.message ?? 'Could not create account. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create an account</h1>
          <p className="text-sm text-gray-500 mt-1">Get started in seconds</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-6 shadow-sm">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="name">Name</label>
            <input
              id="name" type="text" placeholder="Alice Smith"
              value={name} onChange={e => setName(e.target.value)}
              required autoComplete="name"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
            <input
              id="email" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="password">Password</label>
            <input
              id="password" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="new-password" minLength={8}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <button type="submit" disabled={loading}
            className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <a href="/login" className="underline hover:text-black">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
