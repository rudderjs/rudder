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

Logs every API and page request (skips static assets and Vite internals) with the `[boostkit]` tag. Two lines per request — on entry and on response:

```
10:30:15 AM [boostkit][request-1] HTTP request  → /api/users
10:30:15 AM [boostkit][request-1] HTTP response ← /api/users 200
```

Status colors: 2xx → magenta, 3xx → cyan, 4xx → yellow, 5xx → red.

### CORS

Configured via `HonoConfig.cors` — applied automatically before routes. No need to add `CorsMiddleware` manually.

### Dev Error Page

In non-production environments, unhandled errors render a styled HTML error page with the stack trace and source context.

## Notes

- `createFetchHandler()` is used by the Vike/Vite integration — not called directly
- CORS from `HonoConfig.cors` and `CorsMiddleware` from `@boostkit/middleware` are independent — don't use both
