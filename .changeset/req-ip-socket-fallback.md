---
"@rudderjs/server-hono": patch
"@rudderjs/middleware": patch
---

`req.ip` now falls back to the direct socket address (Laravel `Request::ip()` parity) instead of resolving only under `TRUST_PROXY=true`. Channels: srvx's `request.ip`/`runtime.node` (the vike production server), `env.incoming` under `@hono/node-server`, and — dev-only, gated off `NODE_ENV=production` — the `x-real-ip` header injected by `@rudderjs/vite`'s `rudderjs:ip` plugin (the vite pipeline hands the adapter a plain web Request with no socket). Client-sent proxy headers are still never read when `trustProxy` is off.

Previously `req.ip` was always `undefined` in the default configuration, so every ip-keyed `RateLimit` collapsed all clients into one shared `'unknown'` bucket — including the scaffolded 10/min auth limiter, which became a site-wide login throttle. `RateLimit` also warns once per process if an ip-keyed limiter still sees no `req.ip`. IPv4-mapped IPv6 socket addresses (`::ffff:a.b.c.d`) normalize to bare IPv4.
