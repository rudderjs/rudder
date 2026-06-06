# @rudderjs/server-hono

## Overview

Hono-based HTTP server adapter — the default server in every RudderJS app. Implements the `ServerAdapterProvider` contract and wires up routing, middleware, CORS, request logging, IP extraction, the Vike SSR fetch handler, and the WebSocket upgrade bridge. You rarely touch this package directly: `Application.configure()` auto-resolves it when no `server:` option is passed, constructing it with `config('server')`.

## Key Patterns

### Wiring

No wiring needed by default — install the package and `bootstrap/app.ts` stays adapter-free. Pass `server:` explicitly only to customize construction (or when bundling to a single file):

```ts
// bootstrap/app.ts
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import config from '../config/index.js'
import providers from './providers.js'

export default Application.configure({
  server: hono(config.server),  // explicit — same as the auto-resolved default
  config,
  providers,
}).withRouting({...}).create()
```

### Config

```ts
// config/server.ts
import { Env } from '@rudderjs/support'

export default {
  port:       Env.getNumber('PORT', 3000),
  trustProxy: Env.getBool('TRUST_PROXY', false),
  cors: {
    origin:  Env.get('CORS_ORIGIN', '*'),
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    headers: 'Content-Type,Authorization',
  },
}
```

### What it does at runtime

- Mounts the router's registered routes onto a Hono app
- Applies global middleware → group middleware (`m.web` / `m.api`) → per-route middleware → handler
- Runs CORS + request logger
- Exposes `req.ip` via `extractIp()` (trust-proxy aware)
- Detects `ViewResponse` from controller handlers and resolves via Vike's `renderPage()`
- Detects `HttpException` + `ValidationError` and renders them
- Attaches the `__rudderjs_ws_upgrade__` handler in production (dev goes through `@rudderjs/vite`)
- Returns a WinterCG-compliant `fetch` function — same code works on Node, Bun, Deno, Cloudflare Workers

### Req/res state on the Hono context

Per-request state lives on the Hono `c` context via getters — `req.body`, `req.session`, `req.user`, response body. Because `normalizeRequest(c)` is called twice per request (once for `applyMiddleware`, once for `registerRoute`), **plain property sets don't cross between the two calls**. Mutations to `req` must live on `c` directly (e.g. `c.set('user', user)`), not on the normalized `req` object.

### IP extraction

```ts
const ip = req.ip                // set by server-hono's extractIp()
```

`req.ip` is the canonical accessor — populated by `extractIp(c)` in `normalizeRequest()`. Custom rate-limit `.by()` callbacks should read `req.ip`, not raw headers.

Trust-proxy mode (`trustProxy: true`) reads `X-Forwarded-For` + `X-Real-IP`; without it `req.ip` is `undefined`. Dev-mode `x-real-ip` injection from `@rudderjs/vite`'s `rudderjs:ip` plugin populates the header from `req.socket.remoteAddress` before universal-middleware converts to Web Request.

### Controller views (@rudderjs/view integration)

When a route returns a `ViewResponse` (from `view('id', props)`), server-hono duck-types it via the `__rudder_view__` marker and resolves via Vike's `renderPage()`. The adapter also intercepts SPA-nav `*.pageContext.json` URL suffixes — but only for paths registered as controller routes, so Vike's own pages are unaffected.

## Common Pitfalls

- **Mutating `req` expecting cross-call persistence.** Two `normalizeRequest(c)` calls per request means property sets on the first don't appear in the second. Store on `c` (Hono context) or use `req.raw.__custom`.
- **`trustProxy: true` without a trusted proxy chain.** Without a trusted proxy setting `X-Forwarded-For`, clients can spoof their IP by sending the header. Only set `trustProxy` when you're actually behind a proxy that strips client-supplied values.
- **Assuming Node APIs.** The fetch handler is WinterCG — it must work on Cloudflare Workers (no Node `http.Server`, no `fs` at top level). Lazy-load node built-ins inside functions if needed.
- **Installing a CORS middleware globally AND via server config.** The adapter's built-in CORS runs first. Additional `cors()` middleware via `m.use()` will run twice — usually benign but can double-set headers.
- **Request body on streaming endpoints.** `req.body` is parsed eagerly before the handler runs (JSON + form-urlencoded). For streaming uploads, access `req.raw.body` (the underlying `ReadableStream`) instead — parsing consumes the stream.
- **Custom `.listen()` ports.** `app.fetch` is the WinterCG handler; it doesn't auto-listen. `+server.ts` exports `{ fetch: app.fetch }` for Vike. For Node without Vike, use `serve({ fetch: app.fetch, port })` from `@hono/node-server`.

## Key Imports

```ts
import { hono } from '@rudderjs/server-hono'

import type { HonoConfig } from '@rudderjs/server-hono'

// Standalone Node listener (no Vike)
import { serve } from '@hono/node-server'
```
