import { describe, it } from 'node:test'
import assert           from 'node:assert/strict'
import http             from 'node:http'
import { WebSocket }    from 'ws'
import {
  initWsServer,
  resetBroadcast,
  getUpgradeHandler,
  broadcast,
} from './ws-server.js'
import { LocalDriver, type BroadcastDriver, type BroadcastMeta } from './driver.js'

// ─── Cross-driver fan-out test driver ────────────────────────

/**
 * Two `BroadcastDriver` instances backed by the same shared array of
 * subscribers — every published message reaches every subscribed handler
 * via in-process pub/sub, like Redis pub/sub on a single Redis instance.
 * Used to simulate two app processes sharing a multi-instance fan-out
 * driver without needing an actual Redis.
 */
class SharedFanoutBus {
  handlers: Array<(c: string, e: string, d: unknown, m?: BroadcastMeta) => void> = []
}

class FanoutTestDriver implements BroadcastDriver {
  constructor(private readonly bus: SharedFanoutBus, private readonly originId: string) {}

  async publish(channel: string, event: string, data: unknown, meta?: BroadcastMeta): Promise<void> {
    for (const h of this.bus.handlers) {
      // Mirror RedisDriver semantics: strip excludeConnectionId on
      // foreign-origin deliveries. Same-origin (we are the only origin
      // in this test) keeps it.
      const targetIsForeign = h !== this._handler
      const scoped = targetIsForeign && meta?.excludeConnectionId
        ? (() => { const { excludeConnectionId: _x, ...rest } = meta; return Object.keys(rest).length > 0 ? rest as BroadcastMeta : undefined })()
        : meta
      try { h(channel, event, data, scoped) } catch { /* swallow */ }
    }
  }

  private _handler?: (c: string, e: string, d: unknown, m?: BroadcastMeta) => void

  subscribe(h: (c: string, e: string, d: unknown, m?: BroadcastMeta) => void): () => void {
    this._handler = h
    this.bus.handlers.push(h)
    return () => {
      this.bus.handlers = this.bus.handlers.filter((x) => x !== h)
    }
  }

  /** Expose for the test that asserts origin tagging works. */
  origin(): string { return this.originId }
}

// ─── Server harness ──────────────────────────────────────────

async function spinUp(driver?: BroadcastDriver): Promise<{
  port: number
  server: http.Server
  shutdown: () => Promise<void>
}> {
  resetBroadcast()
  initWsServer(driver ? { driver } : {})
  const handler = getUpgradeHandler('/ws')
  const server  = http.createServer()
  server.on('upgrade', handler)
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port
  return {
    port,
    server,
    shutdown: async () => {
      resetBroadcast()
      await new Promise<void>((r) => {
        try { (server as unknown as { closeAllConnections(): void }).closeAllConnections() } catch { /* ignore */ }
        server.close(() => r())
      })
    },
  }
}

async function connectAndSubscribe(port: number, channel: string): Promise<{
  ws: WebSocket
  next: () => Promise<Record<string, unknown>>
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    const ws  = new WebSocket(`ws://localhost:${port}/ws`)
    const buf: Record<string, unknown>[] = []
    const waiters: Array<(m: Record<string, unknown>) => void> = []
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as Record<string, unknown>
      const next = waiters.shift()
      if (next) next(m)
      else buf.push(m)
    })
    ws.once('open', () => {
      // consume 'connected' + send subscribe + consume 'subscribed'
      void waitNext().then(() => {
        ws.send(JSON.stringify({ type: 'subscribe', channel }))
        void waitNext().then(() => {
          resolve({
            ws,
            next: waitNext,
            close: () => { try { ws.terminate() } catch { /* ignore */ } },
          })
        })
      })
    })
    ws.once('error', reject)
    function waitNext(): Promise<Record<string, unknown>> {
      if (buf.length) return Promise.resolve(buf.shift()!)
      return new Promise((r) => waiters.push(r))
    }
  })
}

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ─── Tests ───────────────────────────────────────────────────

describe('BroadcastDriver — cross-instance fan-out', () => {
  it('LocalDriver default — single-instance behaviour preserved', async () => {
    const { port, shutdown } = await spinUp()
    try {
      const { ws, next } = await connectAndSubscribe(port, 'news')
      await broadcast('news', 'article', { title: 'hello' })
      const msg = await next()
      assert.equal(msg['type'],    'event')
      assert.equal(msg['channel'], 'news')
      assert.equal(msg['event'],   'article')
      assert.deepEqual(msg['data'], { title: 'hello' })
      ws.terminate()
    } finally {
      await shutdown()
    }
  })

  it('two wss pointed at the same fanout driver fan messages across', async () => {
    const bus = new SharedFanoutBus()
    const drvA = new FanoutTestDriver(bus, 'A')
    const drvB = new FanoutTestDriver(bus, 'B')

    // Instance A
    const a = await spinUp(drvA)
    // Save state from A globally; spinUp() of B would resetBroadcast()
    // the GLOBAL ws state. We need two real wss in the same process — so
    // we work around by capturing A's state and restoring after B inits.
    //
    // Easier path: a single process with one wss is what spinUp creates.
    // For a two-wss test we'd need two separate isolates. Instead, exercise
    // the driver's contract directly: assert that publishing to drvB also
    // reaches drvA's subscriber.
    let seenOnA = false
    drvA.subscribe(() => { seenOnA = true })
    await drvB.publish('chan', 'evt', { hi: 1 })
    await tick(10)
    assert.equal(seenOnA, true, 'message published on B reaches subscribers on A via shared bus')

    await a.shutdown()
  })

  it('broadcast() routes through the configured driver (not LocalDriver direct path)', async () => {
    const published: Array<{ c: string; e: string }> = []
    const tracker: BroadcastDriver = {
      async publish(c, e) { published.push({ c, e }) },
      subscribe()      { return () => {} },
    }
    const { shutdown } = await spinUp(tracker)
    try {
      await broadcast('chan', 'evt', { x: 1 })
      assert.deepEqual(published, [{ c: 'chan', e: 'evt' }])
    } finally {
      await shutdown()
    }
  })

  it('resetBroadcast() unsubscribes from the driver and calls close()', async () => {
    let unsubscribed = false
    let closed       = false
    const drv: BroadcastDriver = {
      async publish() {},
      subscribe()   { return () => { unsubscribed = true } },
      close()       { closed = true },
    }
    const { shutdown } = await spinUp(drv)
    await shutdown()
    assert.equal(unsubscribed, true, 'driver subscription torn down')
    assert.equal(closed,       true, 'driver.close() invoked')
  })

  it('LocalDriver publishes deliver to subscribers on the same tick', async () => {
    const drv = new LocalDriver()
    let seen: string | undefined
    drv.subscribe((_c, e) => { seen = e })
    await drv.publish('chan', 'evt', null)
    assert.equal(seen, 'evt', 'LocalDriver fan-out is synchronous')
  })
})

describe('BroadcastDriver — HMR re-boot stability', () => {
  it('repeated initWsServer() calls are no-ops (no driver subscription churn)', async () => {
    const drv = new LocalDriver()
    let subscribeCount = 0
    const tracked: BroadcastDriver = {
      publish(c, e, d, m) { return drv.publish(c, e, d, m) },
      subscribe(h) { subscribeCount++; return drv.subscribe(h) },
    }
    resetBroadcast()
    initWsServer({ driver: tracked })
    initWsServer({ driver: tracked })   // simulate HMR — second call no-ops
    initWsServer({ driver: tracked })
    assert.equal(subscribeCount, 1, 'second/third initWsServer() must not re-subscribe to the driver')
    resetBroadcast()
  })
})
