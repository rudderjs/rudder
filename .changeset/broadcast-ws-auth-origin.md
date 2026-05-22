---
"@rudderjs/broadcast": minor
---

Harden WebSocket auth surface (Phase 5 of the 2026-05-22 eventing/realtime plan):

- **Origin allowlist** on WS upgrade — configure `broadcast.allowedOrigins: string[]` to reject cross-origin connections with HTTP 403. Closes the CSRF-style attack against cookie-auth'd private/presence channels. When unset, all origins are accepted with a one-time startup warning (previous behaviour).
- **Per-connection auth hook** — `Broadcast.authConnection(async (req) => boolean)` runs once at upgrade time, before the WebSocket handshake. Returning `false` rejects with HTTP 401. Useful for requiring a valid session/token before any subscribe is possible.
- **Per-IP connection cap** — `broadcast.maxConnectionsPerIp: number` rejects upgrades from an IP that already has this many open connections (HTTP 429). Mitigates trivial FD-exhaustion DoS.
- **Server-side heartbeat** — protocol-level PING every 30s with a 60s PONG deadline; sockets that fall silent are terminated. Configurable via `broadcast.heartbeat: { interval, timeout } | false`. Closes the dead-TCP-connection leak from NAT timeouts / client crashes.
- **Per-socket message serialization** — `message` frames on a single socket now run sequentially via a chained promise. Closes the race window where a `client-event` could interleave with the same socket's pending `subscribe` auth callback.
- **Observer event additions** — `upgrade.rejected` (origin / ip-cap / connection-auth), `message.error` (safety-net catch), and an optional `error` field on `subscribe` events when the auth callback throws. Telescope picks these up unchanged via the existing observer registry.

All additions are backward-compatible: existing apps see no behaviour change beyond the one-time `allowedOrigins` warning. The heartbeat default (30s/60s) is well above any healthy round-trip and uses `unref()` so it doesn't keep the event loop alive.
