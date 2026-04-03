# Configuration

RudderJS uses three distinct configuration layers. Understanding which layer handles what prevents confusion and duplication.

## The Three Layers

| Layer | File(s) | Purpose |
|-------|---------|---------|
| **Environment** | `.env` | Secrets and environment-specific values |
| **Runtime config** | `config/*.ts` | Named, typed objects that read from `.env` |
| **Framework wiring** | `bootstrap/app.ts` | Server adapter, providers, routing loaders |

There is no `rudderjs.config.ts`. The `bootstrap/app.ts` file is where you wire the framework — the equivalent of Laravel's `bootstrap/app.php`.

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
import { Env } from '@rudderjs/core/support'

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
import { defineEnv } from '@rudderjs/core/support'
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

`config/index.ts` collects all config files into a single default export:

```ts
import app      from './app.js'
import server   from './server.js'
import database from './database.js'
import auth     from './auth.js'
import queue    from './queue.js'
import mail     from './mail.js'
import cache    from './cache.js'
import storage  from './storage.js'

export default { app, server, database, auth, queue, mail, cache, storage }
```

Then `bootstrap/app.ts` imports it as a single object:

```ts
import configs from '../config/index.ts'

Application.configure({
  server: hono(configs.server),
  config: configs,
  ...
})
```

Passing `config: configs` to `Application.configure()` binds each config object in the DI container, so you can retrieve it anywhere via:

```ts
import { app } from '@rudderjs/core'

const serverConfig = app().make<typeof configs.server>('config.server')
```

## Framework Wiring (`bootstrap/app.ts`)

This file wires the framework together. It should contain **only structural decisions** — not business logic or environment values.

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
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
| `web` | Web routes (redirects, server guards) — loaded lazily on first HTTP request |
| `api` | API routes — loaded lazily on first HTTP request |
| `commands` | Rudder commands — loaded at CLI boot |

### `.withMiddleware()`

Receives a middleware configurator. Register global middleware here:

```ts
.withMiddleware((m) => {
  m.use(new LoggerMiddleware().toHandler())
  m.use(RateLimit.perMinute(60).byIp().toHandler())
})
```

## Provider Boot Order

Providers boot in array order. Most framework providers (auth, queue, mail, cache, etc.) don't access the ORM during `boot()` — they only configure their own adapters. `DatabaseServiceProvider` just needs to appear **before `AppServiceProvider`** and any other provider whose `boot()` uses ORM models:

```ts
export default [
  prismaProvider(configs.database), // binds PrismaClient to DI as 'prisma'
  auth(configs.auth),               // auto-discovers 'prisma' from DI
  queue(configs.queue),
  mail(configs.mail),
  notifications(),                  // must come after mail()
  cache(configs.cache),
  DatabaseServiceProvider,          // sets ModelRegistry — must precede AppServiceProvider
  AppServiceProvider,               // may use ORM models during boot
]
```
