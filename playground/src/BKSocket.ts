// BKSocket — RudderJS WebSocket client
// Published by: pnpm rudder vendor:publish --tag=ws-client
// Copy this file anywhere in your frontend source (e.g. src/BKSocket.ts)

type Handler = (data: unknown) => void

// ─── Channel subscription ───────────────────────────────────

class ChannelSub {
  private handlers = new Map<string, Handler[]>()

  constructor(
    private readonly socket: BKSocket,
    readonly channelName: string,
    private readonly token?: string,
  ) {}

  /** Listen for a server-sent event on this channel. */
  on(event: string, handler: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
    return this
  }

  /** Emit a client-to-client event through this channel (presence channels only). */
  emit(event: string, data: unknown): this {
    this.socket._send({ type: 'client-event', channel: this.channelName, event, data })
    return this
  }

  /** Unsubscribe from this channel. */
  leave(): this {
    this.socket._send({ type: 'unsubscribe', channel: this.channelName })
    this.socket._dropChannel(this.channelName)
    return this
  }

  /** @internal */
  _fire(event: string, data: unknown): void {
    this.handlers.get(event)?.forEach((h) => h(data))
  }

  /** @internal — called by BKSocket to (re)subscribe after reconnect */
  _subscribe(): void {
    this.socket._send({ type: 'subscribe', channel: this.channelName, token: this.token })
  }
}

// ─── BKSocket ───────────────────────────────────────────────

export class BKSocket {
  private ws:             WebSocket | null   = null
  private channels        = new Map<string, ChannelSub>()
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private closed          = false

  constructor(private readonly url: string) {
    this._connect()
  }

  // ── Subscribe helpers ─────────────────────────────────────

  /** Subscribe to a public channel. */
  channel(name: string): ChannelSub {
    return this._getOrCreate(name)
  }

  /** Subscribe to a private channel (requires a token from your server). */
  private(name: string, token: string): ChannelSub {
    return this._getOrCreate(`private-${name}`, token)
  }

  /** Subscribe to a presence channel (auth + member tracking). */
  presence(name: string, token: string): ChannelSub {
    return this._getOrCreate(`presence-${name}`, token)
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /** Close the connection permanently (no reconnect). */
  disconnect(): void {
    this.closed = true
    clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  // ── Internals ─────────────────────────────────────────────

  private _getOrCreate(channelName: string, token?: string): ChannelSub {
    if (this.channels.has(channelName)) return this.channels.get(channelName)!
    const sub = new ChannelSub(this, channelName, token)
    this.channels.set(channelName, sub)
    sub._subscribe()
    return sub
  }

  private _connect(): void {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      // Resubscribe to all channels (handles reconnect)
      for (const sub of this.channels.values()) sub._subscribe()
    }

    this.ws.onmessage = (e: MessageEvent<string>) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(e.data) as Record<string, unknown> }
      catch { return }
      this._dispatch(msg)
    }

    this.ws.onclose = () => {
      if (this.closed) return
      this.reconnectTimer = setTimeout(() => this._connect(), 3000)
    }
  }

  private _dispatch(msg: Record<string, unknown>): void {
    const channel = msg['channel'] as string | undefined

    switch (msg['type']) {
      case 'event': {
        if (!channel) return
        this.channels.get(channel)?._fire(msg['event'] as string, msg['data'])
        break
      }
      case 'presence.joined':
        if (channel) this.channels.get(channel)?._fire('presence.joined', msg['user'])
        break
      case 'presence.left':
        if (channel) this.channels.get(channel)?._fire('presence.left', msg['user'])
        break
      case 'presence.members':
        if (channel) this.channels.get(channel)?._fire('presence.members', msg['members'])
        break
    }
  }

  /** @internal */
  _send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  /** @internal */
  _dropChannel(name: string): void {
    this.channels.delete(name)
  }
}
