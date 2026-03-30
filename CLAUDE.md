# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

---

## Project Overview

**BoostKit** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It brings Laravel's developer experience (DI container, Eloquent-style ORM, Artisan CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@boostkit/*`
- **GitHub**: https://github.com/boostkitjs/boostkit
- **Status**: Early development — 28 packages published to npm

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
pnpm artisan      # BoostKit CLI (tsx node_modules/@boostkit/cli/src/index.ts)
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

## Publishing

Changesets is set up for release management:

```bash
pnpm changeset            # Create a changeset (select packages + describe changes)
pnpm changeset:version    # Bump versions + update CHANGELOGs
pnpm release              # Build + publish all changed packages to npm
```

For a single package:
```bash
cd packages/<name>
pnpm publish --access public --no-git-checks
```

npm requires browser passkey auth — press Enter when prompted to open the browser.

---

## Monorepo Layout

```
boostkit/
├── packages/           # 27 published packages (@boostkit/*)
│   ├── contracts/      # Pure TypeScript types: ForgeRequest, ServerAdapter, MiddlewareHandler, etc.
│   ├── support/        # Utilities: Env, Collection, ConfigRepository, resolveOptionalPeer, helpers
│   ├── di/             # DI container: Container, @Injectable, @Inject
│   ├── middleware/     # Middleware base, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   │                   #   + RateLimit / RateLimitBuilder (cache-backed, merged from rate-limit pkg)
│   ├── validation/     # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── artisan/        # ArtisanRegistry, Command base class, parseSignature, artisan singleton
│   ├── core/           # App bootstrapper, ServiceProvider, Forge, AppBuilder
│   │                   #   re-exports: di · support · contracts types · artisan
│   ├── router/         # Decorator routing + global router singleton
│   ├── orm/            # ORM contract/interface + Model base class
│   ├── orm-prisma/     # Prisma adapter (multi-driver)
│   ├── orm-drizzle/    # Drizzle adapter (multi-driver: sqlite, postgresql, libsql)
│   ├── queue/          # Queue contract/interface + queue:work artisan command
│   ├── queue-inngest/  # Inngest adapter — events named boostkit/job.<ClassName>
│   ├── queue-bullmq/   # BullMQ adapter — default prefix 'boostkit'
│   ├── server-hono/    # Hono adapter (HonoConfig, logger [boostkit] tag, CORS)
│   ├── auth/           # Auth types (AuthUser, AuthSession, AuthResult) + betterAuth() factory
│   │                   #   (merged from auth-better-auth — single package)
│   ├── storage/        # Storage facade, LocalAdapter + S3Adapter (built-in)
│   │                   #   S3 driver requires optional dep: @aws-sdk/client-s3
│   ├── schedule/       # Task scheduler — schedule singleton, scheduler() factory
│   ├── cache/          # Cache facade, MemoryAdapter + RedisAdapter (built-in)
│   │                   #   Redis driver requires optional dep: ioredis
│   ├── events/         # EventDispatcher, Listener interface, dispatch() helper
│   ├── mail/           # Mailable, Mail facade, LogAdapter + SMTP (Nodemailer), mail() factory
│   ├── notification/   # Multi-channel notifications (mail, database)
│   ├── broadcast/      # WebSocket broadcasting — public, private, presence channels
│   ├── live/           # Real-time collaborative document sync via Yjs CRDT — /ws-live endpoint
│   │                   #   Built-in: MemoryPersistence. Optional: livePrisma(), liveRedis()
│   ├── panels/         # Admin panel builder — Resource CRUD, schema elements (Stats, Chart, Table, List, Tabs,
│   │                   #   Section, Form, Dialog, Column, Heading, Text, Code), draftRecovery,
│   │                   #   rememberTable, autosave, Yjs field persist, inline editing (Column.editable())
│   │                   #   + Dashboard builder: Widget.schema(), Dashboard, drag-and-drop, per-user layout, lazy/polling
│   │                   #   + Panel.use() plugin system — PanelPlugin with schemas/pages/register/boot hooks
│   ├── panels-lexical/ # Lexical rich-text editor adapter — RichContentField, CollaborativePlainText, block editor,
│   │                   #   toolbar profiles (document/default/simple/minimal/none), slash commands, floating link editor,
│   │                   #   useYjsCollab hook (WebSocket + IndexedDB providers), imperative editor refs for version restore
│   ├── image/          # Fluent image processing — resize, crop, convert, optimize. Thin wrapper over sharp.
│   ├── media/          # Media library — Media.make() schema element, file browser, uploads, preview, conversions
│   └── cli/            # make:*, module:*, module:publish, artisan user commands
├── create-boostkit-app/   # Interactive scaffolder CLI (pnpm/npm/yarn/bun create boostkit-app)
│                          #   Prompts: name · DB · Todo · frameworks · primary · Tailwind · shadcn
├── docs/               # VitePress documentation site
└── playground/         # Demo app — primary integration reference
```

---

## Package Status

| Package | Version | Notes |
|---|---|---|
| `@boostkit/contracts` | 0.0.1 | Pure TypeScript types: ForgeRequest, ForgeResponse, ServerAdapter, MiddlewareHandler |
| `@boostkit/support` | 0.0.1 | Collection, Env, defineEnv, ConfigRepository, resolveOptionalPeer, helpers |
| `@boostkit/middleware` | 0.0.2 | Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware, RateLimit |
| `@boostkit/validation` | 0.0.1 | FormRequest, validate(), validateWith(), ValidationError, z re-export |
| `@boostkit/artisan` | 0.0.1 | ArtisanRegistry, Command base, parseSignature, artisan singleton |
| `@boostkit/core` | 0.0.2 | Application, DI container, ServiceProvider, Forge, AppBuilder |
| `@boostkit/server-hono` | 0.0.2 | Hono adapter, logger `[boostkit]` tag, CORS |
| `@boostkit/router` | 0.0.2 | Fluent + decorator routing — metadata keys: `boostkit:controller:*/route:*` |
| `@boostkit/queue` | 0.0.1 | Job, QueueAdapter interface, queue:work command |
| `@boostkit/queue-inngest` | 0.0.2 | Inngest adapter — events: `boostkit/job.<ClassName>` |
| `@boostkit/queue-bullmq` | 0.0.2 | BullMQ Redis-backed queue — default prefix: `'boostkit'` |
| `@boostkit/orm` | 0.0.2 | Model, QueryBuilder, ModelRegistry |
| `@boostkit/orm-prisma` | 0.0.1 | Prisma adapter, multi-driver |
| `@boostkit/orm-drizzle` | 0.0.1 | Drizzle adapter — multi-driver (sqlite, postgresql, libsql) |
| `@boostkit/cli` | 0.0.2 | make:*, module:*, module:publish — markers: `<boostkit:modules:start/end>` |
| `@boostkit/auth` | 0.0.1 | AuthUser/Session/Result types + betterAuth() factory (merged from auth-better-auth) |
| `@boostkit/storage` | 0.0.2 | Storage facade, LocalAdapter + S3Adapter built-in (needs `@aws-sdk/client-s3`) |
| `@boostkit/schedule` | 0.0.1 | Task scheduler, schedule:run/work/list |
| `@boostkit/cache` | 0.0.2 | Cache facade, MemoryAdapter + RedisAdapter built-in (needs `ioredis`) |
| `@boostkit/mail` | 0.0.1 | Mailable, Mail facade, LogAdapter + SMTP (Nodemailer), mail() factory |
| `@boostkit/notification` | 0.0.1 | Notifiable, Notification, ChannelRegistry, notify() |
| `@boostkit/broadcast` | 0.0.1 | WebSocket channels — broadcasting(), broadcast(), broadcasting.auth(), BKSocket client |
| `@boostkit/live` | 0.0.1 | Yjs CRDT real-time sync — live(), MemoryPersistence, livePrisma(), liveRedis() |
| `@boostkit/panels` | 0.0.3 | Admin panel: Resource `table()`/`form()`/`detail()` API, 25+ field types, schema elements (Table, Form, Column, Section, Tabs, Stats, Chart, List, Heading, Text, Code, Snippet, Example, Card, Alert, Divider, Each, View, Dialog, Dashboard, Widget), Panel.use() plugin system, persist(url/session/localStorage), lazy, poll, DataSource, versioning, collaboration (Yjs), inline editing, autosave, draftable, `registerLazyElement`/`registerResolver` for plugins |
| `@boostkit/panels-lexical` | 0.0.1 | Lexical rich-text editor adapter — `RichContentField`, `CollaborativePlainText`, block editor, slash commands, floating toolbar |
| `@boostkit/image` | 0.0.1 | Fluent image processing — resize, crop, convert, optimize. Wraps sharp. |
| `@boostkit/media` | 0.0.1 | Media library — `Media.make()` schema element, file browser, uploads, folders, preview, image conversions |

**Merged/removed packages** (code absorbed, originals deleted):
- `@boostkit/auth-better-auth` → merged into `@boostkit/auth`
- `@boostkit/di` → merged into `@boostkit/core`
- `@boostkit/rate-limit` → merged into `@boostkit/middleware`
- `@boostkit/storage-s3` → merged into `@boostkit/storage`
- `@boostkit/cache-redis` → merged into `@boostkit/cache`
- `@boostkit/mail-nodemailer` → merged into `@boostkit/mail`
- `@boostkit/events` → merged into `@boostkit/core`
- `@boostkit/dashboards` → merged into `@boostkit/panels`

---

## Architecture

### Dependency Flow

```
@boostkit/contracts   (pure types, no runtime)
       │
@boostkit/support     (Env, Collection, helpers)
@boostkit/middleware  (Pipeline, built-ins, RateLimit)
@boostkit/validation  (FormRequest, z)
       │
@boostkit/router      @boostkit/server-hono
       │
@boostkit/core        (Application, Container, ServiceProvider, bootstrap)
       │
@boostkit/orm    @boostkit/queue    @boostkit/cache    @boostkit/storage
       │              │              (redis built-in)   (s3 built-in)
 orm-prisma      queue-bullmq
 orm-drizzle     queue-inngest
       │
@boostkit/auth                      @boostkit/mail   @boostkit/schedule
       │
@boostkit/notification
```

> **Cycle resolution**: `@boostkit/core` loads `@boostkit/router` at runtime via `resolveOptionalPeer('@boostkit/router')`. Never add `@boostkit/core` to router's `dependencies` or `devDependencies`.

### Dynamic Provider Registration

Providers can be registered at runtime via `app().register(ProviderClass)`:

- Called from within another provider's `boot()` method
- Calls `register()` immediately; calls `boot()` if app is already booted or booting
- Duplicate guard by class reference and class name — safe to call multiple times
- Use cases: module self-registration, conditional features, panels extensions

```ts
// Inside a provider's boot()
app().register(PanelServiceProvider)
app().register(TodoServiceProvider)

// Panels extensions use Panel.use()
Panel.make('admin')
  .use(media({ conversions: [...] }))
  .use(panelsLexical())
  .resources([...])
```

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

### Core Abstractions

#### Bootstrap Pattern (Laravel 11-style)

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import { RateLimit } from '@boostkit/middleware'
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
  .create()
```

#### `@boostkit/auth` — Auth (better-auth)

```ts
// bootstrap/providers.ts
import { betterAuth } from '@boostkit/auth'
export default [betterAuth(configs.auth), ...]

// Usage
import type { BetterAuthInstance } from '@boostkit/auth'
const auth = app().make<BetterAuthInstance>('auth')
```

- Wraps PrismaClient with `prismaAdapter` (duck-typed via `$connect`)
- Mounts `/api/auth/*` — must register before the `/api/*` catch-all
- Auth bound to DI as `'auth'`

#### `@boostkit/middleware` — Rate Limiting

```ts
import { RateLimit } from '@boostkit/middleware'

// Global
m.use(RateLimit.perMinute(60).toHandler())

// Per-route
RateLimit.perMinute(10).message('Too many login attempts.').toHandler()
```

Requires `@boostkit/cache` to be registered first. Fails open if no cache adapter.

#### `@boostkit/storage` — S3 Driver

S3 is built-in — no separate package needed:
```ts
import { s3 } from '@boostkit/storage'
// Also requires: pnpm add @aws-sdk/client-s3
```

#### `@boostkit/cli` — Artisan CLI

```bash
pnpm artisan make:controller UserController
pnpm artisan make:model Post
pnpm artisan make:job SendWelcomeEmail
pnpm artisan make:middleware Auth
pnpm artisan make:request CreateUser
pnpm artisan make:provider App
pnpm artisan make:module Blog
pnpm artisan module:publish   # merges *.prisma shards into prisma/schema.prisma
```

Module scaffold markers in providers.ts: `// <boostkit:modules:start>` / `// <boostkit:modules:end>`

---

## Playground Structure

```
playground/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [betterAuth, events, queue, mail, notifications, cache, storage, scheduler, DatabaseServiceProvider, AppServiceProvider]
├── config/             # app, server, database, auth, queue, mail, cache, storage, index
├── app/
│   ├── Models/User.ts
│   ├── Services/UserService.ts
│   └── Providers/DatabaseServiceProvider.ts + AppServiceProvider.ts
├── routes/
│   ├── api.ts          # router.get/post/all()
│   └── console.ts      # artisan.command()
├── pages/              # Vike file-based routing
├── prisma/schema.prisma
└── vite.config.ts
```

**Provider boot order**: `DatabaseServiceProvider` must come before any provider that uses ORM models.

---

## Configuration Layers

| Layer | File(s) | Purpose |
|---|---|---|
| Environment | `.env` | Secrets and environment-specific values |
| Runtime config | `config/*.ts` | Named, typed objects reading from `.env` |
| Framework wiring | `bootstrap/app.ts` | Server adapter, providers, routing |
| Build config | `vite.config.ts` | Vite + Vike plugins |

There is **no `boostkit.config.ts`** — `bootstrap/app.ts` is the framework wiring file.

---

## TypeScript Conventions

- All packages extend `../../tsconfig.base.json`
- `experimentalDecorators: true` + `emitDecoratorMetadata: true` — required for DI and routing
- Always `import 'reflect-metadata'` at the **entry point**
- `module: "NodeNext"` — use `.js` extensions in all imports
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`

---

## Common Pitfalls

- **Missing `reflect-metadata`**: Add `import 'reflect-metadata'` to entry point; install as dep (not devDep)
- **`workspace:*` not resolving**: Run `pnpm install` from root after adding a new local dependency
- **Stale `dist/`**: Run `pnpm build` from root before running the playground
- **Prisma client missing**: Run `pnpm exec prisma generate` from `playground/`
- **Decorator errors**: Ensure `experimentalDecorators` and `emitDecoratorMetadata` in tsconfig.json
- **Circular dep**: Never add `@boostkit/core` to router/server-hono's `dependencies` — `peerDependencies` only
- **Port in use**: `lsof -ti :24678 -ti :3000 | xargs kill -9`
- **`artisan` commands not appearing**: Run from `playground/` (needs `bootstrap/app.ts`)
- **RateLimit not working**: Requires a cache provider registered before middleware runs
- **S3 disk errors**: Install `@aws-sdk/client-s3` — it's an optional dep of `@boostkit/storage`
- **Panels pages not updated after source edit**: `packages/panels/pages/` are published copies. After editing source, re-run `pnpm artisan vendor:publish --tag=panels-pages --force` from `playground/`
- **`panels-lexical` cycle**: `@boostkit/panels` must NOT depend on `@boostkit/panels-lexical`. The `+Layout.tsx` registers it client-side via `if (typeof window !== 'undefined') import('@boostkit/panels-lexical').then(...)`. `RichContentField` lives in `@boostkit/panels-lexical`, not `@boostkit/panels`.
- **Plugin element registration**: Plugin schema elements use `registerLazyElement` (SSR-safe via `React.lazy`). Plugin SSR resolvers use `registerResolver` (via `PanelPlugin.resolvers`). Plugins publish `_register-{name}.ts` files auto-discovered by `+Layout.tsx` via `import.meta.glob('../_register-*.ts', { eager: true })`.
- **Media plugin pattern**: `@boostkit/media` uses `PanelPlugin.resolvers` for SSR data + `_register-media.ts` for client component. Zero media-specific code in panels.

### Collaborative Editing Architecture

Each collaborative field gets its own Y.Doc + WebSocket room. The form has a separate Y.Map for simple fields.

**Three persistence layers** (all work together):
- **WebSocket** — real-time sync between users (server memory, lost on restart)
- **IndexedDB** — browser-local persistence (survives refresh + server restart)
- **livePrisma/liveRedis** — server-side persistence (survives everything, cross-device)

**Key implementation rules:**
- IndexedDB provider must be created **before** WebSocket provider (fire-and-forget, no await). IndexedDB is local (~ms) and naturally loads before WebSocket (network latency), ensuring local content isn't overwritten by empty server rooms.
- Never clear Y.Doc rooms on normal save — rooms already have correct content.
- SeedPlugin checks **actual root content** (`root.length > 0` or `root.getTextContent()`) not state vector (`sv.length`). State vector can be > 1 from provider metadata alone.
- SeedPlugin uses a **retry pattern** — CollaborationPlugin may overwrite the first seed, so retry until content sticks (max 5 attempts).
- Version restore uses **imperative editor refs** (`EditorRefPlugin.setContent()`) — writes to the editor which propagates through CollaborationPlugin binding to Y.Doc and all connected users. Never fight Yjs — use it.
- Registration keys for editor components use `_lexical:` prefix (`_lexical:richcontent`, `_lexical:collaborativePlainText`) to avoid collision with the `FieldInput` registry shortcut.

**Y.Doc room naming:**
- Form fields map: `panel:{resource}:{recordId}`
- Text fields: `panel:{resource}:{recordId}:text:{fieldName}`
- Rich text fields: `panel:{resource}:{recordId}:richcontent:{fieldName}`

**Config layers:**
- `config/live.ts` `providers: ['websocket', 'indexeddb']` — controls form-level Y.Map providers
- `.persist(['websocket', 'indexeddb'])` or `.collaborative()` on a field — marks it as collaborative, enables per-field Y.Doc

## create-boostkit-app

### Prompts (in order)
1. Project name
2. Database driver — SQLite · PostgreSQL · MySQL
3. Include Todo module? — yes/no
4. Frontend frameworks — **multiselect**: React · Vue · Solid (default: React)
5. Primary framework — single select, only shown when >1 framework selected
6. Add Tailwind CSS? — yes/no (default: yes)
7. Add shadcn/ui? — yes/no (default: yes), **only shown when React + Tailwind are both selected**
8. Install dependencies? — yes/no

### Package Manager Support
PM is auto-detected from `npm_config_user_agent` (set by pnpm/npm/yarn/bun when invoking the installer).

| | pnpm | npm | yarn | bun |
|---|---|---|---|---|
| `pnpm-workspace.yaml` | generated | no | no | no |
| native-build field | `pnpm.onlyBuiltDependencies` | *(none needed)* | *(none needed)* | `trustedDependencies` |
| exec | `pnpm exec <bin>` | `npx <bin>` | `yarn dlx <bin>` | `bunx <bin>` |
| run | `pnpm <script>` | `npm run <script>` | `yarn <script>` | `bun <script>` |

Helpers: `detectPackageManager()`, `pmExec(pm, bin)`, `pmRun(pm, script)`, `pmInstall(pm)` — all exported from `templates.ts`.

### Template Gotchas
- `tsconfig.json` must be self-contained — no `extends: ../tsconfig.base.json` (monorepo-only)
- All `@boostkit/*` deps use `'latest'` — pnpm double-zero semver (`^0.0.x`) pins to exact version
- Native-build field in `package.json` is PM-specific (see table above)
- Use `database(configs.database)` from `@boostkit/orm-prisma` not `DatabaseServiceProvider` in providers.ts
- `shadcn` dep only added when React + Tailwind are both selected
- `src/index.css` not generated at all when Tailwind is not selected
- React + Solid together: Vite plugins use `include`/`exclude` to disambiguate `.tsx` files
- Secondary frameworks get demo pages at `pages/{fw}-demo/` (each with its own `+config.ts`)
- `@boostkit/session` is in deps (providers.ts imports it)

### Vike +config.ts Strategy
- **Single framework**: renderer (`vike-react`/`vike-vue`/`vike-solid`) included in root `pages/+config.ts` alongside `vike-photon`. No `pages/index/+config.ts` generated.
- **Multi-framework**: root `pages/+config.ts` has `vike-photon` only (no renderer). Each page/folder has its own `+config.ts` extending the correct renderer. `pages/index/+config.ts` is generated for the primary framework.

### Local Testing
```bash
cd create-boostkit-app
pnpm build
node dist/index.js        # launches the full interactive CLI
```
