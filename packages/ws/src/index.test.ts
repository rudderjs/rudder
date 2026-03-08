import { describe, it } from 'node:test'
import assert           from 'node:assert/strict'
import http             from 'node:http'
import { WebSocket }    from 'ws'
import {
  Channel, PrivateChannel, PresenceChannel,
  initWsServer, resetWs, getUpgradeHandler,
  broadcast, wsStats, registerAuth,
} from './index.js'

// ─── Helpers ───────────────────────────────────────────────

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  resetWs()
  initWsServer()
  const handler = getUpgradeHandler('/ws')
  const server  = http.createServer()
  server.on('upgrade', handler)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  try {
    return await fn(port)
  } finally {
    resetWs()  // terminates all WS clients
    await new Promise<void>((r) => {
      try { (server as unknown as { closeAllConnections(): void }).closeAllConnections() } catch { /* node < 18.2 */ }
      server.close(() => r())
    })
  }
}

async function openWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.once('open',  () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMsg(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>))
  })
}

async function openAndConsume(port: number): Promise<WebSocket> {
  const ws = await openWs(port)
  await nextMsg(ws)  // consume 'connected'
  return ws
}

async function send(ws: WebSocket, data: unknown): Promise<Record<string, unknown>> {
  const p = nextMsg(ws)
  ws.send(JSON.stringify(data))
  return p
}

// ─── Channel classes ───────────────────────────────────────

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

// ─── Pre-init ──────────────────────────────────────────────

describe('before initWsServer', () => {
  it('wsStats() returns zeros', () => {
    resetWs()
    assert.deepEqual(wsStats(), { connections: 0, channels: 0 })
  })

  it('broadcast() is a no-op (does not throw)', () => {
    resetWs()
    assert.doesNotThrow(() => broadcast('chan', 'event', {}))
  })

  it('getUpgradeHandler() returns a function', () => {
    assert.strictEqual(typeof getUpgradeHandler('/ws'), 'function')
  })
})

// ─── Connection ────────────────────────────────────────────

describe('WebSocket connection', () => {
  it('connected message with socketId', () =>
    withServer(async (port) => {
      const ws  = await openWs(port)
      const msg = await nextMsg(ws)
      assert.strictEqual(msg['type'], 'connected')
      assert.ok(typeof msg['socketId'] === 'string' && (msg['socketId'] as string).length > 0)
      ws.terminate()
    })
  )

  it('ping → pong', () =>
    withServer(async (port) => {
      const ws  = await openAndConsume(port)
      const msg = await send(ws, { type: 'ping' })
      assert.strictEqual(msg['type'], 'pong')
      ws.terminate()
    })
  )

  it('invalid JSON → error', () =>
    withServer(async (port) => {
      const ws = await openAndConsume(port)
      const p  = nextMsg(ws)
      ws.send('not-json')
      assert.strictEqual((await p)['type'], 'error')
      ws.terminate()
    })
  )

  it('wsStats reflects open connections', () =>
    withServer(async (port) => {
      const ws = await openAndConsume(port)
      assert.ok(wsStats().connections >= 1)
      ws.terminate()
    })
  )
})

// ─── Public channel ────────────────────────────────────────

describe('public channel', () => {
  it('subscribe returns subscribed confirmation', () =>
    withServer(async (port) => {
      const ws  = await openAndConsume(port)
      const msg = await send(ws, { type: 'subscribe', channel: 'chat' })
      assert.strictEqual(msg['type'],    'subscribed')
      assert.strictEqual(msg['channel'], 'chat')
      ws.terminate()
    })
  )

  it('broadcast() delivers to subscriber', () =>
    withServer(async (port) => {
      const ws = await openAndConsume(port)
      await send(ws, { type: 'subscribe', channel: 'news' })

      const p = nextMsg(ws)
      broadcast('news', 'article', { title: 'hello' })
      const msg = await p

      assert.strictEqual(msg['type'],    'event')
      assert.strictEqual(msg['channel'], 'news')
      assert.strictEqual(msg['event'],   'article')
      assert.deepEqual(msg['data'],      { title: 'hello' })
      ws.terminate()
    })
  )

  it('broadcast() does not reach non-subscribers', () =>
    withServer(async (port) => {
      const sub   = await openAndConsume(port)
      const other = await openAndConsume(port)

      await send(sub, { type: 'subscribe', channel: 'zone' })

      let hit = false
      other.on('message', () => { hit = true })

      broadcast('zone', 'ping', {})
      await new Promise((r) => setTimeout(r, 40))
      assert.strictEqual(hit, false)
      sub.terminate()
      other.terminate()
    })
  )

  it('unsubscribe stops delivery', () =>
    withServer(async (port) => {
      const ws = await openAndConsume(port)
      await send(ws, { type: 'subscribe', channel: 'feed' })
      await send(ws, { type: 'unsubscribe', channel: 'feed' })

      let hit = false
      ws.on('message', () => { hit = true })

      broadcast('feed', 'ping', {})
      await new Promise((r) => setTimeout(r, 40))
      assert.strictEqual(hit, false)
      ws.terminate()
    })
  )

  it('wsStats reflects active channels after subscribe', () =>
    withServer(async (port) => {
      const ws = await openAndConsume(port)
      await send(ws, { type: 'subscribe', channel: 'stats-test' })
      assert.ok(wsStats().channels >= 1)
      ws.terminate()
    })
  )

  it('client-event forwarded to other subscribers, not sender', () =>
    withServer(async (port) => {
      const ws1 = await openAndConsume(port)
      const ws2 = await openAndConsume(port)
      await send(ws1, { type: 'subscribe', channel: 'room' })
      await send(ws2, { type: 'subscribe', channel: 'room' })

      const p = nextMsg(ws2)
      ws1.send(JSON.stringify({ type: 'client-event', channel: 'room', event: 'typing', data: { user: 'Alice' } }))
      const msg = await p

      assert.strictEqual(msg['type'],  'event')
      assert.strictEqual(msg['event'], 'typing')
      ws1.terminate()
      ws2.terminate()
    })
  )

  it('client-event to unsubscribed channel returns error', () =>
    withServer(async (port) => {
      const ws  = await openAndConsume(port)
      const msg = await send(ws, { type: 'client-event', channel: 'nope', event: 'x', data: {} })
      assert.strictEqual(msg['type'], 'error')
      ws.terminate()
    })
  )
})

// ─── Private channel auth ──────────────────────────────────

describe('private channel', () => {
  it('denied when no auth handler registered', () =>
    withServer(async (port) => {
      const ws  = await openAndConsume(port)
      const msg = await send(ws, { type: 'subscribe', channel: 'private-orders' })
      assert.strictEqual(msg['type'],    'error')
      assert.strictEqual(msg['channel'], 'private-orders')
      ws.terminate()
    })
  )

  it('denied when auth returns false', () =>
    withServer(async (port) => {
      registerAuth('private-denied.*', async () => false)
      const ws  = await openAndConsume(port)
      const msg = await send(ws, { type: 'subscribe', channel: 'private-denied.1' })
      assert.strictEqual(msg['type'], 'error')
      ws.terminate()
    })
  )

  it('allowed when auth returns true', () =>
    withServer(async (port) => {
      registerAuth('private-allowed.*', async () => true)
      const ws  = await openAndConsume(port)
      const msg = await send(ws, { type: 'subscribe', channel: 'private-allowed.1', token: 'tok' })
      assert.strictEqual(msg['type'], 'subscribed')
      ws.terminate()
    })
  )

  it('auth callback receives token from subscribe message', () =>
    withServer(async (port) => {
      let got: string | undefined
      registerAuth('private-tok.*', async (req) => { got = req.token; return true })
      const ws = await openAndConsume(port)
      await send(ws, { type: 'subscribe', channel: 'private-tok.1', token: 'secret' })
      assert.strictEqual(got, 'secret')
      ws.terminate()
    })
  )

  it('wildcard pattern matches multiple channels', () =>
    withServer(async (port) => {
      registerAuth('private-glob.*', async () => true)
      const ws = await openAndConsume(port)
      const m1 = await send(ws, { type: 'subscribe', channel: 'private-glob.a' })
      const m2 = await send(ws, { type: 'subscribe', channel: 'private-glob.b' })
      assert.strictEqual(m1['type'], 'subscribed')
      assert.strictEqual(m2['type'], 'subscribed')
      ws.terminate()
    })
  )

  it('broadcast reaches authenticated subscriber', () =>
    withServer(async (port) => {
      registerAuth('private-bcast.*', async () => true)
      const ws = await openAndConsume(port)
      await send(ws, { type: 'subscribe', channel: 'private-bcast.1' })

      const p = nextMsg(ws)
      broadcast('private-bcast.1', 'updated', { ok: true })
      const msg = await p

      assert.strictEqual(msg['type'],  'event')
      assert.strictEqual(msg['event'], 'updated')
      ws.terminate()
    })
  )
})

// ─── Presence channel ──────────────────────────────────────

describe('presence channel', () => {
  it('joiner receives presence.members after subscribed', () =>
    withServer(async (port) => {
      registerAuth('presence-*', async () => ({ id: '1', name: 'Alice' }))
      const ws = await openAndConsume(port)
      await send(ws, { type: 'subscribe', channel: 'presence-room.1' }) // subscribed
      const msg = await nextMsg(ws) // presence.members
      assert.strictEqual(msg['type'], 'presence.members')
      assert.ok(Array.isArray(msg['members']))
      ws.terminate()
    })
  )

  it('existing member gets presence.joined when second joins', () =>
    withServer(async (port) => {
      registerAuth('presence-*', async () => ({ id: '2', name: 'Bob' }))
      const ws1 = await openAndConsume(port)
      const ws2 = await openAndConsume(port)

      await send(ws1, { type: 'subscribe', channel: 'presence-room.2' })
      await nextMsg(ws1) // presence.members (ws1 alone)

      const p = nextMsg(ws1)
      ws2.send(JSON.stringify({ type: 'subscribe', channel: 'presence-room.2' }))
      const msg = await p

      assert.strictEqual(msg['type'], 'presence.joined')
      assert.deepEqual(msg['user'],   { id: '2', name: 'Bob' })
      ws1.terminate()
      ws2.terminate()
    })
  )

  it('remaining member gets presence.left on disconnect', () =>
    withServer(async (port) => {
      registerAuth('presence-*', async () => ({ id: '3', name: 'Eve' }))
      const ws1 = await openAndConsume(port)
      const ws2 = await openAndConsume(port)

      await send(ws1, { type: 'subscribe', channel: 'presence-room.3' })
      await nextMsg(ws1) // presence.members

      ws2.send(JSON.stringify({ type: 'subscribe', channel: 'presence-room.3' }))
      await nextMsg(ws1) // presence.joined for ws2
      await nextMsg(ws2) // subscribed
      await nextMsg(ws2) // presence.members

      const p = nextMsg(ws1)
      ws2.terminate()
      const msg = await p

      assert.strictEqual(msg['type'], 'presence.left')
      ws1.terminate()
    })
  )
})
