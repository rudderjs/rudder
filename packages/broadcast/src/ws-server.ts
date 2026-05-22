import { WebSocketServer, WebSocket as WsSocket } from 'ws'
import type { IncomingMessage }                    from 'node:http'
import type { Duplex }                             from 'node:stream'
import { broadcastObservers } from './observers.js'

// ─── Public types ───────────────────────────────────────────

/** The HTTP upgrade request context passed to auth callbacks. */
export interface BroadcastAuthRequest {
  /** Raw HTTP headers from the upgrade request (includes cookies, Authorization, etc.) */
  headers: Record<string, string | string[] | undefined>
  /** Request URL (including query string) */
  url:     string
  /** Token the client sent in the subscribe message, if any */
  token?:  string
}

/**
 * Channel auth callback.
 * - Return `true` / `false` for private channels.
 * - Return a member-info object (or `false`) for presence channels.
 */
export type AuthCallback = (
  req:     BroadcastAuthRequest,
  channel: string,
) => Promise<boolean | Record<string, unknown>>

/**
 * Per-connection auth callback. Invoked once at WebSocket upgrade time,
 * before the socket is upgraded. Returning `false` rejects the upgrade
 * with HTTP 401. Returning `true` proceeds to the WebSocket handshake.
 */
export type ConnectionAuthCallback = (req: BroadcastAuthRequest) => Promise<boolean>

/** Options for {@link initWsServer}. */
export interface WsServerOptions {
  /**
   * Origin allowlist for WebSocket upgrade requests. When set, the
   * `Origin` header on each upgrade is compared against this list and
   * mismatches receive HTTP 403. When unset, all origins are accepted
   * (with a one-time startup warning) — set this in production to close
   * the CSRF-style cross-origin attack window on cookie-auth'd channels.
   */
  allowedOrigins?: string[]
  /**
   * Per-IP connection cap. Rejects upgrades from an IP that already has
   * this many open connections with HTTP 429. `undefined` / `0` disables.
   */
  maxConnectionsPerIp?: number
  /**
   * Server-side heartbeat. The server sends a WebSocket PING every
   * `interval` ms; if no PONG arrives within `timeout` ms the socket is
   * terminated. Pass `false` to disable. Default: `{ interval: 30000, timeout: 60000 }`.
   */
  heartbeat?: { interval: number; timeout: number } | false
}

// ─── Internal message types ─────────────────────────────────

type ClientMsg =
  | { type: 'subscribe';    channel: string; token?: string }
  | { type: 'unsubscribe';  channel: string }
  | { type: 'client-event'; channel: string; event: string; data: unknown }
  | { type: 'ping' }

// ─── Global state ───────────────────────────────────────────

const g            = globalThis as Record<string, unknown>
const KEY          = '__rudderjs_ws__'
const AUTH_KEY     = '__rudderjs_ws_auth__'
const CONN_AUTH_KEY = '__rudderjs_ws_conn_auth__'

const DEFAULT_HEARTBEAT = { interval: 30_000, timeout: 60_000 } as const

/** Internal runtime state held on globalThis so it survives HMR reloads. */
interface WsState {
  wss:           WebSocketServer
  /** socketId → set of subscribed channel names */
  subscriptions: Map<string, Set<string>>
  /** channel name → set of socketIds */
  channels:      Map<string, Set<string>>
  /** presence channel → socketId → member info */
  presence:      Map<string, Map<string, Record<string, unknown>>>
  /** socketId → open WebSocket */
  sockets:       Map<string, WsSocket>
  /** socketId → original upgrade IncomingMessage */
  upgradeReqs:   Map<string, IncomingMessage>
  /** socketId → IP for per-IP cap accounting */
  socketIps:     Map<string, string>
  /** IP → live connection count */
  ipCounts:      Map<string, number>
  counter:       number
  // Options (see WsServerOptions) — captured at init time
  allowedOrigins?:     Set<string>
  maxConnectionsPerIp?: number
  heartbeat:           { interval: number; timeout: number } | false
  /** Set to true once we've warned that allowedOrigins is empty. */
  warnedOpenOrigin:    boolean
}

// ─── Init ───────────────────────────────────────────────────

export function initWsServer(options: WsServerOptions = {}): void {
  if (g[KEY]) return   // already running (HMR / hot-reload)

  const wss = new WebSocketServer({ noServer: true })
  const heartbeat = options.heartbeat === false
    ? false as const
    : { ...DEFAULT_HEARTBEAT, ...(options.heartbeat ?? {}) }
  const state: WsState = {
    wss,
    subscriptions: new Map(),
    channels:      new Map(),
    presence:      new Map(),
    sockets:       new Map(),
    upgradeReqs:   new Map(),
    socketIps:     new Map(),
    ipCounts:      new Map(),
    counter:       0,
    ...(options.allowedOrigins && options.allowedOrigins.length > 0
      ? { allowedOrigins: new Set(options.allowedOrigins) }
      : {}),
    ...(options.maxConnectionsPerIp && options.maxConnectionsPerIp > 0
      ? { maxConnectionsPerIp: options.maxConnectionsPerIp }
      : {}),
    heartbeat,
    warnedOpenOrigin: false,
  }
  g[KEY] = state

  wss.on('connection', (ws: WsSocket, req: IncomingMessage) => {
    void onConnection(state, ws, req)
  })
}

// ─── Auth registry ──────────────────────────────────────────

export function registerAuth(pattern: string, callback: AuthCallback): void {
  if (!g[AUTH_KEY]) g[AUTH_KEY] = new Map<string, AuthCallback>()
  ;(g[AUTH_KEY] as Map<string, AuthCallback>).set(pattern, callback)
}

/**
 * Register a per-connection auth callback. Invoked once at WebSocket
 * upgrade time, before the socket is upgraded — return `false` to reject
 * the upgrade with HTTP 401. Useful for requiring a valid session cookie,
 * bearer token, or other gate before any subscribe is even possible.
 *
 * Only one callback may be registered at a time; calling again replaces.
 */
export function registerConnectionAuth(callback: ConnectionAuthCallback): void {
  g[CONN_AUTH_KEY] = callback
}

/**
 * Match a channel name against an auth pattern containing `*` wildcards.
 *
 * **Wildcard semantics.** `*` matches exactly one dot-separated segment —
 * encoded as the regex character class `[^.]+`. Not a recursive glob:
 * - `chat.*`        matches `chat.room1`        ✓
 * - `chat.*`        matches `chat.room1.replies` ✗ (two segments after `chat.`)
 * - `chat.*.public` matches `chat.room1.public` ✓
 *
 * All other regex metacharacters (`.`, `+`, `^`, `$`, `{}`, `()`, `|`,
 * `[]`, `\`) are escaped so they match literally.
 */
function matchPattern(pattern: string, channel: string): boolean {
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+') + '$'
  )
  return re.test(channel)
}

function findAuth(channel: string): AuthCallback | undefined {
  const map = g[AUTH_KEY] as Map<string, AuthCallback> | undefined
  if (!map) return undefined
  for (const [pattern, cb] of map) {
    if (matchPattern(pattern, channel)) return cb
  }
  return undefined
}

// ─── Helpers ────────────────────────────────────────────────

function nextId(state: WsState): string {
  return `bk${++state.counter}${Math.random().toString(36).slice(2, 7)}`
}

function send(ws: WsSocket, data: unknown): void {
  if (ws.readyState !== WsSocket.OPEN) return
  try {
    ws.send(JSON.stringify(data))
  } catch {
    // serialization or write error — connection may be closing
  }
}

function broadcastTo(state: WsState, channel: string, data: unknown, excludeId?: string): void {
  for (const sid of state.channels.get(channel) ?? []) {
    if (sid === excludeId) continue
    const ws = state.sockets.get(sid)
    if (ws) send(ws, data)
  }
}

// ─── Connection lifecycle ───────────────────────────────────

/**
 * Per-socket message-handling queue. Each socket's frames are processed
 * sequentially via a chained promise — this closes the auth race window
 * where a `client-event` could interleave with the same socket's pending
 * `subscribe` auth callback. Lives on the socket reference (WeakMap) so
 * it's GC'd automatically on close.
 */
const socketQueues = new WeakMap<WsSocket, Promise<void>>()

async function onConnection(state: WsState, ws: WsSocket, req: IncomingMessage): Promise<void> {
  const id = nextId(state)
  const ip = extractIp(req)
  state.sockets.set(id, ws)
  state.subscriptions.set(id, new Set())
  state.upgradeReqs.set(id, req)
  if (ip) {
    state.socketIps.set(id, ip)
    state.ipCounts.set(ip, (state.ipCounts.get(ip) ?? 0) + 1)
  }

  send(ws, { type: 'connected', socketId: id })

  // Notify observers (telescope, etc.)
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
  broadcastObservers.emit({
    kind:         'connection.opened',
    connectionId: id,
    url:          req.url ?? '/',
    ...(ip ? { ip } : {}),
    ...(ua ? { userAgent: ua } : {}),
  })

  // Heartbeat — protocol-level PING/PONG. If the client misses the deadline
  // the socket is terminated. Distinct from the JSON `{ type: 'ping' }`
  // message which is application-level.
  let heartbeatTimer: NodeJS.Timeout | undefined
  let pongDeadline:   NodeJS.Timeout | undefined
  if (state.heartbeat !== false) {
    const { interval, timeout } = state.heartbeat
    const armDeadline = (): void => {
      if (pongDeadline) clearTimeout(pongDeadline)
      pongDeadline = setTimeout(() => {
        try { ws.terminate() } catch { /* socket may already be closing */ }
      }, timeout)
    }
    ws.on('pong', () => {
      if (pongDeadline) { clearTimeout(pongDeadline); pongDeadline = undefined }
    })
    heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WsSocket.OPEN) return
      try { ws.ping() } catch { /* ignore */ }
      armDeadline()
    }, interval)
    // Don't keep the event loop alive just for heartbeats (tests, single-shot processes).
    heartbeatTimer.unref?.()
    pongDeadline?.unref?.()
  }

  ws.on('message', (raw) => {
    let msg: ClientMsg
    try { msg = JSON.parse(String(raw)) as ClientMsg }
    catch { send(ws, { type: 'error', message: 'Invalid JSON' }); return }
    // Serialize per-socket: each frame waits for the previous frame's
    // handler to settle. Closes the auth race window where a `client-event`
    // could interleave with this socket's pending `subscribe` auth check.
    // Errors are surfaced via the observer; nothing escapes to Node.
    const prev = socketQueues.get(ws) ?? Promise.resolve()
    const next = prev
      .then(() => onMessage(state, id, ws, req, msg))
      .catch((err: unknown) => {
        broadcastObservers.emit({
          kind:         'message.error',
          connectionId: id,
          error:        err,
        })
      })
    socketQueues.set(ws, next)
  })

  ws.on('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (pongDeadline)   clearTimeout(pongDeadline)
    disconnect(state, id)
  })
}

function extractIp(req: IncomingMessage): string | undefined {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim()
  if (Array.isArray(fwd))      return fwd[0]?.split(',')[0]?.trim()
  return req.socket.remoteAddress ?? undefined
}

async function onMessage(
  state: WsState,
  id:    string,
  ws:    WsSocket,
  req:   IncomingMessage,
  msg:   ClientMsg,
): Promise<void> {
  switch (msg.type) {

    case 'ping':
      send(ws, { type: 'pong' })
      break

    case 'subscribe': {
      const { channel, token } = msg
      const isPrivate  = channel.startsWith('private-')
      const isPresence = channel.startsWith('presence-')
      const channelType: 'public' | 'private' | 'presence' =
        isPresence ? 'presence' : isPrivate ? 'private' : 'public'

      if (isPrivate || isPresence) {
        const authFn = findAuth(channel)
        if (!authFn) {
          send(ws, { type: 'error', channel, message: 'Unauthorized' })
          broadcastObservers.emit({
            kind: 'subscribe', connectionId: id, channel, channelType,
            allowed: false, reason: 'No auth callback registered',
          })
          return
        }
        const authReq: BroadcastAuthRequest = {
          headers: req.headers as Record<string, string | string[] | undefined>,
          url:     req.url ?? '/',
          ...(token !== undefined ? { token } : {}),
        }
        const authStart = Date.now()
        let authError: unknown
        const result = await authFn(authReq, channel).catch((err: unknown) => {
          authError = err
          console.error('[RudderJS Broadcast] Auth callback error:', err)
          return false as const
        })
        const authMs  = Date.now() - authStart
        if (!result) {
          send(ws, { type: 'error', channel, message: 'Unauthorized' })
          broadcastObservers.emit({
            kind: 'subscribe', connectionId: id, channel, channelType,
            allowed: false, authMs,
            reason: authError ? 'Auth callback threw' : 'Auth callback returned false',
            ...(authError !== undefined ? { error: authError } : {}),
          })
          return
        }
        if (isPresence && typeof result === 'object') {
          if (!state.presence.has(channel)) state.presence.set(channel, new Map())
          state.presence.get(channel)?.set(id, result)
        }

        broadcastObservers.emit({
          kind: 'subscribe', connectionId: id, channel, channelType,
          allowed: true, authMs,
        })
      } else {
        broadcastObservers.emit({
          kind: 'subscribe', connectionId: id, channel, channelType: 'public',
          allowed: true,
        })
      }

      if (!state.channels.has(channel)) state.channels.set(channel, new Set())
      state.channels.get(channel)?.add(id)
      state.subscriptions.get(id)?.add(channel)

      send(ws, { type: 'subscribed', channel })

      if (isPresence) {
        const members = [...(state.presence.get(channel)?.values() ?? [])]
        send(ws, { type: 'presence.members', channel, members })
        const me = state.presence.get(channel)?.get(id)
        if (me) {
          broadcastTo(state, channel, { type: 'presence.joined', channel, user: me }, id)
          broadcastObservers.emit({
            kind: 'presence.join', connectionId: id, channel, member: me,
          })
        }
      }
      break
    }

    case 'unsubscribe':
      leaveChannel(state, id, msg.channel)
      send(ws, { type: 'unsubscribed', channel: msg.channel })
      broadcastObservers.emit({ kind: 'unsubscribe', connectionId: id, channel: msg.channel })
      break

    case 'client-event': {
      const { channel, event, data } = msg
      if (!state.subscriptions.get(id)?.has(channel)) {
        send(ws, { type: 'error', message: 'Not subscribed to channel' })
        return
      }
      const recipientCount = (state.channels.get(channel)?.size ?? 0) - 1 // exclude sender
      broadcastTo(state, channel, { type: 'event', channel, event, data }, id)
      broadcastObservers.emit({
        kind: 'broadcast', channel, event, recipientCount: Math.max(recipientCount, 0),
        payloadSize: jsonByteSize(data),
        source: 'client', sourceConnectionId: id,
      })
      break
    }
  }
}

/** Approximate JSON byte size of a value. Best-effort, swallows errors. */
function jsonByteSize(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') }
  catch { return 0 }
}

function leaveChannel(state: WsState, id: string, channel: string): void {
  state.channels.get(channel)?.delete(id)
  if ((state.channels.get(channel)?.size ?? 0) === 0) state.channels.delete(channel)
  state.subscriptions.get(id)?.delete(channel)

  if (channel.startsWith('presence-')) {
    const memberInfo = state.presence.get(channel)?.get(id)
    state.presence.get(channel)?.delete(id)
    if ((state.presence.get(channel)?.size ?? 0) === 0) state.presence.delete(channel)
    if (memberInfo) {
      broadcastTo(state, channel, { type: 'presence.left', channel, user: memberInfo })
      broadcastObservers.emit({
        kind: 'presence.leave', connectionId: id, channel, member: memberInfo,
      })
    }
  }
}

function disconnect(state: WsState, id: string): void {
  for (const ch of [...(state.subscriptions.get(id) ?? [])]) {
    leaveChannel(state, id, ch)
  }
  state.subscriptions.delete(id)
  state.sockets.delete(id)
  state.upgradeReqs.delete(id)
  const ip = state.socketIps.get(id)
  if (ip) {
    state.socketIps.delete(id)
    const next = (state.ipCounts.get(ip) ?? 1) - 1
    if (next <= 0) state.ipCounts.delete(ip)
    else state.ipCounts.set(ip, next)
  }
  broadcastObservers.emit({ kind: 'connection.closed', connectionId: id })
}

// ─── Test helpers ───────────────────────────────────────────

/** Reset all WebSocket state. For use in tests only. */
export function resetBroadcast(): void {
  const state = g[KEY] as WsState | undefined
  if (state) {
    // Terminate all open client connections first so server.close() doesn't hang
    for (const ws of state.sockets.values()) {
      try { ws.terminate() } catch { /* ignore */ }
    }
    try { state.wss.close() } catch { /* ignore */ }
  }
  delete g[KEY]
  delete g[AUTH_KEY]
  delete g[CONN_AUTH_KEY]
}

// ─── Public API ─────────────────────────────────────────────

/** Broadcast an event to all subscribers of a channel from anywhere on the server. */
export function broadcast(channel: string, event: string, data: unknown): void {
  const state = g[KEY] as WsState | undefined
  if (!state) return
  const recipientCount = state.channels.get(channel)?.size ?? 0
  broadcastTo(state, channel, { type: 'event', channel, event, data })
  broadcastObservers.emit({
    kind: 'broadcast', channel, event, recipientCount,
    payloadSize: jsonByteSize(data),
    source: 'server',
  })
}

/** Current connection stats. */
export function broadcastStats(): { connections: number; channels: number } {
  const state = g[KEY] as WsState | undefined
  if (!state) return { connections: 0, channels: 0 }
  return { connections: state.sockets.size, channels: state.channels.size }
}

/**
 * Returns a Node.js HTTP `upgrade` event handler.
 * Attach this to your http.Server to enable WebSocket connections on the given path.
 *
 * @internal Used by @rudderjs/vite and @rudderjs/server-hono.
 */
export function getUpgradeHandler(
  wsPath = '/ws',
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/'
    if (pathname !== wsPath) return  // not our path — leave for other handlers (e.g. Vite HMR)

    const state = g[KEY] as WsState | undefined
    if (!state) { socket.destroy(); return }

    // 5a — Origin allowlist
    if (state.allowedOrigins) {
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
      if (!origin || !state.allowedOrigins.has(origin)) {
        rejectUpgrade(socket, 403, 'Forbidden')
        broadcastObservers.emit({
          kind:   'upgrade.rejected',
          url:    req.url ?? '/',
          reason: 'origin',
          ...(origin ? { origin } : {}),
        })
        return
      }
    } else if (!state.warnedOpenOrigin) {
      state.warnedOpenOrigin = true
      console.warn(
        '[RudderJS Broadcast] No allowedOrigins configured — accepting cross-origin WebSocket ' +
        'connections. Set `broadcast.allowedOrigins` in production to close the CSRF window.'
      )
    }

    // 5b — Per-IP cap (cheap check, before async connection-auth)
    const ip = extractIp(req)
    if (state.maxConnectionsPerIp && ip) {
      const current = state.ipCounts.get(ip) ?? 0
      if (current >= state.maxConnectionsPerIp) {
        rejectUpgrade(socket, 429, 'Too Many Requests')
        broadcastObservers.emit({
          kind:   'upgrade.rejected',
          url:    req.url ?? '/',
          reason: 'ip-cap',
          ip,
        })
        return
      }
    }

    // 5b — Per-connection auth hook
    const connAuth = g[CONN_AUTH_KEY] as ConnectionAuthCallback | undefined
    if (connAuth) {
      const authReq: BroadcastAuthRequest = {
        headers: req.headers as Record<string, string | string[] | undefined>,
        url:     req.url ?? '/',
      }
      // The upgrade handler can't be async at the http.Server boundary, so
      // run the auth and complete-or-reject inside the promise.
      void connAuth(authReq)
        .catch((err: unknown) => {
          console.error('[RudderJS Broadcast] Connection auth callback threw:', err)
          return false
        })
        .then((allowed) => {
          if (!allowed) {
            rejectUpgrade(socket, 401, 'Unauthorized')
            broadcastObservers.emit({
              kind:   'upgrade.rejected',
              url:    req.url ?? '/',
              reason: 'connection-auth',
              ...(ip ? { ip } : {}),
            })
            return
          }
          state.wss.handleUpgrade(req, socket as Parameters<typeof state.wss.handleUpgrade>[1], head, (ws) => {
            state.wss.emit('connection', ws, req)
          })
        })
      return
    }

    state.wss.handleUpgrade(req, socket as Parameters<typeof state.wss.handleUpgrade>[1], head, (ws) => {
      state.wss.emit('connection', ws, req)
    })
  }
}

function rejectUpgrade(socket: Duplex, code: number, status: string): void {
  try {
    socket.write(`HTTP/1.1 ${code} ${status}\r\nConnection: close\r\n\r\n`)
  } catch { /* socket may already be closing */ }
  try { socket.destroy() } catch { /* ignore */ }
}
