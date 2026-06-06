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

Never commit `.env`. Provide `.env.example` as a template for teammates — it's also the source of [typed `Env` keys](#typed-env) and what [`rudder env:sync`](#rudder-envsync) diffs your `.env` against.

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

### Typed Env

`Env.get('…')` autocompletes the keys your app declares — and a declared key's read is checked at the call site:

```ts
Env.get('DATABASE_URL')    // autocompleted from .env.example
Env.get('DATABASE_URI')    // typo — not rejected (loose overload), but throws
                           // "Missing environment variable" at first read
```

The keys come from **`.env.example`** — the committed contract of what your app expects — never from `.env` itself (secret, per-machine, absent in CI). `@rudderjs/vite`'s env scanner parses it on every dev/build and emits `.rudder/types/env.d.ts`:

```ts
// .rudder/types/env.d.ts — AUTO-GENERATED; commit it
declare module '@rudderjs/support' {
  interface EnvRegistry {
    'APP_NAME': string
    'DATABASE_URL': string
    'AUTH_SECRET': string
  }
}
```

Three rules worth knowing:

- **Commented-out keys are not declared.** `# OPENAI_API_KEY=` in the example is an optional suggestion, not contract — uncomment it to declare it.
- **Unknown keys don't error.** `Env.get()` keeps its loose `string` overload because framework packages read keys your app doesn't declare (`Env.get('REDIS_URL')`). Same softness as [`route()` names](/guide/typed-routes#limitations) and [typed `config()`](#typed-config). For a hard-rejecting wrapper: `const envStrict = <K extends keyof EnvRegistry & string>(key: K) => Env.get(key)`.
- **All values are typed `string`** — that's the runtime truth of `process.env`. Parse at the edge with `Env.getNumber` / `Env.getBool` / `defineEnv`.

### `rudder env:sync`

The same scan, on demand and with a second job — diffing your `.env` against the contract:

```bash
pnpm rudder env:sync         # regenerate env.d.ts + report drift
pnpm rudder env:sync --fix   # …and append missing keys to .env with their example values
```

A teammate adds `STRIPE_KEY` to `.env.example`, you pull, your `.env` silently lacks it — `env:sync` flags exactly that. `--fix` appends the missing lines (or creates `.env` wholesale from the example when you don't have one yet). Keys that exist only in your `.env` are reported but never deleted. Skip-boot, like `routes:sync` — works before the first `pnpm dev`.

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

## Typed `config()`

`config()` is fully typed against your own `config/` directory — dot-path keys autocomplete, and the return type is the actual shape of the value at that path:

```ts
import { config } from '@rudderjs/core'

const name = config('app.name')        // string — autocompleted, typed
const cors = config('server.cors')     // { origin: string; methods: string; headers: string }
const port = config('server.port')     // number
```

No codegen and no sync step — the types flow straight from `config/index.ts` through one ambient declaration. Scaffolded apps ship it as `env.d.ts` at the project root:

```ts
// env.d.ts
import type { Configs } from './config/index.js'

declare module '@rudderjs/core' {
  interface AppConfig extends Configs {}
}
```

with `config/index.ts` exporting its own shape alongside the default export:

```ts
// config/index.ts
const configs = { app, server, database, auth }
export type Configs = typeof configs
export default configs
```

Apps created before this template existed can paste the two snippets above — that's the entire migration. Editing a config file updates the types immediately; there is nothing to regenerate.

Two things to know about the edges:

- **Unknown keys don't error.** `config()` keeps a loose `config<T>(key: string)` overload, because framework packages read keys your app may not declare. A typo'd key falls through to it and returns `unknown` — which any concrete use of the value will surface as a type error. Same softness as [`route()` name lookups](/guide/typed-routes#limitations). If you want hard rejection inside your own app code, wrap it:

  ```ts
  import { config, type ConfigKey, type ConfigValue } from '@rudderjs/core'

  export const configStrict = <K extends ConfigKey>(key: K): ConfigValue<K> => config(key)

  configStrict('app.name')      // ✓
  configStrict('app.typo')      // tsc error — not a declared dot-path
  ```
- **Mismatched fallbacks degrade, they don't error.** `config('server.port', 3000)` matches the typed overload and returns `number`. `config('server.port', 'oops')` doesn't fail at the call site — it falls through to the loose overload and the return type follows the fallback, so the mismatch surfaces wherever the value is actually used as a number.

Typed `config()` joins [typed views](/guide/typed-views), [typed routes](/guide/typed-routes), [typed models](/guide/database#typed-models-from-migrations-schema-types), and [typed `Env`](#typed-env) — the same convention everywhere: declare the shape once where it lives, and every call site is checked.

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
