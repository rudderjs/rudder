import '@/index.css'
import { createSignal } from 'solid-js'

export default function RegisterPage() {
  const [name, setName]         = createSignal('')
  const [email, setEmail]       = createSignal('')
  const [password, setPassword] = createSignal('')
  const [error, setError]       = createSignal('')
  const [loading, setLoading]   = createSignal(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await fetch('/api/auth/sign-up/email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name(), email: email(), password: password() }),
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
    <div class="flex min-h-svh items-center justify-center p-4">
      <div class="w-full max-w-sm space-y-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold">Create an account</h1>
          <p class="text-sm text-gray-500 mt-1">Get started in seconds</p>
        </div>
        <form onSubmit={handleSubmit} class="space-y-4 rounded-lg border p-6 shadow-sm">
          {error() && <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error()}</p>}
          <div>
            <label class="block text-sm font-medium mb-1" for="name">Name</label>
            <input id="name" type="text" placeholder="Alice Smith"
              value={name()} onInput={e => setName(e.currentTarget.value)}
              required autocomplete="name"
              class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
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
              required autocomplete="new-password" minLength={8}
              class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <button type="submit" disabled={loading()}
            class="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
            {loading() ? 'Creating account…' : 'Create account'}
          </button>
          <p class="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <a href="/login" class="underline hover:text-black">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
