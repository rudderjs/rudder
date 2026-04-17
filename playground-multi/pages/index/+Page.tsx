import '@/index.css'
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const { user } = useData<Data>()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-4xl font-bold tracking-tight">playground-multi</h1>
      <p className="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      <p className="text-sm text-muted-foreground">
        {user
          ? <>Signed in as <span className="font-medium text-foreground">{user.name}</span></>
          : 'No session.'}
      </p>

      <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
        <a href="/api/health" className="underline hover:text-foreground">API Health</a>
        <a href="/api/me" className="underline hover:text-foreground">Session Info</a>
        <a href="/vue-demo" className="underline hover:text-foreground">Vue demo</a>
        <a href="/solid-demo" className="underline hover:text-foreground">Solid demo</a>
      </div>
    </div>
  )
}
