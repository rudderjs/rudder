import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  initWsServer,
  resetBroadcast,
  broadcastObservers,
  type BroadcastDriver,
  type BroadcastMeta,
  type BroadcastEvent,
} from '@rudderjs/broadcast'
import {
  AnonymousNotifiable,
  BroadcastChannel,
  ChannelRegistry,
  Notification,
  Notifier,
  type Notifiable,
} from './index.js'

// We don't stub `@rudderjs/broadcast.broadcast()` — ESM module exports are
// read-only, so monkey-patching the binding fails. Instead we observe its
// effect via `broadcastObservers`, which broadcast() emits to on every
// invocation. broadcastObservers is the canonical instrumentation hook
// used by `@rudderjs/telescope` and survives HMR via globalThis.

class OrderShipped extends Notification {
  constructor(private readonly _orderId: number) { super() }
  via(): string[] { return ['broadcast'] }
  toBroadcast(): { orderId: number } { return { orderId: this._orderId } }
}

class NoBroadcastImpl extends Notification {
  via(): string[] { return ['broadcast'] }
}

const userA: Notifiable = { id: 7 }

function asBroadcastEvent(e: BroadcastEvent): Extract<BroadcastEvent, { kind: 'broadcast' }> | null {
  return e.kind === 'broadcast' ? e : null
}

describe('BroadcastChannel', () => {
  let events: BroadcastEvent[]
  let unsubscribe: () => void

  beforeEach(() => {
    resetBroadcast()
    initWsServer()
    events = []
    unsubscribe = broadcastObservers.subscribe(e => events.push(e))
    ChannelRegistry.reset()
    ChannelRegistry.register('broadcast', new BroadcastChannel())
  })

  afterEach(() => {
    unsubscribe()
    ChannelRegistry.reset()
    resetBroadcast()
  })

  it('throws when the notification lacks toBroadcast()', async () => {
    await assert.rejects(
      () => new BroadcastChannel().send(userA, new NoBroadcastImpl()),
      /uses 'broadcast' but does not implement toBroadcast/,
    )
  })

  it('reaches the @rudderjs/broadcast peer via dynamic import (post-fix)', async () => {
    await Notifier.send(userA, new OrderShipped(42))
    const broadcasts = events.map(asBroadcastEvent).filter((e): e is NonNullable<typeof e> => e !== null)
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0]?.event, 'OrderShipped')
  })

  it('defaults the channel name to "user.<id>" for ORM-style notifiables', async () => {
    await Notifier.send(userA, new OrderShipped(1))
    const broadcasts = events.map(asBroadcastEvent).filter((e): e is NonNullable<typeof e> => e !== null)
    assert.equal(broadcasts[0]?.channel, 'user.7')
  })

  it('respects routeFor("broadcast") on AnonymousNotifiable', async () => {
    const anon = new AnonymousNotifiable().route('broadcast', 'public-feed')
    await Notifier.send(anon, new OrderShipped(1))
    const broadcasts = events.map(asBroadcastEvent).filter((e): e is NonNullable<typeof e> => e !== null)
    assert.equal(broadcasts[0]?.channel, 'public-feed')
  })

  it('falls back to "user.anonymous" for AnonymousNotifiable without a broadcast route', async () => {
    const anon = new AnonymousNotifiable()
    await Notifier.send(anon, new OrderShipped(1))
    const broadcasts = events.map(asBroadcastEvent).filter((e): e is NonNullable<typeof e> => e !== null)
    assert.equal(broadcasts[0]?.channel, 'user.anonymous')
  })

  it('uses notification.constructor.name as the event name', async () => {
    class MultiPart extends Notification {
      via() { return ['broadcast'] }
      toBroadcast() { return {} }
    }
    await Notifier.send(userA, new MultiPart())
    const broadcasts = events.map(asBroadcastEvent).filter((e): e is NonNullable<typeof e> => e !== null)
    assert.equal(broadcasts[0]?.event, 'MultiPart')
  })

  it('source is "server" (not "client") for Notifier-issued broadcasts', async () => {
    await Notifier.send(userA, new OrderShipped(99))
    const broadcasts = events.map(asBroadcastEvent).filter((e): e is NonNullable<typeof e> => e !== null)
    assert.equal(broadcasts[0]?.source, 'server')
  })

  // Regression: BroadcastChannel.send() must AWAIT broadcast(), which itself
  // resolves only once the driver has accepted the message. With a driver that
  // defers its publish (a Redis round-trip stand-in), a fire-and-forget call
  // would let Notifier.send() resolve while the publish is still pending.
  it('awaits the driver publish round-trip before Notifier.send() resolves', async () => {
    class DeferredDriver implements BroadcastDriver {
      published = false
      private handlers: Array<(c: string, e: string, d: unknown, m?: BroadcastMeta) => void> = []
      async publish(channel: string, event: string, data: unknown, meta?: BroadcastMeta): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve, 10))  // simulate a network hop
        this.published = true
        for (const h of this.handlers) { try { h(channel, event, data, meta) } catch { /* ignore */ } }
      }
      subscribe(handler: (c: string, e: string, d: unknown, m?: BroadcastMeta) => void): () => void {
        this.handlers.push(handler)
        return () => { this.handlers = this.handlers.filter(h => h !== handler) }
      }
    }

    resetBroadcast()
    const driver = new DeferredDriver()
    initWsServer({ driver })
    ChannelRegistry.reset()
    ChannelRegistry.register('broadcast', new BroadcastChannel())

    await Notifier.send(userA, new OrderShipped(5))

    // Pre-fix this is false: send() resolved before the deferred publish completed.
    assert.equal(driver.published, true)
  })
})
