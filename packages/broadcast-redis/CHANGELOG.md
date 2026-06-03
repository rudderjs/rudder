# @rudderjs/broadcast-redis

## 1.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/broadcast@1.3.0
  - @rudderjs/console@1.4.0
  - @rudderjs/support@1.5.0

## 1.1.2

### Patch Changes

- ac45a61: Real-time correctness sweep — four bugs in the WebSocket / broadcast layer surfaced by an under-audited-tier review:

  - **`@rudderjs/sync` — ghost users on disconnect.** When a peer disconnected (refresh, tab close, network drop), the server only cleaned its own maps. Other peers never learned the user had left, so `Awareness.getStates()` kept the ghost user until the y-protocols 30s outdated-timeout — or forever if the client never refreshed their awareness clock. The fix tracks per-socket Y.js clientIDs as awareness frames arrive and synthesizes a null-state awareness message to remaining peers on close. Surfaces immediately in the playground demo (`/demos/sync`) — refresh no longer bumps the "Active users" count.
  - **`@rudderjs/sync` — unhandled rejection in async message handler.** The `ws.on('message', async (raw) => …)` body had no outer try/catch — a malformed Y frame (truncated varuint, bogus Y.applyUpdate input) became an unhandled promise rejection with no socket-level recovery. The fix wraps the body in try/catch and emits a `sync.error` observer event with `op: 'message'`.
  - **`@rudderjs/broadcast-redis` — splice during dispatch skipped the next handler.** Unsubscribe used `this.handlers.splice(idx, 1)` which mutated the array under the active `for…of` iterator in `dispatch()`. When a handler self-unsubscribed inside a broadcast, the next handler was silently skipped. Replaced with `filter` (matches `LocalDriver`'s contract — new array assignment keeps the active iterator pointed at its snapshot).
  - **`@rudderjs/broadcast` — dead-socket throw in `connAuth` upgrade path.** `state.wss.handleUpgrade(socket, …)` ran unconditionally after the auth promise resolved. If the client terminated the connection mid-await (proxy timeout, tab close), `handleUpgrade` threw against an already-destroyed socket. Guards on `socket.destroyed` before the call and emits `upgrade.rejected` with new reason `'socket-closed-during-auth'` so telescope sees the abandoned upgrade.

  None of these change public APIs. The new `upgrade.rejected` reason adds a literal to the observer-event union (additive). Sync's `sync.error` observer event gains a new `op: 'message'` value (additive).

- Updated dependencies [ac45a61]
  - @rudderjs/broadcast@1.2.1

## 1.1.1

### Patch Changes

- feb0d02: `RedisDriver` now uses `resolveIoredisClass` from `@rudderjs/support` instead of an inline CJS/ESM interop fallback. Behaviour identical.

  Also adds `pnpm smoke` (`smoke/multi-instance.mjs`) — a manual end-to-end smoke that spawns two child Node processes, each running its own WebSocket server backed by the same Redis pub/sub, and asserts cross-instance fan-out. Run with a local Redis (`docker run --rm -p 6379:6379 redis`) to validate any changes to the driver contract. The smoke script is excluded from the published tarball.

- Updated dependencies [feb0d02]
  - @rudderjs/support@1.3.0

## 1.1.0

### Minor Changes

- f1660bf: New package — Redis pub/sub driver for `@rudderjs/broadcast`.

  ```bash
  pnpm add @rudderjs/broadcast-redis ioredis
  ```

  ```ts
  // config/broadcast.ts
  import { RedisDriver } from "@rudderjs/broadcast-redis";

  export default {
    driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
  };
  ```

  Fans every `broadcast()` call across every app instance via a single Redis pub/sub channel (`rudderjs:broadcast:fanout` by default; override via the `prefix` option). Replaces the single-process Map walk so 2+ instance deployments no longer silently drop half their broadcast messages.

  Ships two doctor checks:

  - `broadcast-redis:url` — confirms `REDIS_URL` (or `BROADCAST_REDIS_URL`) is set
  - `broadcast-redis:connectivity` — under `rudder doctor --deep`, connects + PINGs

  The driver tags every envelope with a per-instance origin id and strips `excludeConnectionId` on foreign-origin deliveries so the `client-event` echo guard works correctly across the cluster.

  When you pass an existing ioredis instance via `{ redis: client }`, the driver duplicates it for the subscriber connection (ioredis subscribers can't publish on the same connection) and `close()` only disconnects the duplicate — your publisher stays open. URL form (`{ redis: 'redis://...' }`) is fully driver-owned.

  Initial 1.0.0 release per the `@rudderjs/cashier-paddle` precedent for new feature packages with stable APIs.

### Patch Changes

- Updated dependencies [f1660bf]
  - @rudderjs/broadcast@1.2.0
