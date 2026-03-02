# ⚡ Forge — Architecture Document
> A Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite.

---

## Philosophy

| Principle | Description |
|-----------|-------------|
| **Modular** | Every feature is an opt-in package. Core stays lean. |
| **Convention over config** | Sensible defaults, but fully escapable. |
| **Framework-agnostic UI** | React, Vue, Solid — first-class support for all via Vike. |
| **Fullstack-first** | Server and client code live together, co-located by feature. |
| **Laravel DX** | Familiar patterns: service container, Eloquent-style ORM, Artisan CLI, middleware, form requests. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build / Dev server | Vite |
| SSR / File routing | Vike |
| UI | React / Vue / Solid (via vike-react, vike-vue, vike-solid) |
| Language | TypeScript (strict, ESM, NodeNext) |
| Runtime | Node.js 20+ / Bun |
| HTTP server | Hono (default) / Express / Fastify / H3 (via adapter) |
| ORM | Prisma adapter / Drizzle adapter (swappable via `@forge/orm-prisma`) |
| Auth | better-auth (via `@forge/auth-better-auth`) |
| Queues | BullMQ (default) / Inngest adapter |
| Validation | Zod with a Laravel-style Form Request wrapper |
| DI Container | Custom (inspired by tsyringe / InversifyJS — lighter) |

---

## Monorepo Structure

```
forge/
├── packages/
│   ├── contracts/          # Pure TypeScript types — no runtime code (erased at build)
│   │                       #   ForgeRequest, ForgeResponse, ServerAdapter, MiddlewareHandler, etc.
│   ├── support/            # Utilities: Env, Collection, ConfigRepository, resolveOptionalPeer
│   │                       #   sideEffects: false — fully tree-shakeable
│   ├── di/                 # DI container: Container, @Injectable, @Inject, reflect-metadata
│   ├── middleware/         # Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   ├── validation/         # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── core/               # Bootstrapper, Application, Forge, ServiceProvider, artisan registry
│   │                       #   re-exports contracts · support · di · middleware · validation
│   ├── router/             # Global router singleton + decorator-based routing
│   ├── orm/                # ORM contract + base Model + ModelRegistry
│   ├── orm-prisma/         # Prisma adapter (multi-driver: pg, libsql, default)
│   ├── orm-drizzle/        # Drizzle adapter (stub)
│   ├── server-hono/        # Hono adapter (HonoConfig, unified logger, CORS)
│   ├── server-express/     # Express adapter (stub)
│   ├── server-fastify/     # Fastify adapter (stub)
│   ├── server-h3/          # H3 adapter (stub)
│   ├── queue/              # Queue contract + Job base class + queue:work artisan command
│   ├── queue-inngest/      # Inngest adapter
│   ├── queue-bullmq/       # BullMQ adapter ✅
│   ├── auth/               # Shared types: AuthUser, AuthSession, AuthResult
│   ├── auth-better-auth/   # better-auth adapter — betterAuth() factory, /api/auth/* mount
│   ├── storage/            # Storage facade, LocalAdapter, storage() factory, storage:link
│   ├── storage-s3/         # S3/R2/MinIO adapter (optional peer: @aws-sdk/client-s3)
│   ├── cache/              # Cache facade, MemoryAdapter, cache() factory
│   ├── cache-redis/        # Redis adapter (optional peer: ioredis)
│   ├── events/             # EventDispatcher, Listener interface, dispatch() helper
│   ├── mail/               # Mailable, Mail facade, LogAdapter, mail() factory
│   ├── mail-nodemailer/    # Nodemailer SMTP adapter (optional peer: nodemailer)
│   ├── schedule/           # Task scheduler — schedule singleton, schedule:run/work/list
│   ├── rate-limit/         # Cache-backed rate limiter — RateLimit.perMinute/Hour/Day
│   └── cli/                # Artisan-style CLI (make:*, module:*, user commands)
├── create-forge-app/       # Interactive CLI scaffolder (like create-next-app)
└── playground/             # Canonical demo app — primary integration reference
```

---

## Playground Dev Notes

Kill stale listeners before starting dev if you hit `EADDRINUSE`:

```bash
lsof -ti :24678 -ti :3000 | xargs kill -9
cd playground && pnpm dev
```

---

## Application Folder Structure (User's App)

```
my-app/
├── app/
│   ├── Models/                 # ORM models (extends Model)
│   │   └── User.ts
│   ├── Services/               # Business logic
│   │   └── UserService.ts
│   ├── Providers/              # Service providers
│   │   ├── DatabaseServiceProvider.ts   # connects ORM, sets ModelRegistry
│   │   └── AppServiceProvider.ts        # app bindings
│   ├── Http/
│   │   ├── Controllers/        # Decorator-based controllers
│   │   ├── Middleware/         # Custom middleware
│   │   └── Requests/           # Form request / validation classes
│   └── Jobs/                   # Queue jobs
│
├── pages/                      # Vike file-based routing (SSR pages)
│   ├── index/
│   │   ├── +Page.tsx
│   │   ├── +data.ts
│   │   └── +config.ts
│   └── users/@id/
│       ├── +Page.tsx
│       └── +data.ts
│
├── routes/
│   ├── api.ts                  # HTTP routes (router.get/post/all) — side-effect file
│   └── console.ts              # Artisan commands (artisan.command()) — side-effect file
│
├── config/
│   ├── app.ts                  # APP_NAME, APP_ENV, APP_DEBUG
│   ├── server.ts               # PORT, CORS_ORIGIN, TRUST_PROXY
│   ├── database.ts             # DB_CONNECTION, DATABASE_URL
│   ├── auth.ts                 # AUTH_SECRET, APP_URL, betterAuth config
│   ├── queue.ts                # Queue driver config
│   ├── mail.ts                 # Mailer config
│   └── index.ts                # Barrel re-export
│
├── bootstrap/
│   ├── app.ts                  # Application.configure()...create() — app wiring
│   └── providers.ts            # Default export: ordered providers array
│
├── prisma/
│   └── schema.prisma           # Prisma schema (SQLite / PostgreSQL / MySQL)
│
├── src/
│   └── index.ts                # WinterCG entry point — export default { fetch }
│
├── .env                        # DATABASE_URL, PORT, APP_*, AUTH_SECRET env vars
├── vite.config.ts              # Vite + Vike config (UI framework plugins)
├── tsconfig.json
└── package.json
```

---

## Dependency Flow

```
Level 1 (parallel — no framework deps):
  @forge/contracts   @forge/support   @forge/di
          │                │               │
          └────────────────┴───────────────┘
                           │
          ┌────────────────┼──────────────────────────┐
          ▼                ▼                          ▼
   @forge/router    @forge/middleware         @forge/server-hono
   @forge/validation @forge/rate-limit
          │
          └──────────────────┐
                             ▼
                      @forge/core (+ support + di + middleware + validation + router)
                             │
           ┌─────────────────┼──────────────────┐
           ▼                 ▼                  ▼
    @forge/queue       @forge/cache       @forge/orm
    @forge/mail        @forge/storage     @forge/events
    @forge/schedule    @forge/auth        @forge/validation
    @forge/auth-better-auth
           │
    orm-prisma   queue-bullmq   queue-inngest
    cache-redis  storage-s3     mail-nodemailer
```

**Clean DAG — no cycles**: `@forge/contracts` holds all shared types (`ForgeRequest`, `ForgeResponse`, `ServerAdapter`, `MiddlewareHandler`, `RouteDefinition`, `FetchHandler`). `@forge/router` and `@forge/server-hono` depend only on contracts, not on core — eliminating the former router↔core cycle entirely. `@forge/core` lists `@forge/router` as a regular dependency and imports it with a plain `await import('@forge/router')`. Turbo resolves the build order via the standard DAG: contracts/support/di first, then router + server-hono, then core, then everything else.

---

## Key Concepts

### Bootstrap — Laravel 11-style Fluent API

`bootstrap/app.ts` is the single wiring point for the whole application:

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),  // server adapter + runtime config
  config:    configs,               // all config/ files
  providers,                        // ordered provider array
})
  .withRouting({
    api:      () => import('../routes/api.ts'),      // loads HTTP routes
    commands: () => import('../routes/console.ts'),  // loads artisan commands
  })
  .withMiddleware((_m) => {
    // _m.use(new CorsMiddleware().toHandler())
  })
  .withExceptions((_e) => {})
  .create()                         // returns Forge instance
```

`bootstrap/providers.ts`:
```ts
import { betterAuth } from '@forge/auth-better-auth'
import configs from '../config/index.ts'

export default [
  DatabaseServiceProvider,   // first — sets ModelRegistry for all models
  betterAuth(configs.auth),  // mounts /api/auth/* before routes/api.ts loads
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
```

**Provider lifecycle:**
1. All `register()` methods run first (bind into container)
2. All `boot()` methods run after (can use container, call DB, etc.)

---

### Entry Point — WinterCG

`src/index.ts` is a single line — Forge bootstraps lazily on first request:
```ts
import forge from '../bootstrap/app.ts'

export default {
  fetch: (request: Request, env?: unknown, ctx?: unknown) =>
    forge.handleRequest(request, env, ctx),
}
```

---

### HTTP Routes — `routes/api.ts`

Side-effect file — just import and register, no exports needed:
```ts
import { router } from '@forge/router'
import { resolve } from '@forge/core'
import { UserService } from '../app/Services/UserService.js'

router.get('/api/users', async (_req, res) => {
  const users = await resolve(UserService).findAll()
  return res.json({ data: users })
})

router.post('/api/users', async (req, res) => {
  const user = await resolve(UserService).create(req.body)
  return res.status(201).json({ data: user })
})

// Catch-all: prevent unmatched /api/* from falling through to Vike
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
```

---

### Console Routes — `routes/console.ts`

Side-effect file — register artisan commands, no exports needed:
```ts
import { artisan } from '@forge/core'
import { User } from '../app/Models/User.js'

artisan.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com', role: 'admin' })
  console.log('Done.')
}).description('Seed the database with sample data')
```

The CLI boots the full app (`bootstrap/app.ts`) before running any command, so providers (DB connections, etc.) are available inside command handlers.

---

### Service Container / DI

```ts
// In a provider's register()
this.app.singleton(UserService, () => new UserService())
this.app.instance('db', adapter)

// In a controller / route (auto-resolved)
const svc = resolve(UserService)

// @Injectable auto-resolution
@Injectable()
export class UserService {
  constructor(private db: DatabaseAdapter) {}
}
```

Import from `@forge/core` or `@forge/core/di`.

---

### ORM — Eloquent-style via Prisma

`prisma/schema.prisma`:
```prisma
model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          String    @default("user")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
}
```

`app/Models/User.ts`:
```ts
import { Model } from '@forge/orm'

export class User extends Model {
  static table = 'user'   // matches Prisma's accessor (lowercase model name)
  id!: string; name!: string; email!: string; role!: string
  createdAt!: Date; updatedAt!: Date
}
```

Usage:
```ts
const all     = await User.all()
const one     = await User.find(id)
const admins  = await User.where('role', 'admin').get()
const created = await User.create({ name: 'Diana', email: 'diana@example.com' })
const paged   = await User.query().paginate(1, 15)
```

---

### Auth — better-auth

`@forge/auth-better-auth` wraps [better-auth](https://better-auth.com) as a `ServiceProvider`:

```ts
// config/auth.ts
export default {
  secret:           Env.get('AUTH_SECRET'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  database:         prismaClient,     // auto-wrapped with prismaAdapter
  databaseProvider: 'sqlite',
  emailAndPassword: { enabled: true },
} satisfies BetterAuthConfig
```

```ts
// bootstrap/providers.ts
import { betterAuth } from '@forge/auth-better-auth'
betterAuth(configs.auth)  // returns a ServiceProvider class
```

Mounts `/api/auth/*` — sign-up, sign-in, sign-out, session, etc. Auth is bound to DI as `'auth'`:
```ts
const auth = app().make<BetterAuthInstance>('auth')
const session = await auth.api.getSession({ headers: new Headers(req.headers) })
```

The provider must boot **before** `routes/api.ts` loads (place it before `AppServiceProvider` in `providers.ts`) so `/api/auth/*` routes are registered first and match before any `/api/*` catch-all.

---

### Server Adapter

Developer picks the server in `bootstrap/app.ts`. Runtime config (port, CORS) lives in `config/server.ts`:

```ts
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

Available adapters: `hono()` ✅, `express()` (stub), `fastify()` (stub), `h3()` (stub).

The Hono adapter includes:
- Unified request logger with ANSI colors (`[forge]` tag)
- Automatic CORS middleware when `cors` config is set
- Vike's HTTP log suppression (no duplicate lines)

---

### Validation / Form Requests

```ts
export class CreateUserRequest extends FormRequest {
  rules() {
    return z.object({
      name:  z.string().min(2),
      email: z.string().email(),
    })
  }
}

// Inline validation
const data = await validate(z.object({ name: z.string() }), req)
```

Import from `@forge/core` or `@forge/core/validation`.

---

### Queue / Jobs

```ts
export class SendWelcomeEmail extends Job {
  constructor(public user: User) { super() }
  async handle() { /* send email */ }
}

await SendWelcomeEmail.dispatch(user).send()
await SendWelcomeEmail.dispatch(user).delay(5000).onQueue('emails').send()
```

Supported adapters: **BullMQ** (Redis-backed, `queue:work` artisan command) and **Inngest** (serverless).

Worker lifecycle with BullMQ:
```bash
pnpm artisan queue:work            # start BullMQ worker (graceful shutdown on SIGTERM/SIGINT)
```

---

### Cache

```ts
import { cache } from '@forge/cache'

await cache().put('key', value, 300)   // TTL in seconds
const hit = await cache().get('key')
await cache().forget('key')
await cache().remember('key', 60, () => expensiveQuery())
```

Drivers: `memory` (built-in, default) and `redis` (via `@forge/cache-redis` optional peer).

---

### Storage

```ts
import { storage } from '@forge/storage'

await storage().put('avatars/user-1.jpg', buffer)
const url  = await storage().url('avatars/user-1.jpg')
const file = await storage().get('avatars/user-1.jpg')
await storage().delete('avatars/user-1.jpg')
```

Drivers: `local` (built-in, default) and `s3` (via `@forge/storage-s3` optional peer — supports S3, R2, MinIO).

```bash
pnpm artisan storage:link    # creates public/storage symlink → storage/app/public
```

---

### Events

```ts
import { dispatch, events } from '@forge/events'

// Register a listener
events().listen('user.registered', async (payload) => {
  console.log('New user:', payload.user.email)
})

// Dispatch
await dispatch('user.registered', { user })
```

---

### Mail

```ts
import { mail } from '@forge/mail'

await mail().send({
  to:      'user@example.com',
  subject: 'Welcome!',
  html:    '<h1>Hello</h1>',
})
```

Drivers: `log` (built-in, prints to console — great for dev) and `smtp` (via `@forge/mail-nodemailer` optional peer).

---

### Schedule

```ts
import { schedule } from '@forge/schedule'

schedule().call(() => cleanupExpiredSessions())
  .everyHour()
  .description('Cleanup expired sessions')

schedule().command('db:seed')
  .dailyAt('02:00')
```

```bash
pnpm artisan schedule:run     # run due tasks once (good for cron)
pnpm artisan schedule:work    # run loop (process.cwd, 60s interval)
pnpm artisan schedule:list    # show all scheduled tasks
```

---

### Rate Limiting

```ts
import { RateLimit } from '@forge/rate-limit'

const apiLimit = RateLimit.perMinute(60)
  .by(req => req.headers['x-forwarded-for'] ?? 'unknown')
  .message('Too many requests.')
  .toHandler()

router.use('*', apiLimit)
```

Uses the configured cache driver under the hood. Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.

---

### CLI (pnpm artisan — like Artisan)

```bash
# Scaffolding
pnpm artisan make:controller UserController
pnpm artisan make:model Post
pnpm artisan make:job SendWelcomeEmail
pnpm artisan make:request CreateUserRequest
pnpm artisan make:middleware AuthMiddleware
pnpm artisan make:provider PaymentServiceProvider
pnpm artisan make:module Blog         # full module scaffold

# Module Prisma shards
pnpm artisan module:publish           # merge *.prisma into prisma/schema.prisma

# Queue
pnpm artisan queue:work

# Schedule
pnpm artisan schedule:run
pnpm artisan schedule:work
pnpm artisan schedule:list

# Storage
pnpm artisan storage:link

# User-defined (from routes/console.ts)
pnpm artisan db:seed
```

---

### Optional Peer Packages

Packages like `@forge/queue-bullmq`, `@forge/cache-redis`, `@forge/storage-s3`, `@forge/mail-nodemailer` are **optional peers** — the user installs only what they need.

They are loaded at runtime via `resolveOptionalPeer(specifier)` from `@forge/core/support`. This helper:
1. Uses `createRequire` anchored to `process.cwd()/package.json` to resolve the package from the **user's app**, not from inside `node_modules/@forge/*`
2. Returns `import(resolvedAbsolutePath)` — an absolute path import that is opaque to Rollup/Vite static analysis

All optional peer packages **must** include `"default": "./dist/index.js"` in their `exports` field — the CJS resolver used by `createRequire.resolve()` cannot see `"import"`-only entries.

---

## Roadmap

| Phase | Focus |
|-------|-------|
| **v0.1** | ✅ Core, DI, Router, CLI scaffold, Hono adapter, Vike SSR |
| **v0.2** | ✅ ORM (Prisma), Validation, Middleware, Queue (Inngest) |
| **v0.3** | ✅ Fluent bootstrap, artisan console routes, DB seeding, multi-provider |
| **v0.4** | ✅ Auth (better-auth), Storage (S3), Cache (Redis), Events, Mail, Schedule, Rate Limiting, BullMQ |
| **v0.5** | ✅ Package consolidation — support/di/server/middleware/validation merged into @forge/core subpaths; create-forge-app scaffolder |
| **v0.6** | `@forge/notification` — multi-channel notifications (mail, database) |
| **v0.7** | Drizzle adapter, BullMQ improvements, Vue + Solid adapters |
| **v1.0** | Docs site, npm publish, public launch |
