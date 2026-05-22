---
"@rudderjs/sync":            patch
"@rudderjs/broadcast":       patch
"@rudderjs/broadcast-redis": patch
---

Real-time correctness sweep — four bugs in the WebSocket / broadcast layer surfaced by an under-audited-tier review:

- **`@rudderjs/sync` — ghost users on disconnect.** When a peer disconnected (refresh, tab close, network drop), the server only cleaned its own maps. Other peers never learned the user had left, so `Awareness.getStates()` kept the ghost user until the y-protocols 30s outdated-timeout — or forever if the client never refreshed their awareness clock. The fix tracks per-socket Y.js clientIDs as awareness frames arrive and synthesizes a null-state awareness message to remaining peers on close. Surfaces immediately in the playground demo (`/demos/sync`) — refresh no longer bumps the "Active users" count.
- **`@rudderjs/sync` — unhandled rejection in async message handler.** The `ws.on('message', async (raw) => …)` body had no outer try/catch — a malformed Y frame (truncated varuint, bogus Y.applyUpdate input) became an unhandled promise rejection with no socket-level recovery. The fix wraps the body in try/catch and emits a `sync.error` observer event with `op: 'message'`.
- **`@rudderjs/broadcast-redis` — splice during dispatch skipped the next handler.** Unsubscribe used `this.handlers.splice(idx, 1)` which mutated the array under the active `for…of` iterator in `dispatch()`. When a handler self-unsubscribed inside a broadcast, the next handler was silently skipped. Replaced with `filter` (matches `LocalDriver`'s contract — new array assignment keeps the active iterator pointed at its snapshot).
- **`@rudderjs/broadcast` — dead-socket throw in `connAuth` upgrade path.** `state.wss.handleUpgrade(socket, …)` ran unconditionally after the auth promise resolved. If the client terminated the connection mid-await (proxy timeout, tab close), `handleUpgrade` threw against an already-destroyed socket. Guards on `socket.destroyed` before the call and emits `upgrade.rejected` with new reason `'socket-closed-during-auth'` so telescope sees the abandoned upgrade.

None of these change public APIs. The new `upgrade.rejected` reason adds a literal to the observer-event union (additive). Sync's `sync.error` observer event gains a new `op: 'message'` value (additive).
