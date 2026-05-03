import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import '@/index.css'

function getWsUrl() {
  if (typeof window === 'undefined') return ''
  return `ws://${window.location.host}/ws-sync`
}

export default function SyncDemo() {
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
    const provider = new WebsocketProvider(getWsUrl(), 'sync-demo', doc)

    docRef.current  = doc
    provRef.current = provider

    ytext.observe(() => {
      setText(ytext.toString())
    })

    provider.on('status', ({ status }: { status: string }) => {
      setConnected(status === 'connected')
    })

    provider.awareness.setLocalStateField('user', { name: myName, color: myColor })

    const syncUsers = () => {
      const states = [...provider.awareness.getStates().values()] as { user?: { name: string; color: string } }[]
      setUsers(states.flatMap(s => s.user ? [s.user] : []))
    }

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
    const doc = docRef.current
    if (!doc) return
    const ytext = doc.getText('content')
    const next  = e.target.value
    const prev  = ytext.toString()

    doc.transact(() => {
      ytext.delete(0, prev.length)
      ytext.insert(0, next)
    })
  }

  return (
    <div className="split-frame">
      <div className="split-toolbar">
        <div className="split-toolbar-title">
          <h1 className="split-toolbar-heading">Sync Demo</h1>
          <span className={`status-pill ${connected ? 'status-pill-on' : 'status-pill-off'}`}>
            <span className={`status-dot ${connected ? 'status-dot-on' : 'status-dot-off'}`} />
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>
        <span className="split-toolbar-meta">
          You: <span style={{ color: myColor, fontWeight: 500 }}>{myName}</span>
        </span>
      </div>

      <div className="split-body">
        <div className="collab-pane">
          <p className="collab-meta">
            Open this page in another tab — edits sync in real-time via Yjs CRDT. Rendered from{' '}
            <code className="inline-code">app/Views/Demos/Sync.tsx</code> via{' '}
            <code className="inline-code">view('demos.sync')</code>.
          </p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            disabled={!connected}
            placeholder="Start typing… changes sync instantly across all connected clients."
            className="collab-textarea"
          />
          <p className="collab-meta" style={{ textAlign: 'right' }}>
            {text.length} characters · powered by{' '}
            <span style={{ fontWeight: 500 }}>@rudderjs/sync</span> + Yjs
          </p>
        </div>

        <aside className="split-sidebar">
          <div className="split-sidebar-header">
            <span className="sidebar-title">Online</span>
            <span className="member-count">{users.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
            {users.length === 0 ? (
              <p className="sidebar-empty">No one here yet</p>
            ) : users.map((u, i) => (
              <div key={i} className="member-row">
                <span className="member-dot" style={{ backgroundColor: u.color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
              </div>
            ))}
          </div>
          <div className="split-sidebar-footer">
            <p className="sidebar-note">
              Awareness tracks who is connected via Yjs presence protocol.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
