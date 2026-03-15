import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

function getWsUrl() {
  if (typeof window === 'undefined') return ''
  return `ws://${window.location.host}/ws-live`
}

export default function Page() {
  const [connected, setConnected] = useState(false)
  const [text,      setText]      = useState('')
  const [users,     setUsers]     = useState<{ name: string; color: string }[]>([])
  const [myName]                  = useState(() => `User-${Math.floor(Math.random() * 1000)}`)
  const [myColor]                 = useState(() => `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`)

  const docRef      = useRef<Y.Doc | null>(null)
  const provRef     = useRef<WebsocketProvider | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const doc      = new Y.Doc()
    const ytext    = doc.getText('content')
    const provider = new WebsocketProvider(getWsUrl(), 'live-demo', doc)

    docRef.current  = doc
    provRef.current = provider

    // Sync shared text → local state
    ytext.observe(() => {
      setText(ytext.toString())
    })

    // Connection status
    provider.on('status', ({ status }: { status: string }) => {
      setConnected(status === 'connected')
    })

    // Awareness — who is online
    provider.awareness.setLocalStateField('user', { name: myName, color: myColor })

    const syncUsers = () => {
      const states = [...provider.awareness.getStates().values()] as { user?: { name: string; color: string } }[]
      setUsers(states.flatMap(s => s.user ? [s.user] : []))
    }

    // Show local user immediately (don't wait for server echo)
    syncUsers()



    
    provider.awareness.on('change', syncUsers)

    return () => {
      provider.destroy()
      doc.destroy()
      docRef.current  = null
      provRef.current = null
    }
  }, [myName, myColor])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const doc   = docRef.current
    if (!doc) return
    const ytext = doc.getText('content')
    const next  = e.target.value
    const prev  = ytext.toString()

    // Simple diff — replace entire content on change
    // A real editor would use cursor-aware delta ops
    doc.transact(() => {
      ytext.delete(0, prev.length)
      ytext.insert(0, next)
    })
  }

  return (
    <div className="min-h-svh bg-background flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Live Demo</h1>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${connected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          You: <span className="font-medium" style={{ color: myColor }}>{myName}</span>
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 65px)' }}>
        {/* Editor */}
        <div className="flex-1 flex flex-col p-6 gap-3">
          <p className="text-xs text-muted-foreground">
            Open this page in another tab — edits sync in real-time via Yjs CRDT.
          </p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            disabled={!connected}
            placeholder="Start typing… changes sync instantly across all connected clients."
            className="flex-1 w-full px-4 py-3 rounded-xl border bg-background text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 font-mono"
          />
          <p className="text-xs text-muted-foreground text-right">
            {text.length} characters · powered by <span className="font-medium">@boostkit/live</span> + Yjs
          </p>
        </div>

        {/* Online sidebar */}
        <div className="w-52 border-l flex flex-col shrink-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <span className="text-sm font-medium">Online</span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{users.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {users.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No one here yet</p>
            ) : users.map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted/50">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: u.color }} />
                <span className="truncate">{u.name}</span>
              </div>
            ))}
          </div>
          <div className="border-t p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Awareness tracks who is connected via Yjs presence protocol.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
