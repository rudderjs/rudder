import { useState } from 'react'
import { useData } from 'vike-react/useData'
import { Button } from '@/components/ui/button'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()
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
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">{data.title}</h1>
      <p className="text-muted-foreground">{data.message}</p>

      {user ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.name}</span>{' '}
            <span className="text-xs">({user.email})</span>
          </p>
          <div className="flex gap-2">
            <a href="/todos"><Button>View Todos</Button></a>
            <a href="/contact"><Button variant="outline">Contact demo</Button></a>
            <Button variant="outline" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <a href="/todos"><Button>View Todos</Button></a>
          <a href="/contact"><Button variant="outline">Contact demo</Button></a>
          <a href="/login"><Button variant="outline">Sign in</Button></a>
          <a href="/register"><Button variant="outline">Register</Button></a>
        </div>
      )}
    </div>
  )
}
