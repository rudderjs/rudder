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
| Auth | Native (guards, providers, gates, policies) via `@rudderjs/auth` |
| Queues | BullMQ (default) / Inngest adapter |
| Validation | Zod with a Laravel-style Form Request wrapper |
| DI Container | Custom (inspired by tsyringe / InversifyJS — lighter, merged into core) |

---

## Monorepo Structure

```
rudderjs/
├── packages/               # 38 published packages (@rudderjs/*)
│   ├── contracts/          # Pure TypeScript types + runtime helpers
│   │                       #   AppRequest (typed input accessors), AppResponse, ServerAdapter,
│   │                       #   MiddlewareHandler, InputTypeError, attachInputAccessors
│   ├── support/            # Utilities: Env, Collection (30+ methods), Str (35+ helpers),
│   │                       #   Num (9 helpers), ConfigRepository, resolveOptionalPeer
│   ├── middleware/         # Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   │                       #   + RateLimit / RateLimitBuilder (cache-backed)
│   ├── validation/         # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── rudder/             # CommandRegistry, Command base class, parseSignature, rudder singleton
│   ├── core/               # App bootstrapper, ServiceProvider, Forge, AppBuilder, DI container
│   │                       #   HttpException, abort(), abort_if(), abort_unless(), report(),
│   │                       #   ExceptionHandler, EventDispatcher, dispatch()
│   │                       #   re-exports: di · support · contracts types · rudder
│   ├── router/             # Decorator + fluent routing, named routes, route() URL generation,
│   │                       #   Url class (HMAC-SHA256 signed URLs), ValidateSignature() middleware
│   ├── orm/                # Model base class, QueryBuilder, ModelRegistry
│   │                       #   Attribute casts (12 built-in + custom CastUsing), Attribute.make()
│   │                       #   accessors/mutators, @Hidden/@Visible/@Appends/@Cast decorators,
│   │                       #   JsonResource/ResourceCollection, ModelCollection, ModelFactory, sequence()
│   ├── orm-prisma/         # Prisma adapter (multi-driver: pg, libsql, default)
│   ├── orm-drizzle/        # Drizzle adapter (sqlite, postgresql, libsql)
│   ├── server-hono/        # Hono adapter (HonoConfig, unified logger [rudderjs], CORS)
│   ├── queue/              # Job, DispatchBuilder, SyncAdapter, queue:work/status/clear/failed/retry
│   │                       #   Chain.of() (sequential execution, state sharing), Bus.batch()
│   │                       #   (then/catch/finally, progress tracking), ShouldBeUnique (cache locks),
│   │                       #   job middleware (RateLimited, WithoutOverlapping, ThrottlesExceptions, Skip),
│   │                       #   dispatch(fn) queued closures
│   ├── queue-inngest/      # Inngest adapter — events: rudderjs/job.<ClassName>
│   ├── queue-bullmq/       # BullMQ adapter — default prefix: 'rudderjs'
│   ├── hash/               # Password hashing — Hash facade, BcryptDriver, Argon2Driver, hash() factory
│   ├── crypt/              # Symmetric encryption — Crypt facade, AES-256-CBC, parseKey(), crypt() factory
│   ├── auth/               # Native auth: Guards (SessionGuard), Providers (EloquentUserProvider),
│   │                       #   Auth facade, Gate/Policy authorization, PasswordBroker,
│   │                       #   AuthMiddleware(), RequireAuth(), MustVerifyEmail, EnsureEmailIsVerified(),
│   │                       #   verificationUrl(), handleEmailVerification()
│   ├── sanctum/            # API tokens — Sanctum class, TokenGuard, SanctumMiddleware(),
│   │                       #   RequireToken(), SHA-256 hashed tokens with abilities
│   ├── socialite/          # OAuth — Socialite facade, SocialUser, 4 built-in providers
│   │                       #   (GitHub, Google, Facebook, Apple), extensible
│   ├── session/            # HTTP session: SessionInstance, Session facade (AsyncLocalStorage)
│   │                       #   CookieDriver (HMAC-SHA256) + RedisDriver, SessionMiddleware() factory
│   ├── storage/            # Storage facade, LocalAdapter + S3Adapter (built-in)
│   │                       #   S3 driver needs optional dep: @aws-sdk/client-s3
│   ├── cache/              # Cache facade, MemoryAdapter + RedisAdapter (built-in)
│   │                       #   Redis driver needs optional dep: ioredis
│   ├── mail/               # Mailable, Mail facade, LogAdapter + SMTP (Nodemailer),
│   │                       #   FailoverAdapter (ordered mailer fallback), MarkdownMailable
│   │                       #   (markdown→responsive HTML, components: button/panel/table/header/footer),
│   │                       #   Mail.to().queue()/later() (queued via @rudderjs/queue),
│   │                       #   mailPreview() route handler, mail() factory
│   ├── schedule/           # Task scheduler — schedule singleton, schedule:run/work/list,
│   │                       #   sub-minute (everyFiveSeconds..everyThirtySeconds),
│   │                       #   hooks (before/after/onSuccess/onFailure), withoutOverlapping(),
│   │                       #   evenInMaintenanceMode(), onOneServer() (cache-backed lock)
│   ├── notification/       # Notifiable, Notification, ChannelRegistry, notify(),
│   │                       #   ShouldQueue (queued notifications), BroadcastChannel (WebSocket),
│   │                       #   AnonymousNotifiable, Notification.route() (on-demand)
│   ├── broadcast/          # WebSocket broadcasting — public, private, presence channels
│   ├── live/               # Real-time collaborative sync via Yjs CRDT — /ws-live endpoint
│   ├── panels/             # Admin panel builder — CRUD resources, schema elements, widgets,
│   │                       #   dashboard builder, AI chat sidebar, theming, Panel.use() plugins
│   ├── panels-lexical/     # Lexical rich-text editor adapter — RichContentField, block editor, collab
│   ├── ai/                 # AI engine — 4 providers (Anthropic, OpenAI, Google, Ollama), Agent class,
│   │                       #   tool system, streaming, middleware, structured output, model registry
│   ├── image/              # Fluent image processing — resize, crop, convert, optimize (wraps sharp)
│   ├── media/              # Media library — file browser, uploads, preview, image conversions
│   ├── workspaces/         # AI workspace canvas — 3D nodes, departments, connections, orchestrator
│   ├── log/                # Structured logging — channels (console, single, daily, stack, null),
│   │                       #   RFC 5424 levels, LineFormatter/JsonFormatter, context propagation,
│   │                       #   listeners, LogFake for testing, extendLog() for custom drivers
│   ├── http/               # Fluent HTTP client — Http facade, retries, timeouts,
│   │                       #   Pool.concurrency(), request/response interceptors,
│   │                       #   Http.fake() with URL pattern matching + assertions
│   ├── localization/       # i18n — trans(), setLocale(), locale middleware, JSON translation files
│   ├── testing/            # TestCase, TestResponse, RefreshDatabase, WithFaker, database assertions
│   ├── boost/              # AI developer tools — MCP server exposing project internals
│   └── cli/                # Rudder-style CLI (make:*, module:*, module:publish, user commands)
├── create-rudderjs-app/    # Interactive CLI scaffolder (pnpm create rudderjs-app)
│                           #   Prompts: name · DB · packages · Todo · frameworks · Tailwind · shadcn
├── docs/                   # VitePress documentation site
└── playground/             # Canonical demo app — primary integration reference
```

**Merged/removed packages** (code absorbed, originals deleted):
- `@rudderjs/di` → merged into `@rudderjs/core`
- `@rudderjs/rate-limit` → merged into `@rudderjs/middleware`
- `@rudderjs/storage-s3` → merged into `@rudderjs/storage`
- `@rudderjs/cache-redis` → merged into `@rudderjs/cache`
- `@rudderjs/mail-nodemailer` → merged into `@rudderjs/mail`
- `@rudderjs/events` → merged into `@rudderjs/core`
- `@rudderjs/dashboards` → merged into `@rudderjs/panels`

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
│   ├── Jobs/                   # Queue jobs
│   ├── Mail/                   # Mailable classes
│   └── Notifications/          # Notification classes
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
│   ├── app.ts                  # APP_NAME, APP_ENV, APP_DEBUG, APP_KEY
│   ├── server.ts               # PORT, CORS_ORIGIN, TRUST_PROXY
│   ├── database.ts             # DB_CONNECTION, DATABASE_URL
│   ├── auth.ts                 # Guards, providers, gates/policies config
│   ├── session.ts              # SESSION_DRIVER, SESSION_SECRET, cookie/redis options
│   ├── queue.ts                # Queue driver config
│   ├── mail.ts                 # Mailer config
│   ├── cache.ts                # Cache driver config
│   ├── storage.ts              # Storage disk config
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
RudderJS Framework
│
├─── Foundation Layer (zero deps)
│    ├── @rudderjs/contracts          Pure TypeScript types + runtime helpers
│    └── @rudderjs/support            Env, Collection, Str, Num, ConfigRepository
│
├─── Core Layer
│    ├── @rudderjs/middleware          Pipeline, CORS, Logger, Throttle, RateLimit
│    ├── @rudderjs/validation         FormRequest, validate(), Zod re-export
│    ├── @rudderjs/router             Decorator routing, route(), signed URLs
│    ├── @rudderjs/server-hono        Hono HTTP adapter, production WS upgrade
│    ├── @rudderjs/rudder             Command registry, base class
│    └── @rudderjs/core               Application, Container, ServiceProvider, Events
│         ├── DI: @Injectable, @Inject
│         ├── Errors: abort(), HttpException
│         └── Event.fake()
│
├─── Data Layer
│    ├── @rudderjs/orm                Model, QueryBuilder, casts, resources, factories
│    │    ├── @rudderjs/orm-prisma    Prisma adapter
│    │    └── @rudderjs/orm-drizzle   Drizzle adapter (sqlite, pg, libsql)
│    ├── @rudderjs/cache              Cache facade, Memory + Redis, Cache.fake()
│    ├── @rudderjs/session            Cookie + Redis session drivers
│    └── @rudderjs/queue              Job, dispatch, chains, batches, Queue.fake()
│         ├── @rudderjs/queue-bullmq  BullMQ adapter
│         └── @rudderjs/queue-inngest Inngest adapter
│
├─── Auth & Security
│    ├── @rudderjs/hash               Bcrypt, Argon2
│    ├── @rudderjs/crypt              AES-256-CBC encryption
│    ├── @rudderjs/auth               Guards, Providers, Gates, PasswordBroker
│    ├── @rudderjs/sanctum            API tokens, TokenGuard
│    └── @rudderjs/socialite          OAuth (GitHub, Google, Facebook, Apple)
│
├─── Communication
│    ├── @rudderjs/mail               Mailable, SMTP, Failover, Markdown, Mail.fake()
│    ├── @rudderjs/notification       Multi-channel, queued, Notification.fake()
│    ├── @rudderjs/broadcast          WebSocket channels (public, private, presence)
│    └── @rudderjs/live               Yjs CRDT real-time sync
│
├─── Utilities
│    ├── @rudderjs/log                Structured logging, channels, LogFake
│    ├── @rudderjs/http               Fluent fetch, retries, pools, Http.fake()
│    ├── @rudderjs/schedule           Cron tasks, sub-minute, hooks, onOneServer
│    ├── @rudderjs/localization       i18n, trans(), locale middleware
│    ├── @rudderjs/image              Image processing (sharp wrapper)
│    └── @rudderjs/storage            Local + S3 file storage
│
├─── AI
│    ├── @rudderjs/ai                 4 providers, Agent, tools, streaming, AiFake
│    └── @rudderjs/boost              MCP server for AI coding assistants
│
├─── Admin Panels
│    └── @rudderjs/panels             Panel builder, Resources, schema elements
│         ├── Schema: Field (20 types), Column, Section, Tabs, Form,
│         │           Table/List, Stats, Chart, Dashboard, Widget,
│         │           Wizard, Step, RelationManager, Import
│         ├── Filters: Select, Search, Date, Boolean, Number, Query
│         ├── Actions: Action (.form()), ActionGroup, headerActions
│         ├── AI: PanelAgent, chat sidebar, edit_text, run_agent
│         ├── Themes: 4 presets, colors, fonts, icons, themeEditor
│         ├── Real-time: Yjs collaboration, live tables, version history
│         ├── Notifications: Panel.notifications() widget
│         └── Plugins (via Panel.use())
│              ├── @rudderjs/panels-lexical    Rich text editor (Lexical)
│              ├── @rudderjs/media             Media library, file browser
│              └── @rudderjs/workspaces        AI workspace canvas
│
├─── Testing
│    └── @rudderjs/testing            TestCase, TestResponse, RefreshDatabase, WithFaker
│
├─── CLI
│    ├── @rudderjs/rudder             Command registry, base class
│    └── @rudderjs/cli                make:*, module:*, vendor:publish
│
├─── Scaffolding
│    └── create-rudderjs-app          Interactive project scaffolder
│
└─── Build
     └── @rudderjs/vite               Vike integration, SSR externals, WS patch
```

**Clean DAG — no cycles**: `@rudderjs/contracts` holds all shared types. `@rudderjs/router` and `@rudderjs/server-hono` depend only on contracts, not on core. `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer`. Never add `@rudderjs/core` to router's dependencies.

**AI separation**: `@rudderjs/ai` is a generic backend engine (no UI, no Prisma). All AI chat UI and panel-specific features live in `@rudderjs/panels`. Never add `@rudderjs/panels` as a dependency of `@rudderjs/ai`.

### Package Merge Policy (Tight-Coupling Only)

Merge packages only when they are effectively one runtime unit.

Checklist before merging:

1. **Always co-deployed**: both packages are always installed/booted together.
2. **Shared lifecycle**: they register/boot together and one has no meaningful standalone behavior.
3. **No adapter boundary**: package is not a plugin/driver integration surface.
4. **No portability boundary**: package is not optional due to runtime/environment constraints.
5. **Same release cadence**: they nearly always change together.
6. **Low blast radius**: merge does not force widespread import/dependency churn.

If any item fails, keep packages separate.

---

## Key Concepts

### Bootstrap — Laravel 11-style Fluent API

`bootstrap/app.ts` is the single wiring point for the whole application:

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'
import configs from '../config/index.ts'
import providers from './providers.ts'

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
  .withExceptions((_e) => {})
  .create()
```

`bootstrap/providers.ts`:
```ts
import { hash } from '@rudderjs/hash'
import { session } from '@rudderjs/session'
import { auth } from '@rudderjs/auth'
import { database } from '@rudderjs/orm-prisma'
import configs from '../config/index.ts'

export default [
  database(configs.database),  // first — sets ModelRegistry
  hash(configs.hash),          // bcrypt/argon2 hashing
  session(configs.session),    // session driver (cookie/redis)
  auth(configs.auth),          // guards, providers, gates, policies
  AppServiceProvider,
]
```

**Provider lifecycle:**
1. All `register()` methods run first (bind into container)
2. All `boot()` methods run after (can use container, call DB, etc.)

---

### Entry Point — WinterCG

`src/index.ts`:
```ts
import forge from '../bootstrap/app.ts'

export default {
  fetch: (request: Request, env?: unknown, ctx?: unknown) =>
    forge.handleRequest(request, env, ctx),
}
```

---

### HTTP Routes — `routes/api.ts`

```ts
import { router, route } from '@rudderjs/router'
import { resolve } from '@rudderjs/core'
import { UserService } from '../app/Services/UserService.js'

router.get('/api/users', async (_req, res) => {
  const users = await resolve(UserService).findAll()
  return res.json({ data: users })
}).name('users.index')

router.get('/api/users/:id', async (req, res) => {
  const user = await resolve(UserService).find(req.params.id)
  return res.json({ data: user })
}).name('users.show')

// URL generation from named routes
route('users.show', { id: 42 })  // → '/api/users/42'

// Catch-all
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
```

---

### Console Routes — `routes/console.ts`

```ts
import { rudder } from '@rudderjs/core'
import { User } from '../app/Models/User.js'

rudder.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com', role: 'admin' })
  console.log('Done.')
}).description('Seed the database with sample data')
```

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

---

### ORM — Eloquent-style

```ts
import { Model, Attribute } from '@rudderjs/orm'

export class User extends Model {
  static table    = 'users'
  static fillable = ['name', 'email', 'role']
  static hidden   = ['password']

  static casts = {
    isAdmin:   'boolean',
    createdAt: 'date',
    settings:  'json',
  } as const

  static attributes = {
    fullName: Attribute.make({
      get: (_, attrs) => `${attrs['firstName']} ${attrs['lastName']}`,
    }),
  }

  static appends = ['fullName']

  declare id: number
  declare name: string
  declare email: string
}
```

Usage:
```ts
const all     = await User.all()
const one     = await User.find(id)
const admins  = await User.where('role', 'admin').get()
const created = await User.create({ name: 'Diana', email: 'diana@example.com' })
const paged   = await User.query().paginate(1, 15)

// Instance serialization overrides
user.makeVisible(['password']).makeHidden(['email']).toJSON()
```

API Resources:
```ts
import { JsonResource } from '@rudderjs/orm'

class UserResource extends JsonResource<User> {
  toArray() {
    return {
      id:    this.resource.id,
      name:  this.resource.name,
      admin: this.when(this.resource.role === 'admin', true),
      posts: this.whenLoaded('posts'),
    }
  }
}

const response = await UserResource.collection(users).toResponse()
```

Model Factories:
```ts
import { ModelFactory, sequence } from '@rudderjs/orm'

class UserFactory extends ModelFactory<UserAttrs> {
  protected modelClass = User
  definition() {
    return { name: 'Alice', email: sequence(i => `user${i}@test.com`)(), role: 'user' }
  }
  protected states() {
    return { admin: () => ({ role: 'admin' }) }
  }
}

const users = await UserFactory.new().state('admin').create(5)
```

---

### Auth — Native (Guards, Providers, Gates, Policies)

```ts
import { Auth, Gate } from '@rudderjs/auth'

// Attempt login
await Auth.attempt({ email, password })

// Access authenticated user
const user = Auth.user()
const loggedIn = Auth.check()

// Middleware
Route.get('/api/me', handler, [AuthMiddleware()])       // sets req.user
Route.get('/api/profile', handler, [RequireAuth()])     // 401 if not authenticated
Route.get('/dashboard', handler, [EnsureEmailIsVerified()])  // 403 if unverified

// Gates & Policies
Gate.define('edit-post', (user, post) => user.id === post.authorId)
await Gate.authorize('edit-post', post)  // throws 403 if denied

// Email verification (signed URLs)
import { verificationUrl } from '@rudderjs/auth'
const url = verificationUrl(user)  // → '/email/verify/42/abc123?expires=...&signature=...'
```

---

### Queue / Jobs

```ts
import { Job, Chain, Bus, dispatch } from '@rudderjs/queue'

// Basic dispatch
await SendWelcomeEmail.dispatch(user).send()
await SendWelcomeEmail.dispatch(user).delay(5000).onQueue('emails').send()

// Job chaining — sequential execution with state sharing
await Chain.of([
  new ProcessUpload(fileId),
  new GenerateThumbnail(fileId),
  new NotifyUser(userId),
]).onFailure((err, job) => console.error('Failed at', job)).dispatch()

// Job batching — parallel with progress tracking
const batch = await Bus.batch([
  new SendEmail(user1),
  new SendEmail(user2),
]).then(b => console.log('Done!', b.progress)).dispatch()

// Queued closures
await dispatch(async () => { await sendWelcomeEmail(user) })

// Job middleware
class MyJob extends Job {
  middleware() { return [new RateLimited('api', 60), new WithoutOverlapping('import')] }
  async handle() { ... }
}
```

---

### Signed URLs

```ts
import { Url, ValidateSignature, route } from '@rudderjs/router'

// Named routes
router.get('/invoice/:id/download', handler, [ValidateSignature()])
  .name('invoice.download')

// Generate signed URL
Url.signedRoute('invoice.download', { id: 42 })
Url.temporarySignedRoute('invoice.download', 3600, { id: 42 })

// Validate
Url.isValidSignature(req)
```

---

### Mail

```ts
import { Mail, MarkdownMailable } from '@rudderjs/mail'

// Send immediately
await Mail.to('user@example.com').send(new WelcomeEmail(user))

// Queue for background sending
await Mail.to('user@example.com').queue(new WelcomeEmail(user))
await Mail.to('user@example.com').later(60_000, new WelcomeEmail(user))

// Markdown mail with components
class WelcomeEmail extends MarkdownMailable {
  build() {
    return this.subject('Welcome!').markdown(`
# Welcome, {{ name }}!

@component('button', { url: '{{ url }}' })
Get Started
@endcomponent
    `).with({ name: this.user.name, url: '/dashboard' })
  }
}

// Mail preview (dev only)
router.get('/mail-preview/welcome', mailPreview(() => new WelcomeEmail(sampleUser)))
```

Drivers: `log`, `smtp`, `failover` (ordered fallback).

---

### Notifications

```ts
import { notify, Notification, AnonymousNotifiable } from '@rudderjs/notification'

// Send to a user
await notify(user, new InvoiceNotification(invoice))

// On-demand (no stored user)
await notify(
  Notification.route('mail', 'visitor@example.com'),
  new OrderConfirmation(order),
)

// Queued notifications
class InvoiceNotification extends Notification implements ShouldQueue {
  shouldQueue = true as const
  queueDelay = 5000
  via() { return ['mail', 'database', 'broadcast'] }
}
```

Channels: `mail`, `database`, `broadcast`.

---

### Schedule

```ts
import { schedule } from '@rudderjs/schedule'

schedule.call(() => cleanupExpiredSessions())
  .everyHour()
  .before(() => console.log('Starting...'))
  .onSuccess(() => console.log('Done!'))
  .onFailure((err) => reportError(err))
  .withoutOverlapping()
  .onOneServer()
  .description('Cleanup expired sessions')

// Sub-minute scheduling
schedule.call(() => pollExternalApi())
  .everyFiveSeconds()
```

```bash
pnpm rudder schedule:run     # run due tasks once (cron entry point)
pnpm rudder schedule:work    # in-process loop
pnpm rudder schedule:list    # show all tasks
```

---

### Logging

```ts
import { Log } from '@rudderjs/log'

Log.info('User registered', { userId: user.id })
Log.error('Payment failed', { orderId, error: err.message })
Log.channel('slack').critical('Server down!')
```

Channels: `console`, `single`, `daily`, `stack`, `null`. LogFake for testing.

---

### HTTP Client

```ts
import { Http } from '@rudderjs/http'

const res = await Http.withToken(token).timeout(5000).retry(3).get('/api/users')
const users = res.json<User[]>()

// Concurrent pool
const results = await Http.pool(p => {
  p.add(http => http.get('/api/a'))
  p.add(http => http.get('/api/b'))
}).concurrency(2).send()

// Testing
const fake = Http.fake()
fake.register('api.example.com', { status: 200, body: { ok: true }, headers: {} })
fake.preventStrayRequests()
```

---

### Error Handling

```ts
import { abort, abort_if, abort_unless, report } from '@rudderjs/core'

abort(404, 'Not found')
abort_if(!user, 401, 'Unauthorized')
abort_unless(user.isAdmin, 403, 'Forbidden')
report(new Error('Something went wrong'))  // routes to log channel
```

---

### Cache / Storage / Session

```ts
// Cache
import { cache } from '@rudderjs/cache'
await cache().put('key', value, 300)
const hit = await cache().remember('key', 60, () => expensiveQuery())

// Storage
import { storage } from '@rudderjs/storage'
await storage().put('avatars/user-1.jpg', buffer)
const url = await storage().url('avatars/user-1.jpg')

// Session
import { Session } from '@rudderjs/session'
Session.put('visits', (Session.get<number>('visits') ?? 0) + 1)
Session.flash('success', 'Saved!')
```

---

### Middleware Patterns

All built-in middleware are **callable factory functions**:

```ts
import { RateLimit } from '@rudderjs/middleware'
import { AuthMiddleware, RequireAuth, EnsureEmailIsVerified } from '@rudderjs/auth'
import { SessionMiddleware } from '@rudderjs/session'
import { ValidateSignature } from '@rudderjs/router'

// Global
m.use(RateLimit.perMinute(60).toHandler())

// Per-route
router.get('/dashboard', handler, [RequireAuth(), EnsureEmailIsVerified()])
router.get('/invoice/:id', handler, [ValidateSignature()])
```

---

### CLI

```bash
# Scaffolding
pnpm rudder make:controller UserController
pnpm rudder make:model Post
pnpm rudder make:job SendWelcomeEmail
pnpm rudder make:request CreateUserRequest
pnpm rudder make:middleware AuthMiddleware
pnpm rudder make:provider PaymentServiceProvider
pnpm rudder make:module Blog

# Queue
pnpm rudder queue:work [queues=default]
pnpm rudder queue:status [queue=default]
pnpm rudder queue:clear [queue=default]
pnpm rudder queue:failed [queue=default]
pnpm rudder queue:retry [queue=default]

# Schedule
pnpm rudder schedule:run
pnpm rudder schedule:work
pnpm rudder schedule:list

# Storage
pnpm rudder storage:link

# Module
pnpm rudder module:publish
```

---

### Boost — AI Developer Tools

`@rudderjs/boost` exposes project internals to AI coding assistants via MCP.

```bash
rudder boost:mcp   # starts stdio MCP server
```

Tools: `app_info`, `db_schema`, `route_list`, `model_list`, `config_get`, `last_error`.

---

### Optional Peer Packages

Packages like `@rudderjs/queue-bullmq` are **optional peers** — loaded at runtime via `resolveOptionalPeer(specifier)` from `@rudderjs/core/support`. This helper:
1. Uses `createRequire` anchored to `process.cwd()/package.json` to resolve from the **user's app**
2. Returns `import(resolvedAbsolutePath)` — opaque to Rollup/Vite static analysis

All optional peer packages **must** include `"default": "./dist/index.js"` in their `exports` field.

---

## Roadmap Status

| Phase | Plan | Status |
|-------|------|--------|
| Phase 1 | Plan 1: Core DX Foundation (log, http, Str, Num, Collection, typed input, errors, URLs) | ✅ Complete |
| Phase 2 | Plan 2: ORM & Data Layer (casts, accessors, resources, factories, serialization) | ✅ Complete |
| Phase 2 | Plan 3: Queue & Scheduling (chains, batches, unique, middleware, sub-minute, hooks) | ✅ Complete |
| Phase 3 | Plan 4: Auth & Mail (email verification, queued mail, markdown, failover, queued notifications) | ✅ Complete |
| Phase 4 | Plan 5: Advanced Features (context, pennant, scoped/deferred/contextual bindings, process, concurrency) | ⬜ Next |
| Phase 4 | Plan 6: Testing Infrastructure (TestCase, Queue.fake, Mail.fake, Notification.fake, Event.fake, Cache.fake) | ✅ Complete |
| Phase 5 | Plan 7: Monitoring & Observability (Pulse, Telescope, Horizon, Nightwatch) | ⬜ Later |
| — | Panels Improvements (filters, actions, import, wizard, relations, notifications, handler refactoring) | ✅ Complete |
| — | Production Build Fixes (node:crypto, WS upgrade, vite externals) | ✅ Complete |
