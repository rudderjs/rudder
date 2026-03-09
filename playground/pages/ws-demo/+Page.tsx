import '@/index.css'
import { useEffect, useRef, useState } from 'react'
import { BKSocket } from '@/BKSocket'

type Message = { user: string; text: string; ts: number }
type Member  = { id: string; name: string }

function getWsUrl() {
  if (typeof window === 'undefined') return ''
  return `ws://${window.location.host}/ws`
}

export default function Page() {
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

    // ── Public chat channel ──────────────────────────────────
    const chat = socket.channel('chat')
    chat.on('message', (data) => {
      setMessages((prev) => [...prev, data as Message])
    })

    // ── Presence channel — tracks who is online ──────────────
    const room = socket.presence('lobby', 'demo-token')
    room.on('presence.members', (data) => {
      setMembers(data as Member[])
      setConnected(true)  // receiving presence.members means we're fully connected
    })
    room.on('presence.joined', (data) => {
      const user = (data as { user: Member }).user
      setMembers((prev) => [...prev.filter(m => m.id !== user.id), user])
    })
    room.on('presence.left', (data) => {
      const user = (data as { user: Member }).user
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
    <div className="min-h-svh bg-background flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">WebSocket Demo</h1>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${connected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            {connected ? 'Connected' : 'Connecting…'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            You: <span className="font-medium text-foreground">{ME}</span>
          </span>
          <button
            onClick={loadStats}
            className="text-xs px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
          >
            Stats
          </button>
          {stats && (
            <span className="text-xs text-muted-foreground">
              {stats.connections} conn · {stats.channels} ch
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 65px)' }}>
        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <p className="text-muted-foreground text-sm">No messages yet.</p>
                <p className="text-muted-foreground text-xs">Open this page in another tab — messages appear in real-time.</p>
              </div>
            )}
            {messages.map((m, i) => {
              const isMe = m.user === ME
              return (
                <div key={i} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold shrink-0">
                    {m.user.slice(-3)}
                  </div>
                  <div className={`flex flex-col gap-1 max-w-sm ${isMe ? 'items-end' : 'items-start'}`}>
                    <span className="text-xs text-muted-foreground">{m.user}</span>
                    <div className={`px-4 py-2 rounded-2xl text-sm leading-relaxed ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted rounded-tl-sm'}`}>
                      {m.text}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={sendMessage} className="border-t p-4 flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message and press Enter…"
              disabled={!connected}
              className="flex-1 px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || !connected}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              Send
            </button>
          </form>
        </div>

        {/* Online members sidebar */}
        <div className="w-52 border-l flex flex-col shrink-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <span className="text-sm font-medium">Online</span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{members.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {members.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No one here yet</p>
            ) : members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted/50">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="truncate">{m.name}</span>
              </div>
            ))}
          </div>

          <div className="border-t p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Presence channel tracks who is connected in real-time.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
