# @boostkit/server-hono

Hono-based HTTP server adapter for BoostKit applications.

## Installation

```bash
pnpm add @boostkit/server-hono
```

## Usage

Pass the `hono()` adapter to `Application.configure()` in your `bootstrap/app.ts`:

```ts
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
  .withMiddleware((_m) => {})
  .withExceptions((_e) => {})
  .create()
```

A typical `config/server.ts`:

```ts
import { Env } from '@boostkit/core'

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

## HonoConfig Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `3000` | Port the HTTP server listens on |
| `trustProxy` | `boolean` | `false` | Trust `X-Forwarded-For` and related proxy headers |
| `cors.origin` | `string` | `'*'` | Allowed CORS origin(s) — passed to Hono's CORS middleware |
| `cors.methods` | `string` | `'GET,POST,PUT,PATCH,DELETE,OPTIONS'` | Comma-separated list of allowed HTTP methods |
| `cors.headers` | `string` | `'Content-Type,Authorization'` | Comma-separated list of allowed request headers |

## API

### `hono(config?)`

Returns a `ServerAdapterProvider` that the application bootstrapper uses to create and start the HTTP server.

```ts
import { hono } from '@boostkit/server-hono'

const adapter = hono({
  port: 4000,
  trustProxy: true,
  cors: {
    origin: 'https://example.com',
    methods: 'GET,POST',
    headers: 'Content-Type,Authorization',
  },
})
```

The returned provider exposes three methods used internally by `@boostkit/core`:

| Method | Description |
|---|---|
| `create()` | Instantiates and returns the configured Hono server adapter |
| `createApp()` | Creates the underlying `Hono` app instance |
| `createFetchHandler()` | Returns the WinterCG-compatible `fetch` handler |

## Built-in Features

### Unified Request Logger

Every API and page request is logged to stdout with the `[boostkit]` tag. Static assets and Vite internals are filtered out. Two lines per request — on entry and on response:

```
10:30:15 AM [boostkit][request-1] HTTP request  → /api/users
10:30:15 AM [boostkit][request-1] HTTP response ← /api/users 200
```

Colors are applied per status range: 2xx → magenta, 3xx → cyan, 4xx → yellow, 5xx → red.

### CORS Middleware

CORS headers are automatically applied using the `cors` block in `HonoConfig`. You do **not** need to add `CorsMiddleware` manually via `withMiddleware()` — the adapter wires it for you from the server config.

### Vike Log Suppression

The adapter suppresses noisy internal Vike/Vite SSR log lines so the development console stays readable.

## Notes

- The CORS configuration in `HonoConfig.cors` is handled automatically by the adapter — do not add `CorsMiddleware` on top of it unless you need custom per-route logic.
- `createFetchHandler()` returns a standard `(request: Request) => Promise<Response>` function compatible with WinterCG runtimes (Cloudflare Workers, Bun, Deno).
- The adapter reads `trustProxy` to correctly resolve client IPs when behind a load balancer or reverse proxy.
