export function rudderSocketSource(): string {
  return `// RudderSocket — RudderJS WebSocket client
//
// Multiplexes channels and presence rooms over a single WebSocket connection.
// Mirrors the API expected by @rudderjs/broadcast on the server.

type Listener = (data: unknown) => void

class Channel {
  private listeners = new Map<string, Set<Listener>>()

  constructor(
    private readonly socket: RudderSocket,
    public readonly name: string,
  ) {}

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return this
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn)
    return this
  }

  /** @internal — invoked by RudderSocket on incoming messages */
  receive(event: string, data: unknown) {
    this.listeners.get(event)?.forEach(fn => fn(data))
  }

  /** @internal — invoked by RudderSocket to (re)subscribe after connect */
  subscribe() {
    this.socket.send({ type: 'subscribe', channel: this.name })
  }
}

class Presence extends Channel {
  constructor(socket: RudderSocket, name: string, private readonly token: string) {
    super(socket, name)
  }

  override subscribe() {
    this.socket.send({ type: 'presence.join', channel: this.name, token: this.token })
  }
}

export class RudderSocket {
  private ws?: WebSocket
  private readonly channels = new Map<string, Channel>()
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly url: string) {
    this.connect()
  }

  channel(name: string): Channel {
    let ch = this.channels.get(name)
    if (!ch) { ch = new Channel(this, name); this.channels.set(name, ch); ch.subscribe() }
    return ch
  }

  presence(name: string, token: string): Channel {
    let ch = this.channels.get(name)
    if (!ch) { ch = new Presence(this, name, token); this.channels.set(name, ch); ch.subscribe() }
    return ch
  }

  send(payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload))
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  private connect() {
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => this.channels.forEach(ch => ch.subscribe())
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { channel?: string; event?: string; data?: unknown }
        if (msg.channel && msg.event) this.channels.get(msg.channel)?.receive(msg.event, msg.data)
      } catch { /* ignore non-JSON frames */ }
    }
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 1500)
    }
  }
}
`
}
