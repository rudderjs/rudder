# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

---

## Project Overview

**RudderJS** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It brings Laravel's developer experience (DI container, Eloquent-style ORM, Rudder CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@rudderjs/*`
- **GitHub**: https://github.com/rudderjs/rudder
- **Status**: Early development — 38 packages published to npm

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
pnpm rudder      # RudderJS CLI (tsx node_modules/@rudderjs/cli/src/index.ts)
```

> Always run `pnpm build` from root before `pnpm dev` in playground — packages must be compiled first.

Prisma (run from `playground/`):
```bash
pnpm exec prisma generate       # Regenerate client after schema changes
pnpm exec prisma db push        # Sync schema → DB (dev, no migrations)
pnpm exec prisma migrate dev    # Create a migration
pnpm rudder db:seed            # Seed via rudder command
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
rudderjs/
├── packages/           # 36 published packages (@rudderjs/*)
│   ├── contracts/      # Pure TypeScript types: ForgeRequest, ServerAdapter, MiddlewareHandler, etc.
│   ├── support/        # Utilities: Env, Collection, ConfigRepository, resolveOptionalPeer, helpers
│   ├── di/             # DI container: Container, @Injectable, @Inject
│   ├── middleware/     # Middleware base, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   │                   #   + RateLimit / RateLimitBuilder (cache-backed, merged from rate-limit pkg)
│   ├── validation/     # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── rudder/        # CommandRegistry, Command base class, parseSignature, rudder singleton
│   ├── core/           # App bootstrapper, ServiceProvider, Forge, AppBuilder
│   │                   #   re-exports: di · support · contracts types · rudder
│   ├── router/         # Decorator routing + global router singleton
│   ├── orm/            # ORM contract/interface + Model base class
│   ├── orm-prisma/     # Prisma adapter (multi-driver)
│   ├── orm-drizzle/    # Drizzle adapter (multi-driver: sqlite, postgresql, libsql)
│   ├── queue/          # Queue contract/interface + queue:work rudder command
│   ├── queue-inngest/  # Inngest adapter — events named rudderjs/job.<ClassName>
│   ├── queue-bullmq/   # BullMQ adapter — default prefix 'rudderjs'
│   ├── server-hono/    # Hono adapter (HonoConfig, logger [rudderjs] tag, CORS)
│   ├── hash/           # Password hashing — Hash facade, BcryptDriver, Argon2Driver, hash() factory
│   ├── crypt/          # Symmetric encryption — Crypt facade, AES-256-CBC, parseKey(), crypt() factory
│   ├── auth/           # Native auth: Guards (SessionGuard), Providers (EloquentUserProvider), Auth facade,
│   │                   #   Gate/Policy authorization, PasswordBroker, AuthMiddleware(), RequireAuth()
│   │                   #   Depends on @rudderjs/hash + @rudderjs/session
│   ├── sanctum/        # API tokens — Sanctum class, TokenGuard, SanctumMiddleware(), RequireToken(),
│   │                   #   SHA-256 hashed tokens with abilities
│   ├── socialite/      # OAuth — Socialite facade, SocialUser, 4 built-in providers (GitHub, Google,
│   │                   #   Facebook, Apple), extensible
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
│   │                   #   + AI chat sidebar: unified chat + resource agents, POST /{panel}/api/_chat,
│   │                   #     run_agent tool, forceAgent bypass, resource context, field animation via SSE
│   │                   #   + Conversation persistence: AiConversation/AiChatMessage Prisma models, PrismaConversationStore,
│   │                   #     auto-restore on mount, conversation switcher dropdown, auto-title, CRUD routes
│   │                   #   + Model selection: AiModelConfig in ai config, GET /_chat/models, selector in chat input
│   │                   #   + AiChatProvider takes panelPath prop — chat is panel-wide, not resource-tied
│   │                   #   + Selected text context: select text in any field → ✦ Ask AI button → chat opens with
│   │                   #     selection locked to that field. edit_text tool constrained via z.literal(field).
│   │                   #   + Field.ai(actions?) — quick action sparkle menu next to field labels (rewrite, expand,
│   │                   #     shorten, fix-grammar, translate, summarize, make-formal, simplify)
│   │                   #   + Panel.theme() — runtime CSS variable injection (presets, base colors, accent colors,
│   │                   #     chart palettes, radius, fonts, icon library). resolveTheme() layering system.
│   │                   #   + Panel.themeEditor() — built-in /theme settings page with iframe live preview,
│   │                   #     DB persistence (panelGlobal), save/reset/shuffle, dark mode sync
│   │                   #   + Icon adapter system: PanelIcon + IconAdapterProvider for lucide/tabler/phosphor/remix
│   │                   #   + FieldType enum (replaces magic strings), filters: DateFilter, BooleanFilter, NumberFilter, QueryFilter
│   │                   #   + ActionGroup (dropdown grouping), Action.form(fields[]) modal forms, List.headerActions([])
│   │                   #   + Import class + .importable() on List, Wizard/Step for multi-step forms
│   │                   #   + RelationManager for inline hasMany/belongsToMany CRUD (Resource.relations())
│   │                   #   + Panel.notifications() config + notification routes
│   ├── panels-lexical/ # Lexical rich-text editor adapter — RichContentField, CollaborativePlainText, block editor,
│   │                   #   toolbar profiles (document/default/simple/minimal/none), slash commands, floating link editor,
│   │                   #   useYjsCollab hook (WebSocket + IndexedDB providers), imperative editor refs for version restore,
│   │                   #   FloatingToolbarPlugin ✦ Ask AI button, CollaborativePlainText SelectionAiPlugin
│   ├── image/          # Fluent image processing — resize, crop, convert, optimize. Thin wrapper over sharp.
│   ├── media/          # Media library — Media.make() schema element, file browser, uploads, preview, conversions
│   ├── ai/             # AI engine — 4 providers (Anthropic, OpenAI, Google, Ollama), Agent class, tool system,
│   │                   #   streaming, middleware, structured output, conversation memory, AI facade, AiFake
│   │                   #   Agent.prompt/stream accept { history } for conversation continuity
│   │                   #   AiModelConfig + AiRegistry.setModels/getModels for user model selection
│   ├── workspaces/     # AI workspace canvas — Isoflow-style 3D nodes, departments, connections, chat, orchestrator
│   │                   #   Panel plugin: workspaces(). Uses @rudderjs/ai for LLM, Prisma for persistence.
│   ├── boost/          # AI dev tools — MCP server (app_info, db_schema, route_list, model_list, config_get, last_error)
│   ├── log/            # Structured logging — channels (console, single, daily, stack, null), RFC 5424 levels,
│   │                   #   LineFormatter/JsonFormatter, context propagation (per-channel + shared), listeners,
│   │                   #   LogFake for testing, extendLog() for custom drivers
│   ├── http/           # HTTP client — fluent fetch wrapper, retries, timeouts, pools, interceptors, Http.fake()
│   ├── localization/   # i18n — trans(), setLocale(), locale-aware middleware, JSON translation files
│   ├── testing/        # TestCase, TestResponse assertions, RefreshDatabase, WithFaker, actingAs(),
│   │                   #   database assertions, HTTP request helpers (get/post/put/patch/delete)
│   └── cli/            # make:*, module:*, module:publish, rudder user commands
├── create-rudderjs-app/   # Interactive scaffolder CLI (pnpm/npm/yarn/bun create rudderjs-app)
│                          #   Prompts: name · DB · Todo · AI · frameworks · primary · Tailwind · shadcn
├── docs/               # VitePress documentation site
└── playground/         # Demo app — primary integration reference
```

---

## Package Status

| Package | Version | Notes |
|---|---|---|
| `@rudderjs/contracts` | 0.0.3 | TypeScript contracts + runtime helpers: AppRequest (typed input accessors), AppResponse, ServerAdapter, MiddlewareHandler, `InputTypeError`, `attachInputAccessors` |
| `@rudderjs/support` | 0.0.3 | Collection (30+ methods), Str (35+ helpers), Num (9 helpers), Env, defineEnv, ConfigRepository, resolveOptionalPeer, helpers |
| `@rudderjs/middleware` | 0.0.2 | Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware, RateLimit |
| `@rudderjs/validation` | 0.0.1 | FormRequest, validate(), validateWith(), ValidationError, z re-export |
| `@rudderjs/rudder` | 0.0.1 | CommandRegistry, Command base, parseSignature, rudder singleton |
| `@rudderjs/core` | 0.0.2 | Application, DI container, ServiceProvider, Forge, AppBuilder, `HttpException`, `abort()`, `abort_if()`, `abort_unless()`, `report()`, `report_if()`, `setExceptionReporter()`, `Event.fake()` (EventFake: assertDispatched/assertNotDispatched/assertNothingDispatched) |
| `@rudderjs/server-hono` | 0.0.2 | Hono adapter, logger `[rudderjs]` tag, CORS |
| `@rudderjs/router` | 0.0.3 | Fluent + decorator routing, named routes, `route()` URL generation, `Url` signed URLs (HMAC-SHA256), `ValidateSignature()` middleware — metadata keys: `rudderjs:controller:*/route:*` |
| `@rudderjs/queue` | 0.0.5 | Job, QueueAdapter, DispatchBuilder, SyncAdapter, queue:work/status/clear/failed/retry commands, `Chain.of()` (sequential execution, state sharing, `onFailure`), `Bus.batch()` (`then`/`catch`/`finally`, progress tracking, `allowFailures`), `ShouldBeUnique`/`ShouldBeUniqueUntilProcessing` (cache-backed locks), job middleware (`RateLimited`, `WithoutOverlapping`, `ThrottlesExceptions`, `Skip`), `dispatch(fn)` queued closures, `Queue.fake()` (FakeQueueAdapter: assertPushed/assertPushedOn/assertNotPushed/assertNothingPushed) |
| `@rudderjs/queue-inngest` | 0.0.2 | Inngest adapter — events: `rudderjs/job.<ClassName>` |
| `@rudderjs/queue-bullmq` | 0.0.2 | BullMQ Redis-backed queue — default prefix: `'rudderjs'` |
| `@rudderjs/orm` | 0.0.6 | Model, QueryBuilder, ModelRegistry, Attribute casts (`boolean`, `date`, `json`, `encrypted`, custom `CastUsing`), `Attribute.make({ get, set })` accessors/mutators, `@Hidden`/`@Visible`/`@Appends`/`@Cast` decorators, instance `makeVisible()`/`makeHidden()`/`setVisible()`/`setHidden()`, `JsonResource`/`ResourceCollection` (conditional: `when`/`whenLoaded`/`whenNotNull`/`mergeWhen`), `ModelCollection` (wrap/find/contains/except/only/diff/unique/fresh/load/toQuery), `ModelFactory`/`sequence()` |
| `@rudderjs/orm-prisma` | 0.0.1 | Prisma adapter, multi-driver |
| `@rudderjs/orm-drizzle` | 0.0.1 | Drizzle adapter — multi-driver (sqlite, postgresql, libsql) |
| `@rudderjs/cli` | 0.0.2 | make:*, module:*, module:publish — markers: `<rudderjs:modules:start/end>` |
| `@rudderjs/hash` | 0.0.1 | Password hashing — Hash facade, BcryptDriver, Argon2Driver, hash() factory |
| `@rudderjs/crypt` | 0.0.1 | Symmetric encryption — Crypt facade, AES-256-CBC, parseKey(), crypt() factory |
| `@rudderjs/auth` | 0.2.0 | Native auth: Guards (SessionGuard), Providers (EloquentUserProvider), Auth facade, Gate/Policy, PasswordBroker, AuthMiddleware(), RequireAuth(), `MustVerifyEmail` interface, `EnsureEmailIsVerified()` middleware, `verificationUrl()`, `handleEmailVerification()`. Depends on hash + session |
| `@rudderjs/sanctum` | 0.0.1 | API tokens — Sanctum class, TokenGuard, SanctumMiddleware(), RequireToken(), SHA-256 hashed tokens with abilities |
| `@rudderjs/socialite` | 0.0.1 | OAuth — Socialite facade, SocialUser, 4 built-in providers (GitHub, Google, Facebook, Apple), extensible |
| `@rudderjs/storage` | 0.0.2 | Storage facade, LocalAdapter + S3Adapter built-in (needs `@aws-sdk/client-s3`) |
| `@rudderjs/schedule` | 0.0.6 | Task scheduler, schedule:run/work/list, sub-minute (`everyFiveSeconds`..`everyThirtySeconds`), hooks (`before`/`after`/`onSuccess`/`onFailure`), `withoutOverlapping(expiresAt)`, `evenInMaintenanceMode()`, `onOneServer()` (cache-backed distributed lock) |
| `@rudderjs/cache` | 0.0.2 | Cache facade, MemoryAdapter + RedisAdapter built-in (needs `ioredis`), `Cache.fake()` (FakeCacheAdapter: assertSet/assertGet/assertForgotten/assertFlushed) |
| `@rudderjs/mail` | 0.0.5 | Mailable, Mail facade, LogAdapter + SMTP (Nodemailer), `FailoverAdapter` (ordered mailer fallback), `MarkdownMailable` (markdown→responsive HTML, components: button/panel/table/header/footer), `Mail.to().queue()`/`.later(delay)` (queued via `@rudderjs/queue`), `mailPreview()` route handler, mail() factory, `Mail.fake()` (FakeMailAdapter: assertSent/assertNotSent/assertQueued/assertNothingSent) |
| `@rudderjs/notification` | 0.0.5 | Notifiable, Notification, ChannelRegistry, notify(), `ShouldQueue` (queued notifications via `@rudderjs/queue`), `BroadcastChannel` (WebSocket via `@rudderjs/broadcast`), `AnonymousNotifiable`/`Notification.route()` (on-demand notifications), `Notification.fake()` (NotificationFake: assertSentTo/assertNotSentTo/assertCount) |
| `@rudderjs/broadcast` | 0.0.1 | WebSocket channels — broadcasting(), broadcast(), broadcasting.auth(), BKSocket client |
| `@rudderjs/live` | 0.0.1 | Yjs CRDT real-time sync — live(), MemoryPersistence, livePrisma(), liveRedis() |
| `@rudderjs/panels` | 0.0.3 | Admin panel: Resource `table()`/`form()`/`detail()`/`agents()`/`relations()` API, 25+ field types, FieldType enum, schema elements (Table, Form, Column, Section, Tabs, Stats, Chart, List, Heading, Text, Code, Snippet, Example, Card, Alert, Divider, Each, View, Dialog, Dashboard, Widget, Wizard/Step, Import, RelationManager), filters (DateFilter, BooleanFilter, NumberFilter, QueryFilter + base Filter.indicator()), ActionGroup + Action.form() modal forms + List.headerActions(), List.importable(), Panel.use() plugin system, persist(url/session/localStorage), lazy, poll, DataSource, versioning, collaboration (Yjs), inline editing, autosave, draftable, AI resource agents (ResourceAgent, SSE streaming, unified AI chat sidebar, `POST /{panel}/api/_chat` with `run_agent` + `edit_text` tools, resource context, field typing animation), conversation persistence (AiConversation/AiChatMessage Prisma, PrismaConversationStore, conversation switcher, auto-title, auto-restore), model selection (GET `/_chat/models`, selector UI), resource context pill, selected text context (✦ Ask AI on selection, field-locked edit_text, SelectionPill), Field.ai() quick actions (sparkle menu: rewrite/expand/shorten/fix-grammar/translate/summarize/make-formal/simplify), `registerLazyElement`/`registerResolver` for plugins, Panel.notifications() config, **Theming**: `Panel.theme()` with 4 presets (default/nova/maia/lyra), 6 base colors, 16 accent colors, 5 chart palettes, radius presets, Google Fonts, icon library adapter (lucide/tabler/phosphor/remix via PanelIcon + IconAdapterProvider), `Panel.themeEditor()` built-in settings page with iframe live preview + DB persistence |
| `@rudderjs/panels-lexical` | 0.0.1 | Lexical rich-text editor adapter — `RichContentField`, `CollaborativePlainText`, block editor, slash commands, floating toolbar with ✦ Ask AI button, SelectionAiPlugin for plain text fields |
| `@rudderjs/image` | 0.0.1 | Fluent image processing — resize, crop, convert, optimize. Wraps sharp. |
| `@rudderjs/media` | 0.0.1 | Media library — `Media.make()` schema element, file browser, uploads, folders, preview, image conversions |
| `@rudderjs/ai` | 0.0.1 | AI engine — 4 providers (Anthropic, OpenAI, Google, Ollama), Agent class, tool system, streaming, middleware, Output, conversation memory, AI facade, AiFake. Agent.prompt/stream accept `{ history }`. AiModelConfig + model registry for user selection. |
| `@rudderjs/workspaces` | 0.0.1 | AI workspace canvas — Isoflow-style 3D nodes, departments, connections. Panel plugin: `workspaces()` |
| `@rudderjs/boost` | 0.0.1 | AI dev tools — MCP server exposing project internals (DB schema, routes, models, config, logs) to AI coding assistants |
| `@rudderjs/log` | 0.0.1 | Structured logging — channels (console, single, daily, stack, null), RFC 5424 levels, LineFormatter/JsonFormatter, per-channel + shared context, listeners, `LogFake` for testing, `extendLog()` for custom drivers |
| `@rudderjs/http` | 0.0.1 | Fluent HTTP client — `Http` facade, retries, timeouts, pools (`Pool.concurrency()`), request/response interceptors, `Http.fake()` with URL pattern matching + assertions |
| `@rudderjs/localization` | 0.0.1 | i18n — `trans()`, `setLocale()`, `getLocale()`, locale middleware, JSON translation files |
| `@rudderjs/testing` | 0.0.1 | TestCase base class, TestResponse assertions (assertOk/assertJson/assertJsonPath/assertJsonCount/assertHeader/assertRedirect), RefreshDatabase trait, WithFaker trait, database assertions (assertDatabaseHas/Missing/Count/Empty), HTTP request helpers (get/post/put/patch/delete), actingAs(user) |

**Merged/removed packages** (code absorbed, originals deleted):
- `@rudderjs/di` → merged into `@rudderjs/core`
- `@rudderjs/rate-limit` → merged into `@rudderjs/middleware`
- `@rudderjs/storage-s3` → merged into `@rudderjs/storage`
- `@rudderjs/cache-redis` → merged into `@rudderjs/cache`
- `@rudderjs/mail-nodemailer` → merged into `@rudderjs/mail`
- `@rudderjs/events` → merged into `@rudderjs/core`
- `@rudderjs/dashboards` → merged into `@rudderjs/panels`

---

## Architecture

### Dependency Flow

```
RudderJS Framework
│
├─── Foundation Layer (zero deps)
│    ├── @rudderjs/contracts          Pure TypeScript types
│    └── @rudderjs/support            Env, Collection, Str, Num, helpers
│
├─── Core Layer
│    ├── @rudderjs/middleware          Pipeline, CORS, Logger, Throttle, RateLimit
│    ├── @rudderjs/validation         FormRequest, validate(), Zod re-export
│    ├── @rudderjs/router             Decorator routing, route(), signed URLs
│    ├── @rudderjs/server-hono        Hono HTTP adapter, production WS upgrade
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
│         ├── AI: ResourceAgent, chat sidebar, edit_text, run_agent
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

> **Cycle resolution**: `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer('@rudderjs/router')`. Never add `@rudderjs/core` to router's `dependencies` or `devDependencies`.

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
  .create()
```

#### `@rudderjs/auth` — Native Auth

```ts
// bootstrap/providers.ts
import { auth } from '@rudderjs/auth'
import { hash } from '@rudderjs/hash'
export default [hash(configs.hash), auth(configs.auth), ...]

// Middleware
import { AuthMiddleware, RequireAuth } from '@rudderjs/auth'
m.use(AuthMiddleware())   // sets req.user (nullable)
router.get('/dashboard', RequireAuth(), handler)  // 401 if not authenticated

// Usage (Auth facade via AsyncLocalStorage)
import { Auth } from '@rudderjs/auth'
const user = Auth.user()       // current authenticated user
const check = Auth.check()     // boolean
Auth.login(user)
Auth.logout()

// Authorization (Gates & Policies)
import { Gate } from '@rudderjs/auth'
Gate.define('edit-post', (user, post) => user.id === post.authorId)
Gate.authorize('edit-post', post)  // throws 403 if denied
```

- Native session-based auth — `SessionGuard` + `EloquentUserProvider`
- Depends on `@rudderjs/hash` (password verification) + `@rudderjs/session` (session storage)
- `PasswordBroker` for password reset flows
- Gate/Policy authorization system (Laravel-style)

#### `@rudderjs/sanctum` — API Tokens

```ts
import { SanctumMiddleware, RequireToken } from '@rudderjs/sanctum'
m.use(SanctumMiddleware())
router.get('/api/data', RequireToken('read'), handler)
```

- SHA-256 hashed tokens with abilities (permissions)
- `TokenGuard` for stateless API authentication

#### `@rudderjs/socialite` — OAuth

```ts
import { Socialite } from '@rudderjs/socialite'
// Redirect to provider
const url = Socialite.driver('github').redirect()
// Handle callback
const socialUser = await Socialite.driver('github').user(code)
```

- 4 built-in providers: GitHub, Google, Facebook, Apple
- Extensible — add custom OAuth providers

#### `@rudderjs/middleware` — Rate Limiting

```ts
import { RateLimit } from '@rudderjs/middleware'

// Global
m.use(RateLimit.perMinute(60).toHandler())

// Per-route
RateLimit.perMinute(10).message('Too many login attempts.').toHandler()
```

Requires `@rudderjs/cache` to be registered first. Fails open if no cache adapter.

#### `@rudderjs/storage` — S3 Driver

S3 is built-in — no separate package needed:
```ts
import { s3 } from '@rudderjs/storage'
// Also requires: pnpm add @aws-sdk/client-s3
```

#### `@rudderjs/cli` — Rudder CLI

```bash
pnpm rudder make:controller UserController
pnpm rudder make:model Post
pnpm rudder make:job SendWelcomeEmail
pnpm rudder make:middleware Auth
pnpm rudder make:request CreateUser
pnpm rudder make:provider App
pnpm rudder make:module Blog
pnpm rudder module:publish   # merges *.prisma shards into prisma/schema.prisma
```

Module scaffold markers in providers.ts: `// <rudderjs:modules:start>` / `// <rudderjs:modules:end>`

---

## Playground Structure

```
playground/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [hash, auth, events, queue, mail, notifications, cache, storage, scheduler, DatabaseServiceProvider, AppServiceProvider]
├── config/             # app, server, database, auth, queue, mail, cache, storage, index
├── app/
│   ├── Models/User.ts
│   ├── Services/UserService.ts
│   └── Providers/DatabaseServiceProvider.ts + AppServiceProvider.ts
├── routes/
│   ├── api.ts          # router.get/post/all()
│   └── console.ts      # rudder.command()
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

There is **no `rudderjs.config.ts`** — `bootstrap/app.ts` is the framework wiring file.

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
- **Circular dep**: Never add `@rudderjs/core` to router/server-hono's `dependencies` — `peerDependencies` only
- **Port in use**: `lsof -ti :24678 -ti :3000 | xargs kill -9`
- **`rudder` commands not appearing**: Run from `playground/` (needs `bootstrap/app.ts`)
- **RateLimit not working**: Requires a cache provider registered before middleware runs
- **S3 disk errors**: Install `@aws-sdk/client-s3` — it's an optional dep of `@rudderjs/storage`
- **Panels pages not updated after source edit**: `packages/panels/pages/` are published copies. After editing source, re-run `pnpm rudder vendor:publish --tag=panels-pages --force` from `playground/`
- **`panels-lexical` cycle**: `@rudderjs/panels` must NOT depend on `@rudderjs/panels-lexical`. The `+Layout.tsx` registers it client-side via `if (typeof window !== 'undefined') import('@rudderjs/panels-lexical').then(...)`. `RichContentField` lives in `@rudderjs/panels-lexical`, not `@rudderjs/panels`.
- **Plugin element registration**: Plugin schema elements use `registerLazyElement` (SSR-safe via `React.lazy`). Plugin SSR resolvers use `registerResolver` (via `PanelPlugin.resolvers`). Plugins publish `_register-{name}.ts` files auto-discovered by `+Layout.tsx` via `import.meta.glob('../_register-*.ts', { eager: true })`.
- **Media plugin pattern**: `@rudderjs/media` uses `PanelPlugin.resolvers` for SSR data + `_register-media.ts` for client component. Zero media-specific code in panels.

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

**Server-side AI editing (Live facade):**
- `Live.editText(docName, op, aiCursor?)` — surgical text replace/insert/delete in Y.XmlText. Walks root → Y.XmlText children (paragraphs/headings) → inner delta text runs. `aiCursor` sets visible AI selection highlight.
- `Live.editBlock(docName, blockType, blockIndex, field, value)` — updates block data via `Y.XmlElement.setAttribute('__blockData', obj)`. Blocks are inside paragraph Y.XmlText children, not at root level.
- `Live.readText(docName)` — extracts plain text from a Lexical Y.Doc room (for `read_record` to include collaborative richcontent/textarea field content).
- `Live.setAiAwareness(docName, { name, color }, cursorTarget?)` — broadcasts AI cursor/selection to all clients. Uses synthetic client ID (999999999) and lib0 varint encoding matching y-protocols awareness wire format. `cursorTarget.length` creates a selection highlight instead of a cursor line.
- `Live.clearAiAwareness(docName)` — removes AI cursor from all clients.
- `Resource.getFieldMeta()` — extracts `{ type, yjs }` from form fields for agent routing.
- ResourceAgent `edit_text` is a `.server()` tool: collab fields → `Live.editText/editBlock` with AI cursor; non-collab → string ops + `Live.updateMap`.

**Lexical Y.Doc tree structure (verified):**
```
root (Y.XmlText)
  ├── Y.XmlText (__type="heading")   ← NOT Y.XmlElement!
  │     ├── Y.Map (__type="text")    ← TextNode metadata, offset += 1
  │     └── "hello world"            ← actual text, offset += string.length
  ├── Y.XmlText (__type="paragraph")
  │     ├── Y.XmlElement (custom-block)  ← block INSIDE paragraph
  │     │     attrs: __blockType, __blockData (raw object, NOT JSON string)
  │     ├── Y.Map (__type="text")
  │     └── "some text"
  └── Y.XmlText (__type="list")
        ├── Y.XmlText (list item)    ← nested
        └── Y.XmlText (list item)
```
- `toString()` is unreliable — returns `[object Object]text`. Must walk inner delta for text search.
- `Y.XmlText.delete(offset, len)` / `insert(offset, text)` work on flattened offset across all inner items.

**Config layers:**
- `config/live.ts` `providers: ['websocket', 'indexeddb']` — controls form-level Y.Map providers
- `.persist(['websocket', 'indexeddb'])` or `.collaborative()` on a field — marks it as collaborative, enables per-field Y.Doc

## create-rudderjs-app

### Prompts (in order)
1. Project name
2. Database ORM — Prisma · Drizzle · None
3. Database driver — SQLite · PostgreSQL · MySQL (if ORM selected)
4. Select packages — **multiselect**: auth, cache, queue, storage, mail, notifications, scheduler, broadcast, live, **ai**, panels (defaults: auth + cache)
5. Add media library plugin? — yes/no (only shown when panels + storage selected)
6. Add AI workspaces plugin? — yes/no (only shown when panels + ai selected)
7. Include Todo module? — yes/no (only if ORM selected)
8. Frontend frameworks — **multiselect**: React · Vue · Solid (default: React)
9. Primary framework — single select, only shown when >1 framework selected
10. Add Tailwind CSS? — yes/no (default: yes)
11. Add shadcn/ui? — yes/no (default: yes), **only shown when React + Tailwind are both selected**
12. Install dependencies? — yes/no

When `panels` is selected, scaffolds `app/Panels/AdminPanel.ts` with `Panel.make()`, wires `panels()` provider, and generates `UserResource` (if auth+orm) and `TodoResource` (if todo). Media and workspaces are wired via `Panel.use()`. When `ai` is selected, generates `config/ai.ts`, `ai()` provider, AI chat demo page at `/ai-chat`, and `POST /api/ai/chat` route.

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
- All `@rudderjs/*` deps use `'latest'` — pnpm double-zero semver (`^0.0.x`) pins to exact version
- Native-build field in `package.json` is PM-specific (see table above)
- Use `database(configs.database)` from `@rudderjs/orm-prisma` not `DatabaseServiceProvider` in providers.ts
- `shadcn` dep only added when React + Tailwind are both selected
- `src/index.css` not generated at all when Tailwind is not selected
- React + Solid together: Vite plugins use `include`/`exclude` to disambiguate `.tsx` files
- Secondary frameworks get demo pages at `pages/{fw}-demo/` (each with its own `+config.ts`)
- `@rudderjs/session` is in deps (providers.ts imports it)

### Vike +config.ts Strategy
- **Single framework**: renderer (`vike-react`/`vike-vue`/`vike-solid`) included in root `pages/+config.ts` alongside `vike-photon`. No `pages/index/+config.ts` generated.
- **Multi-framework**: root `pages/+config.ts` has `vike-photon` only (no renderer). Each page/folder has its own `+config.ts` extending the correct renderer. `pages/index/+config.ts` is generated for the primary framework.

### Local Testing
```bash
cd create-rudderjs-app
pnpm build
node dist/index.js        # launches the full interactive CLI
```
