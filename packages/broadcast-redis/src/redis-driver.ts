import * as _ioredis from 'ioredis'
import type { Redis as RedisType } from 'ioredis'
import { resolveIoredisClass } from '@rudderjs/support'
import type { BroadcastDriver, BroadcastMeta } from '@rudderjs/broadcast'

const Redis = resolveIoredisClass<RedisType>(_ioredis)

export interface RedisDriverOptions {
  /**
   * Either an ioredis instance OR a connection URL. When a URL is given,
   * the driver creates two ioredis connections — one for `publish`, one
   * for `subscribe` — because ioredis subscriber clients cannot also
   * publish on the same connection. When an instance is given, the
   * driver duplicates it for the subscriber.
   */
  redis: RedisType | string

  /**
   * Channel-name prefix for Redis pub/sub. Default: `'rudderjs:broadcast:'`.
   * Useful when multiple apps share a Redis instance.
   */
  prefix?: string
}

interface RedisChannelMessage {
  /** Origin instance id — drops `excludeConnectionId` on foreign deliveries. */
  origin:  string
  channel: string
  event:   string
  data:    unknown
  meta?:   BroadcastMeta
}

/**
 * Redis pub/sub-backed broadcast driver. Every instance running this
 * driver subscribes to a single Redis channel; published messages
 * envelope `(channel, event, data, meta)` plus a per-instance origin
 * id so that local-only metadata (e.g. `excludeConnectionId`) only
 * applies on the originating instance.
 *
 * The constructor takes either an existing ioredis client or a
 * connection URL. With a URL, the driver owns both connections and
 * `close()` disconnects them. With an instance, the driver duplicates
 * it for the subscriber side; the publisher connection is treated as
 * caller-owned and `close()` does NOT disconnect it.
 */
export class RedisDriver implements BroadcastDriver {
  private readonly pub:          RedisType
  private readonly sub:          RedisType
  private readonly ownsPub:      boolean
  private readonly prefix:       string
  private readonly fanoutKey:    string
  private readonly originId:     string
  private handlers:              Array<(c: string, e: string, d: unknown, m?: BroadcastMeta) => void> = []
  private subscribed                                                                                   = false

  constructor(opts: RedisDriverOptions) {
    if (typeof opts.redis === 'string') {
      this.pub     = new Redis(opts.redis)
      this.sub     = new Redis(opts.redis)
      this.ownsPub = true
    } else {
      this.pub     = opts.redis
      this.sub     = opts.redis.duplicate()
      this.ownsPub = false
    }
    this.prefix    = opts.prefix ?? 'rudderjs:broadcast:'
    this.fanoutKey = this.prefix + 'fanout'
    this.originId  = mintOriginId()

    this.sub.on('message', (_redisChannel, raw) => {
      this.dispatch(raw)
    })

    this.sub.on('error', (err: unknown) => {
      console.error('[RudderJS Broadcast/Redis] subscriber connection error', err)
    })
    this.pub.on('error', (err: unknown) => {
      console.error('[RudderJS Broadcast/Redis] publisher connection error', err)
    })
  }

  async publish(
    channel: string,
    event:   string,
    data:    unknown,
    meta?:   BroadcastMeta,
  ): Promise<void> {
    const envelope: RedisChannelMessage = {
      origin:  this.originId,
      channel,
      event,
      data,
      ...(meta ? { meta } : {}),
    }
    try {
      await this.pub.publish(this.fanoutKey, JSON.stringify(envelope))
    } catch (err) {
      // Broadcasts must never block the caller on transport failure.
      console.error('[RudderJS Broadcast/Redis] publish failed', err)
    }
  }

  subscribe(
    handler: (c: string, e: string, d: unknown, m?: BroadcastMeta) => void,
  ): () => void {
    this.handlers.push(handler)
    if (!this.subscribed) {
      this.subscribed = true
      void this.sub.subscribe(this.fanoutKey).catch((err: unknown) => {
        console.error('[RudderJS Broadcast/Redis] subscribe failed', err)
      })
    }
    // Filter-replace (not splice) so a handler that self-unsubscribes mid-
    // dispatch doesn't shift indices under the active `for…of` iterator in
    // `dispatch()` — that would silently skip the next handler. The new-array
    // assignment keeps the active iterator pointed at the snapshot it
    // captured. Matches the LocalDriver subscribe contract.
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  async close(): Promise<void> {
    if (this.subscribed) {
      try { await this.sub.unsubscribe(this.fanoutKey) } catch { /* ignore */ }
      this.subscribed = false
    }
    try { this.sub.disconnect() } catch { /* ignore */ }
    if (this.ownsPub) {
      try { this.pub.disconnect() } catch { /* ignore */ }
    }
  }

  private dispatch(raw: string | Buffer): void {
    let envelope: RedisChannelMessage
    try {
      envelope = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as RedisChannelMessage
    } catch (err) {
      console.error('[RudderJS Broadcast/Redis] dropped malformed pub/sub payload', err)
      return
    }
    // Strip `excludeConnectionId` for messages that did NOT originate on
    // this instance — connection ids are local-only and would cause us
    // to skip the wrong socket.
    const meta = envelope.origin === this.originId
      ? envelope.meta
      : envelope.meta
        ? (() => {
            const { excludeConnectionId: _drop, ...rest } = envelope.meta
            return Object.keys(rest).length > 0 ? (rest as BroadcastMeta) : undefined
          })()
        : undefined
    for (const h of this.handlers) {
      try { h(envelope.channel, envelope.event, envelope.data, meta) }
      catch { /* observer errors must not break broadcasts */ }
    }
  }
}

function mintOriginId(): string {
  // Cheap, unique enough for a process lifetime. Not security-sensitive.
  return `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
