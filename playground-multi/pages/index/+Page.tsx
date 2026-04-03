import '@/index.css'
import { useState } from 'react'
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data         = useData<Data>()
  const [user, setUser] = useState(data.user)

  async function signOut() {
    await fetch('/api/auth/sign-out', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    window.location.href = '/'
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-4xl font-bold tracking-tight">playground-multi</h1>
      <p className="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      {user ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.name}</span>
          </p>
          <div className="flex gap-2">

            <button
              onClick={signOut}
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">


        </div>
      )}

      <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
        <a href="/api/health" className="underline hover:text-foreground">API Health</a>
        <a href="/api/me" className="underline hover:text-foreground">Session Info</a>
      </div>
    </div>
  )
}
