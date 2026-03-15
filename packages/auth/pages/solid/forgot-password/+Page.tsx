import '@/index.css'
import { createSignal } from 'solid-js'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = createSignal('')
  const [error, setError]     = createSignal('')
  const [success, setSuccess] = createSignal('')
  const [loading, setLoading] = createSignal(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email(), redirectTo: '/reset-password' }),
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
    <div class="flex min-h-svh items-center justify-center p-4">
      <div class="w-full max-w-sm space-y-6">
        <div class="text-center">
          <h1 class="text-2xl font-bold">Forgot password</h1>
          <p class="text-sm text-gray-500 mt-1">Enter your email to receive a reset link</p>
        </div>
        <form onSubmit={handleSubmit} class="space-y-4 rounded-lg border p-6 shadow-sm">
          {error() && <p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error()}</p>}
          {success() && <p class="rounded-md bg-green-50 px-3 py-2 text-sm text-green-600">{success()}</p>}
          <div>
            <label class="block text-sm font-medium mb-1" for="email">Email</label>
            <input id="email" type="email" placeholder="you@example.com"
              value={email()} onInput={e => setEmail(e.currentTarget.value)}
              required autocomplete="email"
              class="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black" />
          </div>
          <button type="submit" disabled={loading()}
            class="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50">
            {loading() ? 'Sending...' : 'Send reset link'}
          </button>
          <p class="text-center text-sm text-gray-500">
            Remember your password?{' '}
            <a href="/login" class="underline hover:text-black">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  )
}
