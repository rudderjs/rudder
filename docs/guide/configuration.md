# Configuration

Forge uses three distinct configuration layers. Understanding which layer handles what prevents confusion and duplication.

## The Three Layers

| Layer | File(s) | Purpose |
|-------|---------|---------|
| **Environment** | `.env` | Secrets and environment-specific values |
| **Runtime config** | `config/*.ts` | Named, typed objects that read from `.env` |
| **Framework wiring** | `bootstrap/app.ts` | Server adapter, providers, routing loaders |

There is no `forge.config.ts`. The `bootstrap/app.ts` file is where you wire the framework — the equivalent of Laravel's `bootstrap/app.php`.

## Environment Variables (`.env`)

Secrets and environment-specific values live in `.env`:

```dotenv
APP_NAME=MyApp
APP_ENV=local
APP_DEBUG=true

PORT=3000
CORS_ORIGIN=http://localhost:3000
TRUST_PROXY=false

DATABASE_URL="file:./dev.db"

AUTH_SECRET=change-me-in-production
APP_URL=http://localhost:3000

QUEUE_DRIVER=sync
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

MAIL_DRIVER=log
```

Never commit `.env` to version control. Provide `.env.example` as a template.

## Runtime Config (`config/*.ts`)

Each `config/*.ts` file exports a plain object that reads values from the environment using `Env`:

```ts
// config/server.ts
import { Env } from '@forge/core/support'

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

### The `Env` Helper

| Method | Signature | Description |
|--------|-----------|-------------|
| `Env.get` | `(key, fallback?)` | String value or fallback |
| `Env.getNumber` | `(key, fallback?)` | Parsed integer |
| `Env.getBool` | `(key, fallback?)` | Parses `'true'`/`'false'` strings |
| `Env.require` | `(key)` | Throws if key is missing |

### Validated Env with `defineEnv`

For critical environment variables, use `defineEnv` with a Zod schema to validate at startup:

```ts
import { defineEnv } from '@forge/core/support'
import { z } from 'zod'

export const env = defineEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    AUTH_SECRET:  z.string().min(32),
    APP_ENV:      z.enum(['local', 'production', 'test']),
  })
)
```

This throws at boot time if any required variable is missing or malformed — before your app starts serving traffic.

### Barrel Export

`config/index.ts` re-exports all config files:

```ts
export { default as app }      from './app.js'
export { default as server }   from './server.js'
export { default as database } from './database.js'
export { default as auth }     from './auth.js'
export { default as queue }    from './queue.js'
export { default as mail }     from './mail.js'
```

Then `bootstrap/app.ts` can import everything at once:

```ts
import * as configs from '../config/index.js'

Application.configure({
  server: hono(configs.server),
  config: configs,
  ...
})
```

Passing `config: configs` to `Application.configure()` binds each config object in the DI container, so you can retrieve it anywhere via:

```ts
import { app } from '@forge/core'

const serverConfig = app().make<typeof configs.server>('config.server')
```

## Framework Wiring (`bootstrap/app.ts`)

This file wires the framework together. It should contain **only structural decisions** — not business logic or environment values.

```ts
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'
import providers from './providers.js'
import * as configs from '../config/index.js'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    api:      () => import('../routes/api.js'),
    commands: () => import('../routes/console.js'),
  })
  .withMiddleware((m) => {
    // m.use(new CorsMiddleware().toHandler())
  })
  .withExceptions((_e) => {})
  .create()
```

### `Application.configure()` options

| Option | Type | Description |
|--------|------|-------------|
| `server` | `ServerAdapterProvider` | HTTP adapter (e.g. `hono(...)`) |
| `config` | `Record<string, unknown>` | Config objects to bind in the container |
| `providers` | `(typeof ServiceProvider)[]` | Service provider classes |

### `.withRouting()` options

| Option | Description |
|--------|-------------|
| `api` | Async import of your routes file — loaded lazily on first HTTP request |
| `commands` | Async import of your console routes — loaded at CLI boot |

### `.withMiddleware()`

Receives a middleware configurator. Register global middleware here:

```ts
.withMiddleware((m) => {
  m.use(new LoggerMiddleware().toHandler())
  m.use(RateLimit.perMinute(60).byIp().toHandler())
})
```

## Provider Boot Order

Providers listed in `bootstrap/providers.ts` boot in order. `DatabaseServiceProvider` must come first so `ModelRegistry` is populated before any other provider calls model methods:

```ts
export default [
  DatabaseServiceProvider,   // boots first — sets up ModelRegistry
  betterAuth(configs.auth),  // needs DB ready
  AppServiceProvider,        // may query DB during boot
]
```
