# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

---

## Project Overview

**Forge** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It aims to bring Laravel's developer experience (DI container, Eloquent-style ORM, Artisan CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@boostkit/*`
- **Status**: Early development (v0.0.1)

---

## Commands

All commands run from the **repo root**:

```bash
pnpm build        # Build all packages via Turbo
pnpm dev          # Watch mode for all packages
pnpm typecheck    # Type-check all packages
pnpm clean        # Remove all dist/ directories
```

Working on a single package:
```bash
cd packages/core
pnpm build        # tsc
pnpm dev          # tsc --watch
pnpm typecheck    # tsc --noEmit
```

Running the playground (demo app):
```bash
cd playground
pnpm dev          # vike dev (Vite + SSR)
pnpm artisan      # Forge CLI (tsx node_modules/@boostkit/cli/src/index.ts)
```

> Always run `pnpm build` from root before `pnpm dev` in playground — packages must be compiled first.

Prisma (run from `playground/`):
```bash
pnpm exec prisma generate       # Regenerate client after schema changes
pnpm exec prisma db push        # Sync schema → DB (dev, no migrations)
pnpm exec prisma migrate dev    # Create a migration
pnpm artisan db:seed            # Seed via artisan command
```

---

## Monorepo Layout

```
forge/
├── packages/           # Core framework packages (@boostkit/*)
│   ├── contracts/      # Pure TypeScript types: ForgeRequest, ServerAdapter, MiddlewareHandler, etc.
│   ├── support/        # Utilities: Env, Collection, ConfigRepository, resolveOptionalPeer, helpers
│   ├── di/             # DI container: Container, @Injectable, @Inject
│   ├── middleware/     # Middleware base class, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   ├── validation/     # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── artisan/        # ArtisanRegistry, Command base class, parseSignature, artisan singleton
│   ├── core/           # App bootstrapper, ServiceProvider, Forge, AppBuilder
│   │                   #   re-exports: di · support · contracts types · artisan
│   ├── router/         # Decorator routing + global router singleton
│   ├── orm/            # ORM contract/interface + Model base class
│   ├── orm-prisma/     # Prisma adapter (multi-driver)
│   ├── orm-drizzle/    # Drizzle adapter (multi-driver: sqlite, postgresql, libsql)
│   ├── queue/          # Queue contract/interface + queue:work artisan command
│   ├── queue-inngest/  # Inngest adapter
│   ├── queue-bullmq/   # BullMQ adapter ✅
│   ├── server-hono/    # Hono adapter ✅ (HonoConfig, logger, CORS)
│   ├── server-express/ # Express adapter (stub)
│   ├── server-fastify/ # Fastify adapter (stub)
│   ├── server-h3/      # H3 adapter (stub)
│   ├── auth/           # Auth module — shared types (AuthUser, AuthSession, AuthResult)
│   ├── auth-better-auth/ # better-auth adapter — betterAuth() factory, prismaAdapter wiring
│   ├── storage/        # Storage facade, LocalAdapter (built-in), storage() factory, storage:link
│   ├── storage-s3/     # S3 adapter via @aws-sdk/client-s3 (optional peer)
│   ├── schedule/       # Task scheduler — schedule singleton, scheduler() factory, schedule:run/work/list
│   ├── cache/          # Cache facade, MemoryAdapter (built-in), cache() factory
│   ├── cache-redis/    # Redis adapter via ioredis (optional peer)
│   ├── events/         # EventDispatcher, Listener interface, dispatch() helper, events() factory
│   ├── mail/           # Mailable, Mail facade, LogAdapter, mail() factory
│   ├── mail-nodemailer/ # Nodemailer SMTP adapter (optional peer)
│   ├── rate-limit/     # Cache-backed rate limiting — RateLimit.perMinute/Hour/Day
│   └── cli/            # Forge CLI — make:*, module:*, artisan user commands
├── create-boostkit-app/   # Project scaffolder CLI
└── playground/         # Demo app — primary integration reference
```

---

## Package Status

| Package | Status | Notes |
|---|---|---|
| `@boostkit/contracts` | ✅ Complete | Pure TypeScript types: ForgeRequest, ForgeResponse, ServerAdapter, MiddlewareHandler, RouteDefinition, FetchHandler |
| `@boostkit/support` | ✅ Complete | Collection, Env, defineEnv, ConfigRepository, resolveOptionalPeer, helpers — `sideEffects: false` |
| `@boostkit/di` | ✅ Complete | Container, @Injectable, @Inject, reflect-metadata |
| `@boostkit/middleware` | ✅ Complete | Middleware base class, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware, fromClass |
| `@boostkit/validation` | ✅ Complete | FormRequest, validate(), validateWith(), ValidationError, z re-export |
| `@boostkit/artisan` | ✅ Complete | ArtisanRegistry, Command base class, parseSignature, artisan singleton — no framework deps |
| `@boostkit/core` | ✅ Complete | Application, ServiceProvider, Forge, AppBuilder — re-exports di + support + contracts types + artisan |
| `@boostkit/server-hono` | ✅ Complete | Hono adapter, HonoConfig, unified logger, CORS |
| `@boostkit/router` | ✅ Complete | Decorators + Router singleton, router.all() |
| `@boostkit/queue` | ✅ Complete | Job, QueueAdapter interface, queue:work command |
| `@boostkit/queue-inngest` | ✅ Complete | Inngest adapter |
| `@boostkit/queue-bullmq` | ✅ Complete | BullMQ Redis-backed queue — job registry, graceful shutdown |
| `@boostkit/orm` | ✅ Complete | Model, QueryBuilder, ModelRegistry |
| `@boostkit/orm-prisma` | ✅ Complete | Prisma adapter, multi-driver (pg, libsql, default) |
| `@boostkit/cli` | ✅ Complete | make:*, module:*, module:publish, cfonts banner, user artisan commands |
| `@boostkit/auth` | ✅ Complete | Shared AuthUser, AuthSession, AuthResult types |
| `@boostkit/auth-better-auth` | ✅ Complete | better-auth adapter — betterAuth() factory, /api/auth/* mount |
| `@boostkit/storage` | ✅ Complete | Storage facade, LocalAdapter (built-in), storage() factory, storage:link |
| `@boostkit/storage-s3` | ✅ Complete | S3/R2/MinIO adapter via @aws-sdk/client-s3 — optional peer |
| `@boostkit/schedule` | ✅ Complete | Task scheduler, schedule:run / schedule:work / schedule:list |
| `@boostkit/cache` | ✅ Complete | Cache facade, MemoryAdapter (built-in), cache() factory |
| `@boostkit/cache-redis` | ✅ Complete | Redis adapter via ioredis — optional peer for redis driver |
| `@boostkit/events` | ✅ Complete | EventDispatcher, Listener interface, dispatch(), events() factory |
| `@boostkit/mail` | ✅ Complete | Mailable, Mail facade, LogAdapter (built-in dev), mail() factory |
| `@boostkit/mail-nodemailer` | ✅ Complete | Nodemailer SMTP adapter — optional peer for smtp driver |
| `@boostkit/rate-limit` | ✅ Complete | Cache-backed rate limiting — RateLimit.perMinute/Hour/Day, X-RateLimit-* headers |
| `create-boostkit-app` | ✅ Complete | Interactive CLI scaffolder — project name, db driver, Todo module option |
| `@boostkit/notification` | ✅ Complete | Multi-channel notifications (mail, database) — Notifiable, Notification, ChannelRegistry, notify() |
| `@boostkit/orm-drizzle` | ✅ Complete | Drizzle adapter — multi-driver (sqlite, postgresql, libsql), DrizzleTableRegistry |

---

## Architecture

### Dependency Flow

```
@boostkit/core  (includes: support · di · server · middleware · validation)
      │
      ├── (resolveOptionalPeer) ──→ @boostkit/router   (loaded at runtime, avoids Turbo cycle)
      │
      ↑ (peer dep, types only)
@boostkit/router   @boostkit/orm   @boostkit/queue   @boostkit/rate-limit
      ↑               ↑              ↑
@boostkit/server-hono  orm-prisma   queue-bullmq / queue-inngest
```

> **Cycle resolution**: `@boostkit/core` has no declared dependency on `@boostkit/router`. It loads router at runtime via `resolveOptionalPeer('@boostkit/router')` (opaque to Rollup static analysis). `@boostkit/router` lists `@boostkit/core` as a `peerDependency` only — Turbo builds core first without detecting a reverse cycle.

### Core Abstractions

#### `@boostkit/core` — Application + Fluent Bootstrap

Laravel 11-style fluent bootstrap in `bootstrap/app.ts`:
```ts
export default Application.configure({
  server:    hono(configs.server),   // server adapter + config
  config:    configs,                // config/ files
  providers,                         // service providers array
})
  .withRouting({
    api:      () => import('../routes/api.ts'),      // side-effect: registers routes
    commands: () => import('../routes/console.ts'),  // side-effect: registers artisan cmds
  })
  .withMiddleware((m) => {
    // m.use(new CorsMiddleware().toHandler())
  })
  .withExceptions((_e) => {})
  .create()  // returns a Forge instance
```

The `Forge` instance is the app entry point:
- `forge.handleRequest(request)` — lazy-bootstraps on first HTTP request (consumed by `vike-photon` via `pages/+config.ts`)
- `forge.boot()` — bootstraps providers without starting HTTP (used by CLI)

#### `@boostkit/core` subpath exports

`@boostkit/core` ships five tree-shakable subpaths in addition to the main barrel:

| Import | Contents |
|--------|----------|
| `@boostkit/core` | Everything below, plus Application, ServiceProvider, Forge, artisan |
| `@boostkit/core/support` | Env, Collection, ConfigRepository, resolveOptionalPeer, helpers |
| `@boostkit/core/di` | Container, Injectable, Inject |
| `@boostkit/core/server` | ServerAdapter, ForgeRequest, ForgeResponse, HttpMethod, FetchHandler |
| `@boostkit/core/middleware` | Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware |
| `@boostkit/core/validation` | FormRequest, ValidationError, validate, z |

#### `@boostkit/core` — Artisan Registry

```ts
// routes/console.ts
import { artisan } from '@boostkit/artisan'

artisan.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com' })
}).description('Seed the database')
```

Commands registered here automatically appear in `pnpm artisan --help` and can be run with `pnpm artisan db:seed`.

#### DI — Service Container
```ts
container.bind('key', (c) => new MyService())
container.singleton(MyService, (c) => new MyService())
container.make(MyService)   // auto-resolves @Injectable classes
```
- Uses `reflect-metadata` — always `import 'reflect-metadata'` at entry point
- `@Injectable()` marks a class for auto-resolution
- `@Inject(token)` overrides constructor parameter injection token
- Import from `@boostkit/core` or `@boostkit/core/di`

#### `@boostkit/router` — Routing

**Fluent (Laravel-style, in `routes/api.ts`):**
```ts
import { router } from '@boostkit/router'

router.get('/api/users', async (req, res) => res.json({ data: await UserService.all() }))
router.post('/api/users', async (req, res) => { ... })
router.all('/api/*', (req, res) => res.status(404).json({ message: 'Route not found.' }))
```

**Decorator-based (in controllers):**
```ts
@Controller('/users')
class UserController {
  @Get('/:id')
  @Middleware([AuthMiddleware])
  show({ params }: ForgeRequest) { ... }
}
router.registerController(UserController)
```

#### `@boostkit/server-hono` — Hono Adapter

Server adapter config lives in `config/server.ts` and is passed to `hono()`:
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

// bootstrap/app.ts
Application.configure({ server: hono(configs.server), ... })
```

Features: unified request logger (`[forge]` tag, ANSI colors), CORS middleware, Vike log suppression.

#### `@boostkit/orm` + `@boostkit/orm-prisma` — ORM

```ts
// app/Models/User.ts
export class User extends Model {
  static table = 'user'   // Prisma accessor name (lowercase model name)
  id!: string; name!: string; email!: string; role!: string
}

// Usage
const users = await User.all()
const user  = await User.find(id)
const admins = await User.where('role', 'admin').get()
const created = await User.create({ name: 'Alice', email: 'alice@example.com' })
```

`ModelRegistry` is set in `DatabaseServiceProvider.boot()`:
```ts
import { prisma } from '@boostkit/orm-prisma'
import { ModelRegistry } from '@boostkit/orm'

async boot() {
  const adapter = await prisma().create()   // reads DATABASE_URL from env
  await adapter.connect()
  ModelRegistry.set(adapter)
  this.app.instance('db', adapter)
}
```

#### `@boostkit/cli` — Forge CLI

Built-in generators (run from project root or `playground/`):
```bash
pnpm artisan make:controller UserController
pnpm artisan make:model Post
pnpm artisan make:job SendWelcomeEmail
pnpm artisan make:middleware Auth
pnpm artisan make:request CreateUser
pnpm artisan make:provider App
pnpm artisan make:module Blog     # scaffolds full module (schema, service, controller, provider, test, prisma)
pnpm artisan module:publish       # merges *.prisma shards into prisma/schema.prisma
```

User-defined commands in `routes/console.ts` are auto-registered. All commands support `--force`.

---

## Playground Structure

The playground is the canonical reference implementation:

```
playground/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create() — app entry wiring
│   └── providers.ts    # Default export: [DatabaseServiceProvider, betterAuth(...), AppServiceProvider, ...]
├── config/
│   ├── app.ts          # APP_NAME, APP_ENV, APP_DEBUG
│   ├── server.ts       # PORT, CORS, TRUST_PROXY
│   ├── database.ts     # DB_CONNECTION, DATABASE_URL connections
│   ├── auth.ts         # AUTH_SECRET, APP_URL, betterAuth config
│   ├── queue.ts
│   ├── mail.ts
│   └── index.ts        # barrel re-export
├── app/
│   ├── Models/
│   │   └── User.ts     # extends Model, static table = 'user'
│   ├── Services/
│   │   └── UserService.ts
│   └── Providers/
│       ├── DatabaseServiceProvider.ts  # connects Prisma, sets ModelRegistry
│       └── AppServiceProvider.ts       # binds UserService, GreetingService
├── routes/
│   ├── api.ts          # router.get/post/all() — side-effect file, no export
│   └── console.ts      # artisan.command() — side-effect file, no export
├── pages/              # Vike file-based routing (SSR pages)
├── prisma/
│   └── schema.prisma   # Prisma schema (SQLite by default) — includes better-auth tables
├── .env                # DATABASE_URL, PORT, APP_*, AUTH_SECRET vars
└── vite.config.ts      # Vite + Vike + React config
```

**Provider boot order matters** — `DatabaseServiceProvider` must appear before `AppServiceProvider` (and any provider that calls ORM models during `boot()`) so `ModelRegistry` is set in time.

---

## Configuration Layers

Forge uses three distinct config layers — there is **no `forge.config.ts`**:

| Layer | File(s) | Purpose |
|---|---|---|
| Environment | `.env` | Secrets and environment-specific values |
| Runtime config | `config/*.ts` | Named, typed objects that read from `.env` — like Laravel's `config/` |
| Framework wiring | `bootstrap/app.ts` | Server adapter, providers, routing — like Laravel's `bootstrap/app.php` |
| Build config | `vite.config.ts` | Vite + Vike plugins (build-time only) |

`bootstrap/app.ts` is the equivalent of what other frameworks call a root config file. It is where you wire the server adapter (`hono()`), register providers, and declare route loaders. Runtime values (port, URLs, credentials) belong in `config/` files — never hardcoded in `bootstrap/app.ts`.

---

## TypeScript Conventions

- All packages extend `../../tsconfig.base.json`
- `experimentalDecorators: true` + `emitDecoratorMetadata: true` — required for DI and routing decorators
- Always `import 'reflect-metadata'` at the **entry point** of any app using decorators
- `module: "NodeNext"` — use `.js` extensions in all imports even for `.ts` source files
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- Package `exports` always point to `dist/index.js` and must include `"default": "./dist/index.js"` for CJS resolver compat
- Turbo respects `^build` — changing a package auto-rebuilds all dependents

## Common Pitfalls

- **Missing `reflect-metadata`**: Add `import 'reflect-metadata'` to the entry point; install as a dep (not devDep)
- **`workspace:*` not resolving**: Run `pnpm install` from root after adding a new local dependency
- **Stale `dist/`**: Run `pnpm build` from root before running the playground
- **Prisma client missing**: Run `pnpm exec prisma generate` from `playground/` after schema changes
- **Prisma DB missing**: Run `pnpm exec prisma db push` from `playground/` to create the SQLite file
- **Decorator errors**: Ensure `experimentalDecorators` and `emitDecoratorMetadata` in the package's `tsconfig.json`
- **Circular dep (`@boostkit/core` ↔ `@boostkit/router`)**: Core loads router via `resolveOptionalPeer('@boostkit/router')` (runtime, Rollup-opaque). Never add `@boostkit/core` to `@boostkit/router`'s `dependencies` or `devDependencies` — only `peerDependencies`.
- **Optional peer `ERR_PACKAGE_PATH_NOT_EXPORTED`**: All optional peer packages must include `"default": "./dist/index.js"` in their `exports` field — `createRequire.resolve()` uses the CJS condition which can't see `"import"`-only entries.
- **`node:module` in browser bundle**: `resolveOptionalPeer` uses `await import('node:module')` (dynamic/lazy) — do NOT hoist the `createRequire` import to the top of `support.ts`; it would break the browser build.
- **Port in use (EADDRINUSE 24678)**: Kill the stale Vite process — `lsof -ti :24678 -ti :3000 | xargs kill -9`
- **`artisan` commands not appearing**: CLI must be run from a directory containing `bootstrap/app.ts` (i.e., from `playground/`, not the repo root)
