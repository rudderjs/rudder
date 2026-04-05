# ⚡ RudderJS — Architecture Document
> A Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite.

---

## Philosophy

| Principle | Description |
|-----------|-------------|
| **Modular** | Every feature is an opt-in package. Core stays lean. |
| **Convention over config** | Sensible defaults, but fully escapable. |
| **Framework-agnostic UI** | React, Vue, Solid — first-class support for all via Vike. |
| **Fullstack-first** | Server and client code live together, co-located by feature. |
| **Laravel DX** | Familiar patterns: service container, Eloquent-style ORM, Rudder CLI, middleware, form requests. |

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
| ORM | Prisma adapter / Drizzle adapter (swappable via `@rudderjs/orm-prisma`) |
| Auth | better-auth (via `@rudderjs/auth`) |
| Queues | BullMQ (default) / Inngest adapter |
| Validation | Zod with a Laravel-style Form Request wrapper |
| DI Container | Custom (inspired by tsyringe / InversifyJS — lighter) |

---

## Monorepo Structure

```
rudderjs/
├── packages/               # 31 published packages (@rudderjs/*)
│   ├── contracts/          # Pure TypeScript types — no runtime code (erased at build)
│   │                       #   ForgeRequest, ForgeResponse, ServerAdapter, MiddlewareHandler, etc.
│   ├── support/            # Utilities: Env, Collection, ConfigRepository, resolveOptionalPeer
│   │                       #   sideEffects: false — fully tree-shakeable
│   ├── di/                 # DI container: Container, @Injectable, @Inject, reflect-metadata
│   ├── middleware/         # Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   │                       #   + RateLimit callable handler (cache-backed), CsrfMiddleware() factory
│   ├── validation/         # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── core/               # Bootstrapper, Application, Forge, ServiceProvider, rudder registry
│   │                       #   re-exports contracts · support · di · middleware · validation
│   ├── router/             # Global router singleton + decorator-based routing
│   ├── orm/                # ORM contract + base Model + ModelRegistry
│   ├── orm-prisma/         # Prisma adapter (multi-driver: pg, libsql, default)
│   ├── orm-drizzle/        # Drizzle adapter (sqlite, postgresql, libsql)
│   ├── server-hono/        # Hono adapter (HonoConfig, unified logger [rudderjs], CORS)
│   ├── queue/              # Queue contract + Job base class + queue:work rudder command
│   ├── queue-inngest/      # Inngest adapter — events: rudderjs/job.<ClassName>
│   ├── queue-bullmq/       # BullMQ adapter — default prefix: 'rudderjs'
│   ├── auth/               # AuthUser/Session/Result types + betterAuth() factory + AuthMiddleware()
│   │                       #   (merged from auth-better-auth — single package)
│   ├── session/            # HTTP session: SessionInstance, Session facade (AsyncLocalStorage)
│   │                       #   CookieDriver (HMAC-SHA256) + RedisDriver, SessionMiddleware() factory
│   ├── storage/            # Storage facade, LocalAdapter + S3Adapter (built-in)
│   │                       #   S3 driver needs optional dep: @aws-sdk/client-s3
│   ├── cache/              # Cache facade, MemoryAdapter + RedisAdapter (built-in)
│   │                       #   Redis driver needs optional dep: ioredis
│   ├── events/             # EventDispatcher, Listener interface, dispatch() helper
│   ├── mail/               # Mailable, Mail facade, LogAdapter, mail() factory
│   ├── mail-nodemailer/    # Nodemailer SMTP adapter
│   ├── schedule/           # Task scheduler — schedule singleton, schedule:run/work/list
│   ├── notification/       # Multi-channel notifications (mail, database)
│   ├── panels/             # Admin panel builder — CRUD resources, schema elements, widgets, dashboard builder
│   │                       #   AI chat sidebar: conversation persistence (Prisma), model selection,
│   │                       #   resource agents, conversation switcher, auto-title, resource context pill
│   ├── panels-lexical/     # Lexical rich-text editor adapter — RichContentField, block editor, collab
│   ├── ai/                 # AI engine — 4 providers (Anthropic, OpenAI, Google, Ollama), Agent class,
│   │                       #   tool system, streaming, middleware, structured output, model registry
│   ├── broadcast/          # WebSocket broadcasting — public, private, presence channels
│   ├── live/               # Real-time collaborative sync via Yjs CRDT — /ws-live endpoint
│   ├── image/              # Fluent image processing — resize, crop, convert, optimize (wraps sharp)
│   ├── media/              # Media library — file browser, uploads, preview, image conversions
│   ├── workspaces/         # AI workspace canvas — 3D nodes, departments, connections, orchestrator
│   ├── localization/       # i18n — trans(), setLocale(), locale middleware, JSON translation files
│   └── cli/                # Rudder-style CLI (make:*, module:*, user commands)
├── create-rudderjs-app/    # Interactive CLI scaffolder (pnpm create rudderjs-app)
│                           #   Prompts: name · DB · Todo · frameworks (React/Vue/Solid)
│                           #           primary framework · Tailwind · shadcn/ui
├── docs/                   # VitePress documentation site
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
│   └── console.ts              # Rudder commands (rudder.command()) — side-effect file
│
├── config/
│   ├── app.ts                  # APP_NAME, APP_ENV, APP_DEBUG
│   ├── server.ts               # PORT, CORS_ORIGIN, TRUST_PROXY
│   ├── database.ts             # DB_CONNECTION, DATABASE_URL
│   ├── auth.ts                 # AUTH_SECRET, APP_URL, betterAuth config
│   ├── session.ts              # SESSION_DRIVER, SESSION_SECRET, cookie/redis options
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
  @rudderjs/contracts   @rudderjs/support
          │                │               │
          └────────────────┴───────────────┘
                           │
          ┌────────────────┼──────────────────────────┐
          ▼                ▼                          ▼
   @rudderjs/router    @rudderjs/middleware         @rudderjs/server-hono
   @rudderjs/validation @rudderjs/middleware
          │
          └──────────────────┐
                             ▼
                      @rudderjs/core (+ support + di + middleware + validation + router)
                             │
           ┌─────────────────┼──────────────────┐
           ▼                 ▼                  ▼
    @rudderjs/queue       @rudderjs/cache       @rudderjs/orm
    @rudderjs/mail        @rudderjs/storage
    @rudderjs/schedule    @rudderjs/auth        @rudderjs/validation
           │
    orm-prisma   queue-bullmq   queue-inngest
    mail-nodemailer
           │
    @rudderjs/panels      @rudderjs/ai
    (orm, auth, storage)  (4 providers, Agent, tools, streaming)
           │                     │
    @rudderjs/panels-lexical     @rudderjs/workspaces (Panel.use plugin, uses ai)
    @rudderjs/media (Panel.use plugin)

    @rudderjs/broadcast   @rudderjs/live (Yjs CRDT)
    @rudderjs/image       @rudderjs/localization
```

**Clean DAG — no cycles**: `@rudderjs/contracts` holds all shared types (`ForgeRequest`, `ForgeResponse`, `ServerAdapter`, `MiddlewareHandler`, `RouteDefinition`, `FetchHandler`). `@rudderjs/router` and `@rudderjs/server-hono` depend only on contracts, not on core — eliminating the former router↔core cycle entirely. `@rudderjs/core` lists `@rudderjs/router` as a regular dependency and imports it with a plain `await import('@rudderjs/router')`. Turbo resolves the build order via the standard DAG: contracts/support/di first, then router + server-hono, then core, then everything else.

**AI separation**: `@rudderjs/ai` is a generic backend engine (no UI, no Prisma). All AI chat UI, conversation Prisma models, and panel-specific features live in `@rudderjs/panels`. Never add `@rudderjs/panels` as a dependency of `@rudderjs/ai`.

### Package Merge Policy (Tight-Coupling Only)

Merge packages only when they are effectively one runtime unit.

Use this checklist before any merge:

1. **Always co-deployed**: both packages are always installed/booted together in real apps.
2. **Shared lifecycle**: they register/boot together and one has no useful standalone runtime behavior.
3. **No adapter boundary**: package is not an integration boundary for multiple drivers/backends.
4. **No portability boundary**: package is not optional due to environment/runtime constraints.
5. **Same release cadence**: changes almost always land together, with no independent versioning value.
6. **Low blast radius**: merge will not force most consumers to change imports/dependencies.

If any checklist item fails, keep the package separate.

---

## Key Concepts

### Bootstrap — Laravel 11-style Fluent API

`bootstrap/app.ts` is the single wiring point for the whole application:

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),  // server adapter + runtime config
  config:    configs,               // all config/ files
  providers,                        // ordered provider array
})
  .withRouting({
    web:      () => import('../routes/web.ts'),       // page + web form routes
    api:      () => import('../routes/api.ts'),       // JSON API routes
    commands: () => import('../routes/console.ts'),   // rudder commands
  })
  .withMiddleware((m) => {
    // Truly global middleware — applies to all requests (web + API)
    m.use(RateLimit.perMinute(60))
    m.use(requestIdMiddleware)
  })
  .withExceptions((_e) => {})
  .create()                         // returns Forge instance
```

`bootstrap/providers.ts`:
```ts
import { betterAuth } from '@rudderjs/auth'
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
import { router } from '@rudderjs/router'
import { resolve } from '@rudderjs/core'
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

Side-effect file — register rudder commands, no exports needed:
```ts
import { rudder } from '@rudderjs/core'
import { User } from '../app/Models/User.js'

rudder.command('db:seed', async () => {
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

Import from `@rudderjs/core` or `@rudderjs/core/di`.

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
import { Model } from '@rudderjs/orm'

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

`@rudderjs/auth` wraps [better-auth](https://better-auth.com) as a `ServiceProvider`:

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
import { betterAuth } from '@rudderjs/auth'
betterAuth(configs.auth)  // returns a ServiceProvider class
```

Mounts `/api/auth/*` — sign-up, sign-in, sign-out, session, etc. Auth is bound to DI as `'auth'`:
```ts
const auth = app().make<BetterAuthInstance>('auth')
const session = await auth.api.getSession({ headers: new Headers(req.headers) })
```

The provider must boot **before** `routes/api.ts` loads (place it before `AppServiceProvider` in `providers.ts`) so `/api/auth/*` routes are registered first and match before any `/api/*` catch-all.

`AuthMiddleware()` from `@rudderjs/auth` is a zero-config factory — it reads the `auth` binding from the DI container and uses `auth.api.getSession()` for real session verification:
```ts
import { AuthMiddleware } from '@rudderjs/auth'
const authMw = AuthMiddleware()
Route.get('/api/me', handler, [authMw])  // req.user: AuthUser | undefined
```

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

Available adapter: `hono()` ✅

The Hono adapter includes:
- Unified request logger with ANSI colors (`[rudderjs]` tag)
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

Import from `@rudderjs/core` or `@rudderjs/core/validation`.

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

Supported adapters: **BullMQ** (Redis-backed, `queue:work` rudder command) and **Inngest** (serverless).

Worker lifecycle with BullMQ:
```bash
pnpm rudder queue:work            # start BullMQ worker (graceful shutdown on SIGTERM/SIGINT)
```

---

### Cache

```ts
import { cache } from '@rudderjs/cache'

await cache().put('key', value, 300)   // TTL in seconds
const hit = await cache().get('key')
await cache().forget('key')
await cache().remember('key', 60, () => expensiveQuery())
```

Drivers: `memory` (built-in, default) and `redis` (built-in — install `ioredis` to use Redis).

---

### Storage

```ts
import { storage } from '@rudderjs/storage'

await storage().put('avatars/user-1.jpg', buffer)
const url  = await storage().url('avatars/user-1.jpg')
const file = await storage().get('avatars/user-1.jpg')
await storage().delete('avatars/user-1.jpg')
```

Drivers: `local` (built-in, default) and `s3` (built-in — supports AWS S3, Cloudflare R2, MinIO). Install `@aws-sdk/client-s3` to use S3 disks.

```bash
pnpm rudder storage:link    # creates public/storage symlink → storage/app/public
```

---

### Events

```ts
import { dispatch, events } from '@rudderjs/core'

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
import { mail } from '@rudderjs/mail'

await mail().send({
  to:      'user@example.com',
  subject: 'Welcome!',
  html:    '<h1>Hello</h1>',
})
```

Drivers: `log` (built-in, prints to console — great for dev) and `smtp` (built-in adapter; requires optional `nodemailer` dependency).

---

### Schedule

```ts
import { schedule } from '@rudderjs/schedule'

schedule().call(() => cleanupExpiredSessions())
  .everyHour()
  .description('Cleanup expired sessions')

schedule().command('db:seed')
  .dailyAt('02:00')
```

```bash
pnpm rudder schedule:run     # run due tasks once (good for cron)
pnpm rudder schedule:work    # run loop (process.cwd, 60s interval)
pnpm rudder schedule:list    # show all scheduled tasks
```

---

### Middleware Patterns

All built-in middleware are **callable factory functions** — no `new` keyword, no `.toHandler()`:

```ts
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { AuthMiddleware } from '@rudderjs/auth'
import { SessionMiddleware } from '@rudderjs/session'

// Global (bootstrap/app.ts)
m.use(RateLimit.perMinute(60))

// Web routes (routes/web.ts) — session + CSRF like Laravel's 'web' group
const webMw = [SessionMiddleware(), CsrfMiddleware()]
Route.get('/dashboard', handler, webMw)

// Protected API routes
const authMw = AuthMiddleware()
Route.get('/api/me', handler, [authMw])

// Per-route rate limit with custom key
const authLimit = RateLimit.perMinute(10)
  .by(req => `${req.headers['x-forwarded-for']}:${req.path}`)
  .message('Too many auth attempts.')
Route.post('/api/login', handler, [authLimit])
```

**`RateLimit`** uses the configured cache driver. Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` response headers. Global + per-route limits stack independently (each has its own counter).

**`SessionMiddleware()`** reads config from `'session.config'` in the DI container (registered by the `session()` provider). Sets `req.session` and the `Session` facade via `AsyncLocalStorage`.

**`CsrfMiddleware()`** validates the `X-CSRF-Token` header on mutating requests (`POST/PUT/PATCH/DELETE`). Token is stored in the session.

**`AuthMiddleware()`** calls `auth.api.getSession()` via better-auth and sets `req.user: AuthUser | undefined`. Returns `401` if no valid session exists.

### Session

```ts
import { Session } from '@rudderjs/session'

// Via facade (ALS-based — works anywhere in the call stack)
Session.put('visits', (Session.get<number>('visits') ?? 0) + 1)
Session.flash('success', 'Saved!')

// Via req.session (type-safe on AppRequest)
req.session.get<string>('user_id')
req.session.put('cart', items)
```

Drivers: `cookie` (HMAC-SHA256 signed, default) and `redis` (UUID session ID, needs `ioredis`).

---

### CLI (pnpm rudder — like Rudder)

```bash
# Scaffolding
pnpm rudder make:controller UserController
pnpm rudder make:model Post
pnpm rudder make:job SendWelcomeEmail
pnpm rudder make:request CreateUserRequest
pnpm rudder make:middleware AuthMiddleware
pnpm rudder make:provider PaymentServiceProvider
pnpm rudder make:module Blog         # full module scaffold

# Module Prisma shards
pnpm rudder module:publish           # merge *.prisma into prisma/schema.prisma

# Queue
pnpm rudder queue:work

# Schedule
pnpm rudder schedule:run
pnpm rudder schedule:work
pnpm rudder schedule:list

# Storage
pnpm rudder storage:link

# User-defined (from routes/console.ts)
pnpm rudder db:seed
```

---

### Optional Peer Packages

Packages like `@rudderjs/queue-bullmq` are **optional peers** — the user installs only what they need.

They are loaded at runtime via `resolveOptionalPeer(specifier)` from `@rudderjs/core/support`. This helper:
1. Uses `createRequire` anchored to `process.cwd()/package.json` to resolve the package from the **user's app**, not from inside `node_modules/@rudderjs/*`
2. Returns `import(resolvedAbsolutePath)` — an absolute path import that is opaque to Rollup/Vite static analysis

All optional peer packages **must** include `"default": "./dist/index.js"` in their `exports` field — the CJS resolver used by `createRequire.resolve()` cannot see `"import"`-only entries.

---

## Roadmap

| Phase | Focus |
|-------|-------|
| **v0.1** | ✅ Core, DI, Router, CLI scaffold, Hono adapter, Vike SSR |
| **v0.2** | ✅ ORM (Prisma), Validation, Middleware, Queue (Inngest) |
| **v0.3** | ✅ Fluent bootstrap, rudder console routes, DB seeding, multi-provider |
| **v0.4** | ✅ Auth (better-auth), Storage (S3), Cache (Redis), Events, Mail, Schedule, Rate Limiting, BullMQ |
| **v0.5** | ✅ Package consolidation — create-rudderjs-app scaffolder, notifications, Drizzle adapter |
| **v0.6** | ✅ Rename Forge → RudderJS, npm publish (25 packages), package merges, docs site, README |
| **v0.7** | ✅ Session package, AuthMiddleware, callable middleware (no .toHandler()), rudder test suite |
| **v0.8** | ✅ create-rudderjs-app multi-framework scaffolder (React/Vue/Solid, Tailwind, shadcn/ui) |
| **v1.0** | Deploy docs, GitHub Actions CI, stable API |
