# @boostkit/server-hono

Hono-based HTTP server adapter for BoostKit. Implements the `ServerAdapterProvider` contract and wires up routing, middleware, CORS, request logging, and the Vike SSR fetch handler.

## Installation

```bash
pnpm add @boostkit/server-hono
```

## Usage

```ts
// bootstrap/app.ts
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import configs from '../config/index.js'
import providers from './providers.js'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    api:      () => import('../routes/api.js'),
    commands: () => import('../routes/console.js'),
  })
  .create()
```

Typical `config/server.ts`:

```ts
import { Env } from '@boostkit/support'

export default {
  port:       Env.getNumber('PORT', 3000),
  trustProxy: Env.getBool('TRUST_PROXY', false),
  cors: {
    origin:  Env.get('CORS_ORIGIN', '*'),
    methods: Env.get('CORS_METHODS', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'),
    headers: Env.get('CORS_HEADERS', 'Content-Type,Authorization'),
  },
}
```

## API Reference

### `hono(config?)`

Returns a `ServerAdapterProvider`. Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Port for `listen()` |
| `trustProxy` | `boolean` | `false` | Trust `X-Forwarded-*` proxy headers |
| `cors.origin` | `string` | `'*'` | Allowed CORS origin |
| `cors.methods` | `string` | `'GET,POST,PUT,PATCH,DELETE,OPTIONS'` | Allowed methods |
| `cors.headers` | `string` | `'Content-Type,Authorization'` | Allowed request headers |

The returned provider exposes:

| Method | Description |
|--------|-------------|
| `create()` | Returns a `ServerAdapter` instance |
| `createApp()` | Returns the underlying `Hono` app |
| `createFetchHandler(setup?)` | Returns a WinterCG-compatible `(Request) => Promise<Response>` handler |

## Built-in Features

### Request Logger

Logs every request in a single line — skips static assets and Vite internals. Vike client-side navigation requests (`pageContext.json`) are shown as clean page paths with a `↩ nav` suffix:

```
01:01:20  #1  / .................................................. ~216ms 200
01:01:23  #2  /api/users .......................................... ~8.1ms 200
01:01:37  #3  /todos ↩ nav ........................................ ~5ms   200
01:01:42  #4  /api/contact .......................................  <1ms  429
```

- Counter (`#N`) — request sequence number
- Dots fill the space so the duration and status always align
- Duration — `<1ms`, `~8.1ms`, `~216ms`, `~1.23s`
- Status color: 2xx → green, 3xx → cyan, 4xx → yellow, 5xx → red (24-bit truecolor, not affected by terminal themes)

### CORS

Configured via `HonoConfig.cors` — applied automatically before routes. No need to add `CorsMiddleware` manually.

### Dev Error Page

In non-production environments, unhandled errors render a styled HTML error page with the stack trace and source context.

## Notes

- `createFetchHandler()` is used by the Vike/Vite integration — not called directly
- CORS from `HonoConfig.cors` and `CorsMiddleware` from `@boostkit/middleware` are independent — don't use both
