import '@/index.css'
import { createSignal } from 'solid-js'

export default function LoginPage() {
  const [email, setEmail]       = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError]       = createSignal('')
  const [loading, setLoading]   = createSignal(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch('/api/auth/sign-in/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email(), password: password() }),
    })
    if (res.ok) {
      window.location.href = '/'
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string }
      setError(body.message ?? 'Invalid email or password.')
    }
    setLoading(false)
  }

  return (
    <div class="flex min-h-svh items-center justify-center p-4">
      <div class="w-full max-w-sm space-y-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold">Welcome back</h1>
          <p class="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>
        <form onSubmit={handleSubmit} class="space-y-4 rounded-lg border p-6 shadow-sm">
          {error() && <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error()}</p>}
          <div>
            <label class="block text-sm font-medium mb-1" for="email">Email</label>
            <input id="email" type="email" placeholder="you@example.com"
              value={email()} onInput={e => setEmail(e.currentTarget.value)}
              required autocomplete="email"
              class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1" for="password">Password</label>
            <input id="password" type="password" placeholder="••••••••"
              value={password()} onInput={e => setPassword(e.currentTarget.value)}
              required autocomplete="current-password"
              class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <button type="submit" disabled={loading()}
            class="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
            {loading() ? 'Signing in…' : 'Sign in'}
          </button>
          <p class="text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <a href="/register" class="underline hover:text-black">Register</a>
          </p>
        </form>
      </div>
    </div>
  )
}
