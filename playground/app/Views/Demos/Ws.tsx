import { useEffect, useRef, useState } from 'react'
import { BKSocket } from '@/BKSocket'
import '@/index.css'

type Message = { user: string; text: string; ts: number }
type Member  = { id: string; name: string }

function getWsUrl() {
  if (typeof window === 'undefined') return ''
  return `ws://${window.location.host}/ws`
}

export default function WsDemo() {
  const [ME, setME]               = useState('')
  useEffect(() => { setME(`User-${Math.floor(Math.random() * 1000)}`) }, [])
  const socketRef                 = useRef<BKSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [members,   setMembers]   = useState<Member[]>([])
  const [input,     setInput]     = useState('')
  const [stats,     setStats]     = useState<{ connections: number; channels: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const socket = new BKSocket(getWsUrl())
    socketRef.current = socket

    const chat = socket.channel('chat')
    chat.on('message', (data) => {
      setMessages((prev) => [...prev, data as Message])
    })

    const room = socket.presence('lobby', 'demo-token')
    room.on('presence.members', (data) => {
      setMembers(data as Member[])
      setConnected(true)
    })
    room.on('presence.joined', (data) => {
      const user = data as Member
      setMembers((prev) => [...prev.filter(m => m.id !== user.id), user])
    })
    room.on('presence.left', (data) => {
      const user = data as Member
      setMembers((prev) => prev.filter(m => m.id !== user.id))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    const msg: Message = { user: ME, text: input.trim(), ts: Date.now() }
    fetch('/api/ws/broadcast', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(msg),
    })
    setInput('')
  }

  function loadStats() {
    fetch('/api/ws/ping').then(r => r.json()).then(setStats)
  }

  return (
    <div className="split-frame">
      <div className="split-toolbar">
        <div className="split-toolbar-title">
          <h1 className="split-toolbar-heading">WebSocket Demo</h1>
          <span className={`status-pill ${connected ? 'status-pill-on' : 'status-pill-off'}`}>
            <span className={`status-dot ${connected ? 'status-dot-on' : 'status-dot-off'}`} />
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>
        <div className="split-toolbar-title">
          <span className="split-toolbar-meta">
            You: <span style={{ fontWeight: 500 }}>{ME}</span>
          </span>
          <button onClick={loadStats} className="toolbar-button">Stats</button>
          {stats && (
            <span className="split-toolbar-meta">
              {stats.connections} conn · {stats.channels} ch
            </span>
          )}
        </div>
      </div>

      <div className="split-body">
        <div className="split-main">
          <div className="chat-list">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>No messages yet.</p>
                <p>
                  Open this page in another tab — messages appear in real-time. Rendered from{' '}
                  <code className="inline-code">app/Views/Demos/Ws.tsx</code> via{' '}
                  <code className="inline-code">view('demos.ws')</code>.
                </p>
              </div>
            )}
            {messages.map((m, i) => {
              const isMe = m.user === ME
              return (
                <div key={i} className={`chat-message${isMe ? ' chat-message-me' : ''}`}>
                  <div className="chat-avatar">{m.user.slice(-3)}</div>
                  <div className={`chat-stack${isMe ? ' chat-stack-me' : ''}`}>
                    <span className="chat-author">{m.user}</span>
                    <div className={isMe ? 'chat-bubble-me' : 'chat-bubble'}>{m.text}</div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={sendMessage} className="chat-form">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message and press Enter…"
              disabled={!connected}
              className="chat-input"
            />
            <button
              type="submit"
              disabled={!input.trim() || !connected}
              className="chat-send"
            >
              Send
            </button>
          </form>
        </div>

        <aside className="split-sidebar">
          <div className="split-sidebar-header">
            <span className="sidebar-title">Online</span>
            <span className="member-count">{members.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
            {members.length === 0 ? (
              <p className="sidebar-empty">No one here yet</p>
            ) : members.map((m) => (
              <div key={m.id} className="member-row">
                <span className="member-dot status-dot-on" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              </div>
            ))}
          </div>
          <div className="split-sidebar-footer">
            <p className="sidebar-note">
              Presence channel tracks who is connected in real-time.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
