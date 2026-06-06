# Configuration

Rudder configuration spans three layers. Each has a clear responsibility, and putting a value in the wrong layer is the most common source of confusion for developers new to the framework.

| Layer | File(s) | Purpose |
|---|---|---|
| Environment | `.env` | Secrets and environment-specific values |
| Runtime config | `config/*.ts` | Named, typed objects that read from `.env` |
| Framework wiring | `bootstrap/app.ts` | Server adapter, providers, routing loaders |

There is no `rudderjs.config.ts`. `bootstrap/app.ts` is the framework wiring file — pure structural decisions, no business logic.

## Environment variables

Secrets and environment-specific values live in `.env`:

```dotenv
APP_NAME=MyApp
APP_ENV=local
APP_DEBUG=true

PORT=3000
CORS_ORIGIN=http://localhost:3000

DATABASE_URL="file:./dev.db"
AUTH_SECRET=change-me-in-production
APP_URL=http://localhost:3000

QUEUE_DRIVER=sync
MAIL_DRIVER=log
```

Never commit `.env`. Provide `.env.example` as a template for teammates.

## Runtime config

Each `config/*.ts` file exports a plain object that reads values from the environment using the `Env` helper:

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

### The Env helper

| Method | Description |
|---|---|
| `Env.get(key, fallback?)` | String value or fallback. Throws if the key is missing AND no fallback was supplied. |
| `Env.getNumber(key, fallback?)` | Parsed number (via `Number(...)`, so floats are accepted); throws on `NaN`. |
| `Env.getBool(key, fallback?)` | Parses `'true'` / `'false'` / `'1'` / `'0'`. |
| `Env.has(key)` | Existence check; doesn't read the value. |

For critical values, validate at startup with `defineEnv`:

```ts
import { defineEnv } from '@rudderjs/support'
import { z } from 'zod'

export const env = defineEnv(
  z.object({
    DATABASE_URL: z.string().min(1),
    AUTH_SECRET:  z.string().min(32),
    APP_ENV:      z.enum(['local', 'production', 'test']),
  })
)
```

This throws at boot if any required variable is missing or malformed — before your app starts serving traffic.

### Barrel export

`config/index.ts` collects every config file into a single default export:

```ts
import app      from './app.js'
import server   from './server.js'
import database from './database.js'
import auth     from './auth.js'

export default { app, server, database, auth }
```

`bootstrap/app.ts` then imports it as one object:

```ts
import configs from '../config/index.ts'

Application.configure({
  server: hono(configs.server),
  config: configs,
  providers,
})
```

Passing `config: configs` binds the config repository in the DI container, so any service can retrieve a config slice on demand:

```ts
import { config } from '@rudderjs/core'

const serverConfig = config('server')
// or, via the repository: app().make<ConfigRepository>('config').get('server')
```

## Framework wiring

`bootstrap/app.ts` is where the framework comes together. It contains structural decisions only — server adapter, registered providers, route loaders — never environment values or business logic.

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'
import providers from './providers.ts'
import configs from '../config/index.ts'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60).toHandler())
  })
  .create()
```

### `Application.configure()`

| Option | Description |
|---|---|
| `server` | HTTP adapter (e.g. `hono(...)`) |
| `config` | Config objects to bind in the container |
| `providers` | Service provider classes, in boot order |

### `.withRouting()`

| Option | Description |
|---|---|
| `web` | Web routes — tagged `'web'`, get the web middleware group (session, auth) |
| `api` | API routes — tagged `'api'`, stateless by default |
| `commands` | Rudder commands — loaded only when running the CLI |

Routes loaded via `web` automatically receive session and auth middleware. Routes loaded via `api` are stateless — opt into auth per-route with `RequireBearer()` from `@rudderjs/passport`. See [Middleware](/guide/middleware) for the full middleware-group model.

### `.withMiddleware()`

The middleware configurator registers global middleware and group-specific middleware. `m.use(...)` appends to every request; `m.web(...)` and `m.api(...)` append to the matching group's stack.

```ts
.withMiddleware((m) => {
  m.use(RateLimit.perMinute(60).toHandler())     // every request
  m.web(SomeWebOnlyMiddleware().toHandler())     // web routes only
  m.api(SomeApiOnlyMiddleware().toHandler())     // api routes only
})
```

## Provider boot order

Providers boot in the order you list them. Most providers don't access the ORM during `boot()` — they only configure their own adapters. The database provider just needs to come **before any provider whose `boot()` uses ORM models**:

```ts
export default [
  ...(await defaultProviders()),  // includes orm, auth, cache, queue, mail, etc.
  AppServiceProvider,             // your code — runs last so everything is ready
]
```

For the full mechanics — stages, dependencies, opt-out paths — see [Service Providers](/guide/service-providers).
