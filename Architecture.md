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
| HTTP server | Hono / Express / Fastify / H3 (developer's choice via adapter) |
| ORM | Prisma adapter / Drizzle adapter (swappable via `@forge/orm-prisma`) |
| Queues | Inngest (default) / BullMQ adapter |
| Validation | Zod with a Laravel-style Form Request wrapper |
| DI Container | Custom (inspired by tsyringe / InversifyJS — lighter) |

---

## Monorepo Structure

```
forge/
├── packages/
│   ├── core/               # Bootstrapper, Application, Forge, ServiceProvider, artisan registry
│   ├── router/             # Global router singleton + decorator-based routing
│   ├── di/                 # Service container / dependency injection
│   ├── orm/                # ORM contract + base Model + ModelRegistry
│   ├── orm-prisma/         # Prisma adapter (multi-driver: pg, libsql, default)
│   ├── orm-drizzle/        # Drizzle adapter (stub)
│   ├── server/             # ServerAdapter contract, HttpMethod, FetchHandler
│   ├── server-hono/        # Hono adapter (HonoConfig, unified logger, CORS)
│   ├── server-express/     # Express adapter (stub)
│   ├── server-fastify/     # Fastify adapter (stub)
│   ├── server-h3/          # H3 adapter (stub)
│   ├── middleware/         # Middleware pipeline + built-ins (CORS, Logger, Throttle)
│   ├── validation/         # FormRequest + Zod integration
│   ├── queue/              # Queue contract + Job base class
│   ├── queue-inngest/      # Inngest adapter
│   ├── queue-bullmq/       # BullMQ adapter ✅
│   ├── auth/               # Auth module (contracts scaffold — notImplemented stub)
│   ├── cli/                # Artisan-style CLI (make:*, module:*, user commands via artisan)
│   └── support/            # Helpers, Collection, Env, defineEnv, ConfigRepository
├── create-forge-app/       # CLI scaffolder (like create-next-app)
└── playground/             # Canonical demo app — primary integration reference
```

---

## Application Folder Structure (User's App)

```
my-app/
├── app/
│   ├── Models/                 # ORM models (extends Model)
│   │   ├── User.ts
│   │   └── Post.ts
│   ├── Services/               # Business logic
│   │   └── UserService.ts
│   ├── Providers/              # Service providers
│   │   ├── DatabaseServiceProvider.ts   # connects ORM, sets ModelRegistry
│   │   ├── AppServiceProvider.ts        # app bindings
│   │   └── AuthServiceProvider.ts       # gates, guards, policies
│   ├── Http/
│   │   ├── Controllers/        # Decorator-based controllers
│   │   ├── Middleware/         # Custom middleware
│   │   └── Requests/           # Form request / validation classes
│   └── Jobs/                   # Queue jobs
│
├── pages/                      # Vike file-based routing (SSR pages)
│   ├── index/
│   │   ├── +Page.tsx           # UI component
│   │   ├── +data.ts            # Server-side data loader
│   │   └── +config.ts          # Page config (layout, title, etc.)
│   └── users/
│       └── @id/
│           ├── +Page.tsx
│           └── +data.ts
│
├── routes/
│   ├── api.ts                  # HTTP routes (router.get/post/all) — side-effect file
│   └── console.ts              # Artisan commands (artisan.command()) — side-effect file
│
├── config/
│   ├── app.ts                  # APP_NAME, APP_ENV, APP_DEBUG
│   ├── server.ts               # PORT, CORS_ORIGIN, TRUST_PROXY
│   ├── database.ts             # DB_CONNECTION, DATABASE_URL
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
├── .env                        # DATABASE_URL, PORT, APP_* env vars
├── vite.config.ts              # Vite + Vike config (UI framework plugins)
├── tsconfig.json
└── package.json
```

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
export default [
  DatabaseServiceProvider,   // first — sets ModelRegistry for all models
  AppServiceProvider,
  AuthServiceProvider,
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

router.get('/api/users/:id', async (req, res) => {
  const user = await resolve(UserService).findById(req.params['id']!)
  if (!user) return res.status(404).json({ message: 'User not found.' })
  return res.json({ data: user })
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

artisan.command('inspire', () => {
  console.log('The best way to predict the future is to create it.')
}).description('Display an inspiring quote')

artisan.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com', role: 'admin' })
  console.log('Done.')
}).description('Seed the database with sample data')
```

Run with:
```bash
pnpm artisan inspire
pnpm artisan db:seed
pnpm artisan --help     # lists all built-in + user-defined commands
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

---

### ORM — Eloquent-style via Prisma

`prisma/schema.prisma`:
```prisma
model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  role      String   @default("user")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
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

`DatabaseServiceProvider` wires it all:
```ts
export class DatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const adapter = await prisma().create()  // reads DATABASE_URL from env
    await adapter.connect()
    ModelRegistry.set(adapter)               // makes Model.query() work everywhere
    this.app.instance('db', adapter)
  }
}
```

---

### Server Adapter

Developer picks the server in `bootstrap/app.ts`. Runtime config (port, CORS) lives in `config/server.ts`:

```ts
// config/server.ts
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

Available adapters: `hono()`, `express()` (stub), `fastify()` (stub), `h3()` (stub).

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
pnpm artisan module:publish --generate --migrate --name add_blog

# User-defined (from routes/console.ts)
pnpm artisan inspire
pnpm artisan db:seed
```

---

## Dependency Flow

```
@forge/support
      ↑
@forge/di
      ↑
@forge/core  ── (dynamic import) ──→ @forge/router
      │       ── (dynamic import) ──→ @forge/server
      │
      ↑ (used by providers in user apps)
@forge/router   @forge/middleware   @forge/orm        @forge/queue   @forge/validation
                                         ↑
                                   @forge/orm-prisma
                                   @forge/orm-drizzle
```

`@forge/core` uses dynamic `import('@forge/router')` inside `Forge._bootstrap()` to avoid a circular dependency (router and server must not depend on core).

---

## Roadmap

| Phase | Focus |
|-------|-------|
| **v0.1** | ✅ Core, DI, Router, CLI scaffold, Hono adapter, Vike SSR |
| **v0.2** | ✅ ORM (Prisma), Validation, Middleware, Queue (Inngest) |
| **v0.3** | ✅ Fluent bootstrap, artisan console routes, DB seeding, multi-provider |
| **v0.4** | Auth module (sessions, JWT, guards) — contracts scaffold in place |
| **v0.5** | Tests (node:test), Drizzle adapter; ✅ BullMQ adapter complete |
| **v0.6** | Vue + Solid adapters, create-forge-app CLI |
| **v1.0** | Docs site, public launch |
