# @rudderjs/broadcast-redis

Redis pub/sub driver for [`@rudderjs/broadcast`](../broadcast) — multi-instance WebSocket fan-out.

```bash
pnpm add @rudderjs/broadcast-redis ioredis
```

## Why

`@rudderjs/broadcast` ships an in-process `LocalDriver` by default — fine for a single-process app. As soon as you run two or more processes (load-balanced behind a proxy, multiple Fly machines, autoscaled containers, etc.) the in-process subscriber map only covers the instance that handles the WebSocket — a `broadcast()` call from any other instance silently delivers to nobody.

`RedisDriver` fans every broadcast through a single Redis pub/sub channel so every instance receives every message, then re-broadcasts to its local subscribers.

## Setup

```ts
// config/broadcast.ts
import type { BroadcastConfig } from '@rudderjs/broadcast'
import { RedisDriver }           from '@rudderjs/broadcast-redis'

const config: BroadcastConfig = {
  driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
  // any other broadcast options (allowedOrigins, heartbeat, etc.) still apply
}

export default config
```

That's it — no other changes. `broadcast()` callers, channel auth, presence rooms, telescope observability all work unchanged.

## Options

```ts
new RedisDriver({
  redis:  process.env.REDIS_URL!,    // URL → driver owns the pair of connections
  // OR
  redis:  new Redis({ ... }),        // instance → driver duplicates for sub side; pub stays caller-owned

  prefix: 'rudderjs:broadcast:',     // default; change if multiple apps share a Redis
})
```

When you pass an `ioredis` instance directly, the driver duplicates it for the subscriber connection (ioredis subscriber clients cannot also publish) and only disconnects the duplicate on `close()`. Caller-owned publishers stay open. When you pass a URL, both connections are driver-owned.

## How it works

- Every `broadcast()` call (server-initiated and client-event) routes through `driver.publish()`.
- Each `RedisDriver` instance subscribes to one Redis channel (`rudderjs:broadcast:fanout` by default) and re-fans the envelope to local subscribers — so the message reaches local WebSocket subscribers on every instance, including the one that originally published.
- The envelope carries an origin instance id. `excludeConnectionId` (used by the `client-event` echo guard) only applies to messages that originated on this instance — multi-instance deliveries from other instances drop it because the connection id is local.

## Doctor

`pnpm rudder doctor` (when this package is installed) runs:

- `broadcast-redis:url` — confirms `REDIS_URL` (or `BROADCAST_REDIS_URL`) is set
- `broadcast-redis:connectivity` (under `--deep`) — connects + `PING`

## Trade-offs

- Adds a Redis network hop on every broadcast — sub-millisecond on a co-located Redis, but a real cost when Redis is far. For a single-instance deployment, stick with the default `LocalDriver`.
- Sender's own `client-event` echoes back from Redis as a delivery — the sending socket is excluded on its own instance, but the message still reaches Redis subscribers on other instances (matches Pusher semantics).
- Single Redis channel for all app channels — every instance receives every fan-out message and filters locally. Cheap until volumes get huge; partition options are a follow-up.

## License

MIT
