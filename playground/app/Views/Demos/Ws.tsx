import '@/index.css'
import { useEffect, useRef, useState } from 'react'
import { RudderSocket } from '@/RudderSocket'

type Message = { user: string; text: string; ts: number }
type Member  = { id: string; name: string }

function getWsUrl() {
  if (typeof window === 'undefined') return ''
  return `ws://${window.location.host}/ws`
}

export default function WsDemo() {
  const [me, setMe]               = useState('')
  const socketRef                 = useRef<RudderSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [members,   setMembers]   = useState<Member[]>([])
  const [input,     setInput]     = useState('')

  useEffect(() => { setMe(`User-${Math.floor(Math.random() * 1000)}`) }, [])

  useEffect(() => {
    if (!me) return
    const socket = new RudderSocket(getWsUrl())
    socketRef.current = socket

    const chat = socket.channel('chat')
    chat.on('message', d => setMessages(prev => [...prev, d as Message]))

    const room = socket.presence('lobby', 'demo-token')
    room.on('presence.members', d => {
      setMembers(d as Member[])
      setConnected(true)
    })
    room.on('presence.joined', d => {
      const u = d as Member
      setMembers(prev => [...prev.filter(m => m.id !== u.id), u])
    })
    room.on('presence.left', d => {
      const id = (d as { id: string }).id
      setMembers(prev => prev.filter(m => m.id !== id))
    })

    return () => { socket.disconnect() }
  }, [me])

  async function send() {
    if (!input.trim()) return
    await fetch('/api/ws/broadcast', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user: me, text: input.trim() }),
    })
    setInput('')
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
        <h1 className="hero-title">WebSocket chat</h1>
        <p className="hero-lead">
          Pub/sub + presence over a single WebSocket. Connected as <strong>{me}</strong>.{' '}
          {connected ? '🟢 connected' : '⚪ connecting…'}
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <p className="form-label">Members ({members.length})</p>
        <ul style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {members.map(m => (
            <li key={m.id} className="inline-code">{m.name}</li>
          ))}
        </ul>

        <div style={{ minHeight: '12rem', marginBottom: '1rem' }}>
          {messages.map((m, i) => (
            <p key={i} style={{ margin: '0.25rem 0' }}>
              <strong>{m.user}:</strong> {m.text}
            </p>
          ))}
        </div>

        <form onSubmit={e => { e.preventDefault(); void send() }} style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="form-input" value={input}
            onChange={e => setInput(e.target.value)} placeholder="Say something…" />
          <button type="submit" className="form-submit" style={{ width: 'auto' }}>Send</button>
        </form>
      </section>
    </div>
  )
}
