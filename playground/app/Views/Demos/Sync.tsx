import '@/index.css'
import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

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

    ytext.observe(() => setText(ytext.toString()))
    provider.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'))
    provider.awareness.setLocalStateField('user', { name: myName, color: myColor })

    const syncUsers = () => {
      const states = [...provider.awareness.getStates().values()] as { user?: { name: string; color: string } }[]
      setUsers(states.map(s => s.user).filter((u): u is { name: string; color: string } => Boolean(u)))
    }
    provider.awareness.on('change', syncUsers)
    syncUsers()

    return () => { provider.destroy(); doc.destroy() }
  }, [myName, myColor])

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const ytext = docRef.current?.getText('content')
    if (!ytext) return
    docRef.current?.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, e.target.value)
    })
  }

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/demos" className="nav-link">← Demos</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Collaborative editor</h1>
        <p className="hero-lead">
          Yjs CRDT over @rudderjs/sync. Open this page in two tabs to see real-time updates.{' '}
          {connected ? '🟢 connected' : '⚪ connecting…'}
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <p className="form-label">Active users:</p>
        <ul style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {users.map((u, i) => (
            <li key={i} className="inline-code" style={{ borderLeft: `3px solid ${u.color}`, paddingLeft: '0.5rem' }}>
              {u.name}
            </li>
          ))}
        </ul>
        <textarea
          ref={textareaRef}
          className="form-input"
          rows={10}
          value={text}
          onChange={onChange}
          placeholder="Start typing…"
        />
      </section>
    </div>
  )
}
