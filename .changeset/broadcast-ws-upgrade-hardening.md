---
"@rudderjs/broadcast": minor
---

Harden the WebSocket upgrade and frame-handling path against IP spoofing and resource-exhaustion DoS.

- **`X-Forwarded-For` no longer trusts the client-supplied entry.** `extractIp` took the *leftmost* `X-Forwarded-For` entry unconditionally — on every deployment, even with no proxy. The leftmost is whatever the client sent when a proxy appends rather than replaces the header (the nginx `proxy_add_x_forwarded_for` default), so a client could forge it to scatter connections into fresh per-IP buckets (defeating `maxConnectionsPerIp`), pin a victim's bucket to the cap (429 lockout), and poison the IP recorded on observer events. A new `trustProxy` option (`boolean | number`) gates this exactly like `@rudderjs/server-hono`: off by default (the direct socket address is the client; proxy headers are ignored), `true` trusts one hop and reads the **rightmost** entry, `number N` trusts N chained hops.
- **Inbound frames are size-capped.** The server set no `maxPayload`, so it inherited the `ws` default of 100 MiB — an unauthenticated client could stream max-size frames that were fully buffered and `JSON.parse`'d, exhausting memory and CPU. A new `maxPayload` option (default 64 KiB) rejects oversized frames at the protocol layer (close code 1009) before they are buffered.
- **Per-connection subscription cap.** A single socket could subscribe to unbounded public channels (which need no auth), growing the process-global channel maps without limit. A new `maxChannelsPerSocket` option (default 100) rejects subscribes past the cap with an error frame.
- **A socket-level error no longer crashes the server.** Each connection now has an `error` listener — an oversized frame, protocol violation, or transport reset previously emitted an unhandled `error` on the socket, which Node escalated to an uncaught exception that killed the whole broadcast process.

All three limits are configurable via `BroadcastConfig` (`trustProxy`, `maxPayload`, `maxChannelsPerSocket`).
