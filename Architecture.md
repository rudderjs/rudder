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
| Runtime | Node.js 22+ / Bun |
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
├── packages/               # Framework packages (@rudderjs/*)
│   ├── contracts/          # Pure TypeScript types + runtime helpers
│   │                       #   AppRequest (typed input accessors), AppResponse, ServerAdapter,
│   │                       #   MiddlewareHandler, InputTypeError, attachInputAccessors
│   ├── support/            # Utilities: Env, Collection (30+ methods), Str (35+ helpers),
│   │                       #   Num (9 helpers), ConfigRepository, resolveOptionalPeer
│   ├── middleware/         # Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware
│   │                       #   + RateLimit / RateLimitBuilder (cache-backed)
│   ├── validation/         # FormRequest, validate(), validateWith(), ValidationError, z re-export
│   ├── console/            # CommandRegistry, Command base class, parseSignature, rudder singleton
│   │                       #   (renamed from rudder/ in PR #97 to avoid confusion with the cli runner)
│   ├── core/               # Application, ServiceProvider, AppBuilder, DI container
│   │                       #   HttpException, abort(), abort_if(), abort_unless(), report(),
│   │                       #   ExceptionHandler, EventDispatcher, dispatch()
│   │                       #   re-exports: di · support · contracts types · rudder
│   ├── router/             # Decorator + fluent routing, named routes, route() URL generation,
│   │                       #   Url class (HMAC-SHA256 signed URLs), ValidateSignature() middleware
│   ├── view/               # Laravel-style controller views — view('id', props) returns a
│   │                       #   ViewResponse that server-hono resolves through Vike's renderPage().
│   │                       #   Typed React/Vue/Solid components from app/Views/ with full SSR +
│   │                       #   SPA navigation (no Inertia adapter, no JSON envelope)
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
│   ├── passport/           # Full OAuth2 server — authorization-code (with PKCE), client-credentials,
│   │                       #   refresh-token, device-code grants. RSA-signed JWT bearer tokens,
│   │                       #   Personal Access Tokens, scopes, token revocation. `RequireBearer()`
│   │                       #   + `scope(...)` for API auth. CLI: passport:keys/client/purge
│   ├── socialite/          # OAuth — Socialite facade, SocialUser, 4 built-in providers
│   │                       #   (GitHub, Google, Facebook, Apple), extensible
│   ├── cashier-paddle/     # Paddle billing — Billable mixin, SubscriptionResource (cancel/swap/pause),
│   │                       #   signed webhook receiver (raw-body + HMAC verify, idempotent), Checkout
│   │                       #   sessions (overlay/inline/guest), single charges, refunds, previewPrices(),
│   │                       #   React drop-ins, cashier:install/webhook/sync CLI
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
│   ├── sync/               # Real-time collaborative document sync via Yjs CRDT — /ws-sync endpoint
│   │                       #   Editor adapters under subpaths (@rudderjs/sync/lexical, /tiptap)
│   ├── ai/                 # AI engine — 15 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek,
│   │                       #   xAI, Mistral, Bedrock, Azure text; Cohere, Jina, Voyage reranking+embeddings;
│   │                       #   ElevenLabs TTS; OpenRouter aggregator). Agent class, tool system, streaming,
│   │                       #   middleware, structured output, conversation persistence, eval framework,
│   │                       #   budget tracking, computer-use, MCP bridge. Runtime-agnostic main entry
│   │                       #   (browser/RN/Electron OK); Node helpers at `/node`; AiProvider at `/server`
│   ├── mcp/                # MCP server framework — `@McpServer` / `@Tool` / `@Resource` / `@Prompt`
│   │                       #   decorators, stdio + Streamable HTTP transports, OAuth2 protection
│   │                       #   via @rudderjs/passport. mcp:start/list/inspector + make:mcp-*
│   ├── pennant/            # Feature flags — Pennant facade, scope-aware `Feature.for(user).active(...)`,
│   │                       #   purgable lottery results, custom drivers
│   ├── telescope/          # Debug assistant — 19 collectors (requests, queries, models, logs, mail, jobs,
│   │                       #   events, ai, mcp, ...), dashboard at /telescope, real-time SSE updates,
│   │                       #   sqlite/redis storage adapters
│   ├── pulse/              # Application metrics — 7 aggregators (slow requests, slow queries, exceptions,
│   │                       #   cache hit-rate, user activity, ...), dashboard at /pulse
│   ├── horizon/            # Queue dashboard — job lifecycle, worker status, throughput, wait times,
│   │                       #   tag filtering. Dashboard at /horizon
│   ├── concurrency/        # Process-based + worker-thread fan-out — `Concurrency.run([...fns])`
│   ├── context/            # Request-scoped context — AsyncLocalStorage facade, propagates across
│   │                       #   awaits/jobs/queues without manual threading
│   ├── process/            # Async process runner — `Process.run('cmd', { ... })`, streaming output,
│   │                       #   `.fake()` for testing
│   ├── terminal/           # `terminal('id', props)` — Ink/React components rendered in rudder commands.
│   │                       #   Files in `app/Terminal/<Name>.tsx`, same dot-notation as `view()`
│   ├── vite/               # Vite + Vike integration plugin — views-scanner generates `pages/__view/*`,
│   │                       #   `rudderjs:routes` watcher (routes/, bootstrap/, app/), `rudderjs:ws`
│   │                       #   upgrade patch for broadcast/sync, `rudderjs:ip` dev-mode header injection
│   ├── image/              # Fluent image processing — resize, crop, convert, optimize (wraps sharp)
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
├── create-rudder-app/      # Interactive CLI scaffolder (pnpm create rudder-app)
│                           #   Cascade-aware prompts: name · ORM (Prisma/Drizzle/None) · DB driver
│                           #   · 8-category package multiselect · frameworks · primary · Tailwind ·
│                           #   shadcn · demos (filtered by package picks). 14 demos shipped, all
│                           #   driven by a single registry exported as create-rudder-app/demos-registry
│                           #   so the playground reuses the same metadata. Published on npm.
├── .github/workflows/      # CI (build, typecheck, lint, test) + Release (Changesets auto-publish)
├── docs/                   # VitePress documentation site
└── playground/             # Framework demo app (port 3000) — auth, routing, ORM, queue, mail,
                            #   cache, storage, scheduling, broadcast, sync, AI agents, monitoring
```

**Merged/removed packages** (code absorbed, originals deleted):
- `@rudderjs/di` → merged into `@rudderjs/core`
- `@rudderjs/rate-limit` → merged into `@rudderjs/middleware`
- `@rudderjs/storage-s3` → merged into `@rudderjs/storage`
- `@rudderjs/cache-redis` → merged into `@rudderjs/cache`
- `@rudderjs/mail-nodemailer` → merged into `@rudderjs/mail`
- `@rudderjs/events` → merged into `@rudderjs/core`

---

## CI/CD

**GitHub Actions workflows** at `.github/workflows/`:

- **`ci.yml`** — runs on every push/PR to main: `pnpm build` → `pnpm turbo run typecheck --filter='./packages/*' --filter='./create-rudder-app'` → `pnpm lint` → `pnpm test`. Scoped to packages (excludes playgrounds which may reference WIP exports).
- **`release.yml`** — runs on push to main. Uses `changesets/action@v1` to either create a "Version Packages" PR (when changesets exist) or publish to npm (when the version PR is merged). Requires `NPM_TOKEN` secret with 2FA bypass enabled.

**Incremental TypeScript builds** — `tsconfig.base.json` has `incremental: true` and `tsBuildInfoFile: "./dist/.tsbuildinfo"`. Cold build ~32s, single-package change ~10s, full cache hit ~400ms. Build artifacts (`*.tsbuildinfo`) are gitignored.

**Release workflow gotchas:**
- Org-level AND repo-level "Workflow permissions" must be set to **Read and write** with **"Allow GitHub Actions to create and approve pull requests"** checked
- NPM token must be **Granular Access Token** with **"Bypass two-factor authentication"** enabled, scoped to **All packages** (covers both `@rudderjs/*` and `create-rudder-app`)

**Release flow:**
1. `pnpm changeset` locally → select packages + semver bump + summary
2. `git push` → CI runs, release workflow creates Version Packages PR
3. Review + merge the PR → release workflow publishes to npm

---

## Playground Dev Notes

Kill stale listeners before starting dev if you hit `EADDRINUSE`:

```bash
lsof -ti :24678 -ti :3000 | xargs kill -9
cd playground && pnpm dev
```

### Dev Hot Reloading

`@rudderjs/vite` includes three plugins that handle dev-time reloading:

| Plugin | Watches | Mechanism |
|---|---|---|
| `rudderjs:routes` | `routes/`, `bootstrap/`, `app/` | Clears `__rudderjs_instance__` + `__rudderjs_app__` singletons, invalidates all SSR modules, sends `full-reload` to browser. `app/` is included because models/resources/controllers are captured in closures during provider boot. |
| `views-scanner` | `app/Views/` | Regenerates Vike page stubs (`pages/__view/`) and triggers Vike HMR |
| `rudderjs:ws` | — | Patches WebSocket upgrade on Vite's HTTP server for broadcast/sync |
| `rudderjs:ip` | — | Dev-only: injects `x-real-ip` from `req.socket.remoteAddress` so `req.ip` works the same as in production |

**Why route files need special handling:** `withRouting({ web: () => import('../routes/web.ts') })` uses lazy dynamic imports stored in closures — Vite never adds them to its SSR module graph, so changes are invisible to HMR. The `rudderjs:routes` plugin explicitly watches these directories and triggers a clean re-bootstrap.

**Why `server.restart()` doesn't work:** it closes the Vite module runner, breaking any in-flight SSR request that references the old RudderJS instance. SSR module graph invalidation is the correct approach — the runner stays alive, and the next request re-executes `bootstrap/app.ts` which creates a fresh instance.

**What auto-reloads vs. what doesn't:**
- **Auto-reloads:** Views (`app/Views/`), route files (`routes/`), bootstrap files (`bootstrap/`), controllers/models/middleware (tracked by Vite's SSR module graph)
- **Requires `pnpm build`:** Changes to framework packages in `packages/` (they compile to `dist/`)

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
│   ├── Views/                  # Laravel-style view components rendered by view('id', props)
│   │   ├── Welcome.tsx         #   export const route = '/'  → URL /   (Laravel welcome page)
│   │   ├── Dashboard.tsx       #   id: 'dashboard' → URL /dashboard (default, no override)
│   │   ├── Auth/
│   │   │   ├── Login.tsx       #   export const route = '/login'    → URL /login
│   │   │   ├── Register.tsx    #   export const route = '/register'  → URL /register
│   │   │   └── ForgotPassword.tsx
│   │   └── Admin/
│   │       └── Users.tsx       #   id: 'admin.users' → URL /admin/users
│   ├── Jobs/                   # Queue jobs
│   ├── Mail/                   # Mailable classes
│   └── Notifications/          # Notification classes
│
├── pages/                      # Vike file-based routing (SSR pages)
│   ├── users/@id/              # Optional — use only for pages that really are file-routed
│   │   ├── +Page.tsx
│   │   └── +data.ts
│   └── __view/                 # AUTO-GENERATED by @rudderjs/vite from app/Views/**
│       │                       #   (committed, NOT gitignored — Vike discovers pages via git ls-files)
│       ├── +config.ts          #   passToClient: ['viewProps']
│       ├── welcome/
│       │   ├── +Page.tsx       #   wraps app/Views/Welcome.tsx
│       │   ├── +route.ts       #   export default '/'  (from Welcome.tsx's `export const route`)
│       │   └── +data.ts
│       └── dashboard/
│           ├── +Page.tsx       #   wraps app/Views/Dashboard.tsx, reads viewProps
│           ├── +route.ts       #   export default '/dashboard' (id-derived, no override)
│           └── +data.ts        #   no-op hook (required for SPA pageContext.json fetch)
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
│    ├── @rudderjs/view               Laravel-style view('id', props) controller responses
│    ├── @rudderjs/terminal           terminal('id', props) — Ink/React components in rudder commands
│    ├── @rudderjs/server-hono        Hono HTTP adapter, production WS upgrade
│    ├── @rudderjs/console             Command registry, base class
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
│    ├── @rudderjs/passport           Full OAuth2 server (4 grants, PKCE, RSA-JWT, scopes, PATs)
│    ├── @rudderjs/socialite          OAuth (GitHub, Google, Facebook, Apple)
│    └── @rudderjs/cashier-paddle     Paddle billing (Billable mixin, subscriptions, webhooks)
│
├─── Communication
│    ├── @rudderjs/mail               Mailable, SMTP, Failover, Markdown, Mail.fake()
│    ├── @rudderjs/notification       Multi-channel, queued, Notification.fake()
│    ├── @rudderjs/broadcast          WebSocket channels (public, private, presence)
│    └── @rudderjs/sync               Yjs CRDT document sync engine + editor adapters (Lexical available, Tiptap scaffolded)
│
├─── Utilities
│    ├── @rudderjs/log                Structured logging, channels, LogFake
│    ├── @rudderjs/http               Fluent fetch, retries, pools, Http.fake()
│    ├── @rudderjs/schedule           Cron tasks, sub-minute, hooks, onOneServer
│    ├── @rudderjs/localization       i18n, trans(), locale middleware
│    ├── @rudderjs/image              Image processing (sharp wrapper)
│    ├── @rudderjs/pennant            Feature flags, scoped, purgable
│    ├── @rudderjs/context            AsyncLocalStorage facade, propagates across awaits/jobs
│    ├── @rudderjs/concurrency        Process + worker-thread fan-out
│    ├── @rudderjs/process            Async process runner, streaming output, Process.fake()
│    └── @rudderjs/storage            Local + S3 file storage
│
├─── AI & MCP
│    ├── @rudderjs/ai                 15 providers, Agent, tools, streaming, memory, eval, budget
│    │                                Runtime-agnostic main; Node helpers at /node; AiProvider at /server
│    ├── @rudderjs/mcp                MCP server framework (decorators, stdio + Streamable HTTP, OAuth2)
│    └── @rudderjs/boost              MCP server for AI coding assistants (exposes project to Claude Code etc.)
│
├─── Observability
│    ├── @rudderjs/telescope          Debug assistant (19 collectors, SSE-driven dashboard at /telescope)
│    ├── @rudderjs/pulse              Application metrics (7 aggregators, dashboard at /pulse)
│    └── @rudderjs/horizon            Queue dashboard (lifecycle, workers, throughput at /horizon)
│
├─── Testing
│    └── @rudderjs/testing            TestCase, TestResponse, RefreshDatabase, WithFaker
│
├─── CLI
│    ├── @rudderjs/console            Command registry, base class
│    ├── @rudderjs/terminal           terminal('id', props) — Ink/React components in rudder commands
│    └── @rudderjs/cli                CLI runner — dispatches make:*, queue:*, mcp:*, passport:*, etc.
│
├─── Scaffolding
│    └── create-rudder-app            Interactive project scaffolder
│
└─── Build
     └── @rudderjs/vite               Vike integration, SSR externals, WS patch, route watcher
```

**Clean DAG — no cycles**: `@rudderjs/contracts` holds all shared types. `@rudderjs/router` and `@rudderjs/server-hono` depend only on contracts, not on core. `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer`. Never add `@rudderjs/core` to router's dependencies.

**AI separation**: `@rudderjs/ai` is a generic backend engine (no UI, no Prisma). Higher-level AI features that need a UI (chat sidebars, panel-specific agents, field actions) belong in apps or downstream packages, never in `@rudderjs/ai` itself.

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
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { requestIdMiddleware } from 'App/Http/Middleware/RequestIdMiddleware.ts'
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
    // Global — runs on every request, regardless of route group
    m.use(requestIdMiddleware)

    // Per-group — m.web(...) runs only on routes from web loader,
    // m.api(...) only on routes from the api loader (Laravel-style).
    m.web(RateLimit.perMinute(60))
    m.web(CsrfMiddleware({ exclude: ['/paddle/webhook'] }))
  })
  .create()
```

`bootstrap/providers.ts`:
```ts
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),                       // auto-discovered framework providers
  eventsProvider({ /* event → listeners map */ }),     // app-supplied event listeners
  AppServiceProvider,
]
```

`defaultProviders()` reads `bootstrap/cache/providers.json` (generated by `pnpm rudder providers:discover` and refreshed automatically by the scaffolder on `--install`) and returns provider classes in stage + topo order: foundation → infrastructure → feature → monitoring. Opt out by skipping individual providers (`defaultProviders({ skip: ['@rudderjs/horizon'] })`) or by importing each provider class explicitly and listing them yourself. See `docs/guide/service-providers.md` for the full story.

**`providerSubpath`** — packages can set `"rudderjs.providerSubpath": "./server"` in their `package.json` to tell the auto-discovery loader to import the provider class from a subpath rather than the main entry. Used by `@rudderjs/ai`: the main entry is runtime-agnostic (works in browsers/RN/Electron), so the Node-only `AiProvider` lives at `@rudderjs/ai/server`. The loader resolves to `<package>/<providerSubpath>` automatically — no app-side configuration needed.

**Provider lifecycle:**
1. All `register()` methods run first (bind into container)
2. All `boot()` methods run after (can use container, call DB, etc.)

---

### Entry Point — WinterCG / Vike

`+server.ts` (or `src/index.ts`):
```ts
import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default {
  fetch: app.fetch,
} satisfies Server
```

`Application.configure(...).create()` returns an object exposing `.fetch(request, env?, ctx?)` — the WinterCG-shaped handler that Vike's `Server` type expects. Pass it directly; no wrapper needed.

---

### HTTP Routes — `routes/web.ts` & `routes/api.ts`

Routes are split into two loader-tagged groups. The `web` loader is for stateful, cookie-based traffic (auth, sessions, CSRF); the `api` loader is for stateless JSON. Middleware groups (`m.web(...)` / `m.api(...)` in the bootstrap) prepend to the matching group's stack, Laravel-style.


```ts
import { router, route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { resolve } from '@rudderjs/core'
import { UserService } from '../app/Services/UserService.js'

// JSON API route
router.get('/api/users', async (_req, res) => {
  const users = await resolve(UserService).findAll()
  return res.json({ data: users })
}).name('users.index')

router.get('/api/users/:id', async (req, res) => {
  const user = await resolve(UserService).find(req.params.id)
  return res.json({ data: user })
}).name('users.show')

// Laravel-style controller view — renders app/Views/Dashboard.tsx via Vike SSR
// with controller-supplied props. Middleware runs before the view renders.
router.get('/dashboard', async () => {
  const users = await resolve(UserService).findAll()
  return view('dashboard', { title: 'Dashboard', users })
})

// Welcome page served at the root URL — Welcome.tsx exports
// `export const route = '/'` so the scanner writes `export default '/'`
// into the generated +route.ts, and Vike's client route table matches
// the browser URL for SPA navigation.
router.get('/', async () => view('welcome', { appName: config('app.name') }))

// URL generation from named routes
route('users.show', { id: 42 })  // → '/api/users/42'

// Catch-all
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
```

**How `view()` works internally:** `view('id', props)` returns a `ViewResponse` marked with a static `__rudder_view__` field. `@rudderjs/server-hono` duck-types that marker (no hard import) and calls `result.toResponse()`, which invokes Vike's `renderPage()` with the URL the controller is serving. The `@rudderjs/vite` scanner pre-generates a virtual Vike page at `pages/__view/<id>/` whose `+route.ts` declares the public URL (e.g. `/dashboard`), `+data.ts` is a no-op stub that forces Vike's client router to fetch `pageContext.json` on SPA navigation, and `+Page.tsx` re-exports `app/Views/<Id>.tsx` and passes `pageContext.viewProps` to it. For `.pageContext.json` requests, the outer fetch handler in `server-hono` rewrites them to the bare URL — but only for paths in a registered controller-view set, so Vike's own pages are unaffected.

**Route override for SPA navigation.** By default, the view id maps 1:1 to the URL path (`'dashboard'` → `/dashboard`, `'admin.users'` → `/admin/users`). When a controller needs to serve a view at a URL that doesn't match the id — `view('welcome')` at `/`, or `view('auth.login')` at `/login` — the view file can declare its canonical URL at the top:

```tsx
// app/Views/Welcome.tsx
export const route = '/'
export default function Welcome(props: WelcomeProps) { ... }
```

The scanner reads this constant at discovery time (regex-matched, works inside a `.tsx`, `.jsx`, `.ts`, `.js`, or Vue `<script setup>` block) and writes it verbatim into the generated `+route.ts`. This is **critical** for SPA nav — Vike's client router looks up the browser URL in its route table *before* fetching `pageContext.json`, and a mismatch falls back to a full page reload.

**Framework support.** The scanner auto-detects which Vike renderer is installed by probing `node_modules/vike-{react,vue,solid}/package.json` via `fs.existsSync` (lazy — only runs when `app/Views/` exists, so multi-framework demo projects without controller views don't trip the detection). Four modes are supported:

| Framework | Renderer | File extension | Stub generated |
|---|---|---|---|
| React | `vike-react` | `.tsx` / `.jsx` | `+Page.tsx` |
| Vue | `vike-vue` | `.vue` | `+Page.vue` |
| Solid | `vike-solid` | `.tsx` / `.jsx` | `+Page.tsx` |
| Vanilla (Blade equivalent) | *(none)* | `.ts` / `.js` | `+Page.ts` |

Vanilla mode is the "Blade equivalent" — views export a function returning an HTML string, zero client-side JavaScript, no hydration. `@rudderjs/view` exports `escapeHtml(value)` and an `html\`\`` tagged template literal that auto-escapes interpolations (nested `html\`\`` results pass through via the `SafeString` wrapper). Install exactly one `vike-*` package per project — multi-renderer installs throw a clear error.

**Packages that ship views.** The canonical pattern is `views/<framework>/<Name>.{tsx,vue}` in the package + a `src/routes.ts` exporting `registerXRoutes(router, opts)` helper. `@rudderjs/auth` is the reference implementation — it ships `views/react/{Login,Register,ForgotPassword,ResetPassword}.tsx` (each with `export const route = '/login'` etc.) plus `registerAuthRoutes(router, { middleware, paths, views })` that wires all four routes in one line. Consumers vendor the views into `app/Views/Auth/` (via `vendor:publish --tag=auth-views-react` or the scaffolder) and own them from day one.

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
# Scaffolding (core)
pnpm rudder make:controller UserController
pnpm rudder make:model Post
pnpm rudder make:job SendWelcomeEmail
pnpm rudder make:request CreateUserRequest
pnpm rudder make:middleware AuthMiddleware
pnpm rudder make:provider PaymentServiceProvider
pnpm rudder make:module Blog
pnpm rudder make:command MyCommand
pnpm rudder make:event UserRegistered
pnpm rudder make:listener SendWelcomeEmail
pnpm rudder make:mail WelcomeEmail

# Scaffolding (package-owned — only available when the package is installed)
pnpm rudder make:agent ResearchAgent            # @rudderjs/ai
pnpm rudder make:terminal Dashboard             # @rudderjs/terminal
pnpm rudder make:mcp-server EchoServer          # @rudderjs/mcp
pnpm rudder make:mcp-tool MyTool                # @rudderjs/mcp
pnpm rudder make:mcp-resource AppLog            # @rudderjs/mcp
pnpm rudder make:mcp-prompt CodeReview          # @rudderjs/mcp

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

# Router
pnpm rudder route:list [--json]

# MCP
pnpm rudder mcp:start <name>
pnpm rudder mcp:list
pnpm rudder mcp:inspector

# Passport (OAuth2 server)
pnpm rudder passport:keys                       # generate RSA keys
pnpm rudder passport:client                     # create a client
pnpm rudder passport:purge                      # remove expired tokens / codes

# AI
pnpm rudder ai:eval [pattern] [--bail] [--json] [--record|--replay] [--html out.html]

# Boost (AI coding-assistant integration)
pnpm rudder boost:install [--agent=claude-code,cursor]
pnpm rudder boost:update
pnpm rudder boost:mcp                           # stdio MCP server

# Sync
pnpm rudder sync:docs
pnpm rudder sync:clear <docName>
pnpm rudder sync:inspect <docName>

# Broadcast
pnpm rudder broadcast:connections

# Cashier (Paddle billing)
pnpm rudder cashier:install
pnpm rudder cashier:webhook
pnpm rudder cashier:sync

# Storage / Module / Vendor / Providers / Commands
pnpm rudder storage:link
pnpm rudder module:publish
pnpm rudder vendor:publish --tag=<tag>
pnpm rudder providers:discover                  # refresh bootstrap/cache/providers.json
pnpm rudder command:list
```

**Note on package-owned commands** — commands registered by a feature package (e.g. `make:agent` from `@rudderjs/ai`) only appear in `rudder list` when that package is installed and discovered. Run `pnpm rudder providers:discover` after installing or removing a framework package.

---

### Boost vs MCP — Two Distinct Packages

These are often confused:

- **`@rudderjs/boost`** — an MCP server **about your project** that you point Claude Code / Cursor at, so the assistant can introspect the live app. Tools: `app_info`, `db_schema`, `route_list`, `model_list`, `config_get`, `db_query`, `last_error`, `read_logs`, `browser_logs`, `search_docs`, `commands_list`, `command_run`. Started with `pnpm rudder boost:mcp` (stdio).
- **`@rudderjs/mcp`** — the framework's MCP server **toolkit**, used to build *your own* MCP servers as part of your app. `@McpServer` / `@Tool` / `@Resource` / `@Prompt` decorators, stdio + Streamable HTTP transports, OAuth2 protection via `@rudderjs/passport`.

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
| Phase 2 | Plan 2: ORM & Data Layer (casts, accessors, resources, factories, serialization, hydration, mass assignment, atomic counters, whereHas) | ✅ Complete |
| Phase 2 | Plan 3: Queue & Scheduling (chains, batches, unique, middleware, sub-minute, hooks) | ✅ Complete |
| Phase 3 | Plan 4: Auth & Mail (email verification, queued mail, markdown, failover, queued notifications) | ✅ Complete |
| Phase 4 | Plan 5: Advanced Features (context, pennant, scoped/deferred/contextual bindings, process, concurrency) | ✅ Complete |
| Phase 4 | Plan 6: Testing Infrastructure (TestCase, Queue.fake, Mail.fake, Notification.fake, Event.fake, Cache.fake) | ✅ Complete |
| Phase 5 | Plan 7: Monitoring & Observability — Telescope (19 collectors, real-time SSE dashboard), Pulse (7 aggregators), Horizon (full job lifecycle + worker status) all shipped at 1.0+ and browser-verified end-to-end | ✅ Complete |
| Phase 5 | Plan 8: AI, Boost & MCP — full AI roadmap A1–A7 + B1–B10 + B8.5 (15 providers, prompt caching, agents, tools, streaming, memory, eval framework, budget tracking, computer use, hosted vector stores, conversation persistence, MCP↔Agent bridge), MCP HTTP transport + DI + OAuth2, Boost guidelines & MCP server, Passport OAuth2 (4 grants, PKCE, RSA-JWT) all shipped | ✅ Complete |
| Phase 5 | Plan 9: Sync — Yjs CRDT engine, SSR hydration primitives + onFirstConnect lifecycle hook | ✅ Complete |
| — | Production Build Fixes (node:crypto, WS upgrade, vite externals) | ✅ Complete |
| — | 1.0 graduation — every `@rudderjs/*` package on npm is 1.0.0+; zero packages on 0.x | ✅ 2026-05-02 |
| — | Open-core extraction (admin/CMS packages moved to a separate project) | ✅ Complete |
