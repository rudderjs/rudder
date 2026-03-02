import '@/index.css'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'

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
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">

        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Create an account</h1>
          <p className="text-sm text-muted-foreground mt-1">Get started in seconds</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle className="text-base">Register</CardTitle>
              <CardDescription>Fill in your details to create an account</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="name">Name</label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Alice Smith"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="email">Email</label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="password">Password</label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Already have an account?{' '}
                <a href="/login" className="underline underline-offset-4 hover:text-foreground">
                  Sign in
                </a>
              </p>
            </CardFooter>
          </form>
        </Card>

      </div>
    </div>
  )
}
