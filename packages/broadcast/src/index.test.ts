import { describe, it } from 'node:test'
import assert           from 'node:assert/strict'
import http             from 'node:http'
import { WebSocket }    from 'ws'
import { Channel, PrivateChannel, PresenceChannel } from './channel.js'
import {
  initWsServer, resetBroadcast, getUpgradeHandler,
  broadcast, broadcastStats, registerAuth,
} from './ws-server.js'

// ─── Helpers ───────────────────────────────────────────────

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  resetBroadcast()
  initWsServer()
  const handler = getUpgradeHandler('/ws')
  const server  = http.createServer()
  server.on('upgrade', handler)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  try {
    return await fn(port)
  } finally {
    resetBroadcast()  // terminates all WS clients
    await new Promise<void>((r) => {
      try { (server as unknown as { closeAllConnections(): void }).closeAllConnections() } catch { /* node < 18.2 */ }
      server.close(() => r())
    })
  }
}

type Msg = Record<string, unknown>

/** Buffered message reader — never misses messages between awaits. */
class MsgQueue {
  private buf:     Msg[]                = []
  private pending: ((m: Msg) => void)[] = []
  private closed                        = false

  constructor(ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg  = JSON.parse(String(raw)) as Msg
      const next = this.pending.shift()
      if (next) next(msg)
      else this.buf.push(msg)
    })
    ws.on('close', () => { this.closed = true })
    ws.on('error', () => { this.closed = true })
  }

  next(): Promise<Msg> {
    if (this.buf.length) return Promise.resolve(this.buf.shift()!)
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('WebSocket closed')); return }
      this.pending.push(resolve)
    })
  }
}

/** Open a connection, attach a MsgQueue before 'open' fires, consume 'connected'. */
async function connect(port: number): Promise<{ ws: WebSocket; q: MsgQueue }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    const q  = new MsgQueue(ws)  // buffering before 'open' — never miss first message
    ws.once('open',  () => q.next().then(() => resolve({ ws, q })))  // consume 'connected'
    ws.once('error', reject)
  })
}

async function send(ws: WebSocket, q: MsgQueue, data: unknown): Promise<Msg> {
  const p = q.next()
  ws.send(JSON.stringify(data))
  return p
}

// ─── All tests in one top-level describe so node:test runs them sequentially ──

describe('@rudderjs/ws', () => {

  // ─── Channel classes ─────────────────────────────────────

  describe('Channel', () => {
    it('Channel stores name as-is', () => {
      assert.strictEqual(new Channel('chat').name, 'chat')
    })

    it('PrivateChannel prefixes with private-', () => {
      assert.strictEqual(new PrivateChannel('orders').name, 'private-orders')
    })

    it('PresenceChannel prefixes with presence-', () => {
      assert.strictEqual(new PresenceChannel('room').name, 'presence-room')
    })
  })

  // ─── Pre-init ────────────────────────────────────────────

  describe('before initWsServer', () => {
    it('broadcastStats() returns zeros', () => {
      resetBroadcast()
      assert.deepEqual(broadcastStats(), { connections: 0, channels: 0 })
    })

    it('broadcast() is a no-op (does not throw)', () => {
      resetBroadcast()
      assert.doesNotThrow(() => broadcast('chan', 'event', {}))
    })

    it('getUpgradeHandler() returns a function', () => {
      assert.strictEqual(typeof getUpgradeHandler('/ws'), 'function')
    })
  })

  // ─── Connection ──────────────────────────────────────────

  describe('WebSocket connection', () => {
    it('connected message with socketId', () =>
      withServer(async (port) => {
        const ws = new WebSocket(`ws://localhost:${port}/ws`)
        const q  = new MsgQueue(ws)  // buffer BEFORE 'open' to catch 'connected'
        await new Promise<void>((r, j) => { ws.once('open', r); ws.once('error', j) })
        const msg = await q.next()
        assert.strictEqual(msg['type'], 'connected')
        assert.ok(typeof msg['socketId'] === 'string' && (msg['socketId'] as string).length > 0)
        ws.terminate()
      })
    )

    it('ping → pong', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        const msg = await send(ws, q, { type: 'ping' })
        assert.strictEqual(msg['type'], 'pong')
        ws.terminate()
      })
    )

    it('invalid JSON → error', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        ws.send('not-json')
        const msg = await q.next()
        assert.strictEqual(msg['type'], 'error')
        ws.terminate()
      })
    )

    it('wsStats reflects open connections', () =>
      withServer(async (port) => {
        const { ws } = await connect(port)
        assert.ok(broadcastStats().connections >= 1)
        ws.terminate()
      })
    )
  })

  // ─── Public channel ──────────────────────────────────────

  describe('public channel', () => {
    it('subscribe returns subscribed confirmation', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        const msg = await send(ws, q, { type: 'subscribe', channel: 'chat' })
        assert.strictEqual(msg['type'],    'subscribed')
        assert.strictEqual(msg['channel'], 'chat')
        ws.terminate()
      })
    )

    it('broadcast() delivers to subscriber', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        await send(ws, q, { type: 'subscribe', channel: 'news' })

        broadcast('news', 'article', { title: 'hello' })
        const msg = await q.next()

        assert.strictEqual(msg['type'],    'event')
        assert.strictEqual(msg['channel'], 'news')
        assert.strictEqual(msg['event'],   'article')
        assert.deepEqual(msg['data'],      { title: 'hello' })
        ws.terminate()
      })
    )

    it('broadcast() does not reach non-subscribers', () =>
      withServer(async (port) => {
        const { ws: sub,   q: subQ   } = await connect(port)
        const { ws: other, q: otherQ } = await connect(port)

        await send(sub, subQ, { type: 'subscribe', channel: 'zone' })

        let hit = false
        otherQ.next().then(() => { hit = true }).catch(() => {})

        broadcast('zone', 'ping', {})
        await new Promise((r) => setTimeout(r, 40))
        assert.strictEqual(hit, false)
        sub.terminate()
        other.terminate()
      })
    )

    it('unsubscribe stops delivery', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        await send(ws, q, { type: 'subscribe', channel: 'feed' })
        await send(ws, q, { type: 'unsubscribe', channel: 'feed' })

        let hit = false
        const p = q.next(); p.then(() => { hit = true }).catch(() => {})

        broadcast('feed', 'ping', {})
        await new Promise((r) => setTimeout(r, 40))
        assert.strictEqual(hit, false)
        ws.terminate()
      })
    )

    it('wsStats reflects active channels after subscribe', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        await send(ws, q, { type: 'subscribe', channel: 'stats-test' })
        assert.ok(broadcastStats().channels >= 1)
        ws.terminate()
      })
    )

    it('client-event forwarded to other subscribers, not sender', () =>
      withServer(async (port) => {
        const { ws: ws1, q: q1 } = await connect(port)
        const { ws: ws2, q: q2 } = await connect(port)
        await send(ws1, q1, { type: 'subscribe', channel: 'room' })
        await send(ws2, q2, { type: 'subscribe', channel: 'room' })

        ws1.send(JSON.stringify({ type: 'client-event', channel: 'room', event: 'typing', data: { user: 'Alice' } }))
        const msg = await q2.next()

        assert.strictEqual(msg['type'],  'event')
        assert.strictEqual(msg['event'], 'typing')
        ws1.terminate()
        ws2.terminate()
      })
    )

    it('client-event to unsubscribed channel returns error', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        const msg = await send(ws, q, { type: 'client-event', channel: 'nope', event: 'x', data: {} })
        assert.strictEqual(msg['type'], 'error')
        ws.terminate()
      })
    )
  })

  // ─── Private channel auth ────────────────────────────────

  describe('private channel', () => {
    it('denied when no auth handler registered', () =>
      withServer(async (port) => {
        const { ws, q } = await connect(port)
        const msg = await send(ws, q, { type: 'subscribe', channel: 'private-orders' })
        assert.strictEqual(msg['type'],    'error')
        assert.strictEqual(msg['channel'], 'private-orders')
        ws.terminate()
      })
    )

    it('denied when auth returns false', () =>
      withServer(async (port) => {
        registerAuth('private-denied.*', async () => false)
        const { ws, q } = await connect(port)
        const msg = await send(ws, q, { type: 'subscribe', channel: 'private-denied.1' })
        assert.strictEqual(msg['type'], 'error')
        ws.terminate()
      })
    )

    it('allowed when auth returns true', () =>
      withServer(async (port) => {
        registerAuth('private-allowed.*', async () => true)
        const { ws, q } = await connect(port)
        const msg = await send(ws, q, { type: 'subscribe', channel: 'private-allowed.1', token: 'tok' })
        assert.strictEqual(msg['type'], 'subscribed')
        ws.terminate()
      })
    )

    it('auth callback receives token from subscribe message', () =>
      withServer(async (port) => {
        let got: string | undefined
        registerAuth('private-tok.*', async (req) => { got = req.token; return true })
        const { ws, q } = await connect(port)
        await send(ws, q, { type: 'subscribe', channel: 'private-tok.1', token: 'secret' })
        assert.strictEqual(got, 'secret')
        ws.terminate()
      })
    )

    it('wildcard pattern matches multiple channels', () =>
      withServer(async (port) => {
        registerAuth('private-glob.*', async () => true)
        const { ws, q } = await connect(port)
        const m1 = await send(ws, q, { type: 'subscribe', channel: 'private-glob.a' })
        const m2 = await send(ws, q, { type: 'subscribe', channel: 'private-glob.b' })
        assert.strictEqual(m1['type'], 'subscribed')
        assert.strictEqual(m2['type'], 'subscribed')
        ws.terminate()
      })
    )

    it('broadcast reaches authenticated subscriber', () =>
      withServer(async (port) => {
        registerAuth('private-bcast.*', async () => true)
        const { ws, q } = await connect(port)
        await send(ws, q, { type: 'subscribe', channel: 'private-bcast.1' })

        broadcast('private-bcast.1', 'updated', { ok: true })
        const msg = await q.next()

        assert.strictEqual(msg['type'],  'event')
        assert.strictEqual(msg['event'], 'updated')
        ws.terminate()
      })
    )
  })

  // ─── Presence channel ────────────────────────────────────

  describe('presence channel', () => {
    it('joiner receives presence.members after subscribed', () =>
      withServer(async (port) => {
        registerAuth('presence-lobby', async () => ({ id: '1', name: 'Alice' }))
        const { ws, q } = await connect(port)
        await send(ws, q, { type: 'subscribe', channel: 'presence-lobby' })  // → 'subscribed'
        const msg = await q.next()  // → 'presence.members'
        assert.strictEqual(msg['type'], 'presence.members')
        assert.ok(Array.isArray(msg['members']))
        ws.terminate()
      })
    )

    it('existing member gets presence.joined when second joins', () =>
      withServer(async (port) => {
        registerAuth('presence-gameroom', async () => ({ id: '2', name: 'Bob' }))
        const { ws: ws1, q: q1 } = await connect(port)
        const { ws: ws2, q: _q2 } = await connect(port)

        await send(ws1, q1, { type: 'subscribe', channel: 'presence-gameroom' })
        await q1.next()  // presence.members (ws1 alone)

        ws2.send(JSON.stringify({ type: 'subscribe', channel: 'presence-gameroom' }))
        const msg = await q1.next()  // presence.joined

        assert.strictEqual(msg['type'], 'presence.joined')
        assert.deepEqual(msg['user'],   { id: '2', name: 'Bob' })
        ws1.terminate()
        ws2.terminate()
      })
    )

    it('remaining member gets presence.left on disconnect', () =>
      withServer(async (port) => {
        registerAuth('presence-office', async () => ({ id: '3', name: 'Eve' }))
        const { ws: ws1, q: q1 } = await connect(port)
        const { ws: ws2, q: q2 } = await connect(port)

        await send(ws1, q1, { type: 'subscribe', channel: 'presence-office' })
        await q1.next()  // presence.members

        ws2.send(JSON.stringify({ type: 'subscribe', channel: 'presence-office' }))
        await q1.next()  // presence.joined for ws2
        await q2.next()  // subscribed
        await q2.next()  // presence.members

        ws2.terminate()
        const msg = await q1.next()  // presence.left

        assert.strictEqual(msg['type'], 'presence.left')
        ws1.terminate()
      })
    )
  })

})
