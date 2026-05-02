# Package Status & Monorepo Layout

> This file is read on-demand by Claude Code when working on specific packages.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## Monorepo Layout

```
rudderjs/
├── packages/           # 45 published packages (@rudderjs/*)
│   ├── contracts/      # Pure TypeScript types: AppRequest, ServerAdapter, MiddlewareHandler, etc.
│   ├── support/        # Utilities: Env, Collection, Str, Num, ConfigRepository, resolveOptionalPeer, helpers
│   ├── middleware/     # Middleware base, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware,
│   │                   #   RateLimit / RateLimitBuilder (cache-backed), CsrfMiddleware (getCsrfToken)
│   ├── console/        # CommandRegistry, Command base class, parseSignature, rudder singleton
│   │                   #   (renamed from @rudderjs/rudder)
│   ├── core/           # App bootstrapper, DI container (@Injectable, @Inject), ServiceProvider, AppBuilder,
│   │                   #   FormRequest + validate() + z re-export, dispatch/Listener (events absorbed),
│   │                   #   re-exports: support · contracts types · console
│   ├── router/         # Decorator routing + global router singleton, named routes, signed URLs
│   ├── view/           # Controller views — view('id', props) factory, ViewResponse, html`` tagged template
│   ├── vite/           # Vite plugin suite — view scanner, routes/bootstrap HMR, dev x-real-ip injection
│   ├── orm/            # ORM contract/interface + Model base class (results ARE Model instances)
│   ├── orm-prisma/     # Prisma adapter (multi-driver)
│   ├── orm-drizzle/    # Drizzle adapter (multi-driver: sqlite, postgresql, libsql)
│   ├── queue/          # Queue contract/interface + queue:work command, Chain, Bus.batch, job middleware
│   ├── queue-inngest/  # Inngest adapter — events named rudderjs/job.<ClassName>
│   ├── queue-bullmq/   # BullMQ adapter — default prefix 'rudderjs'
│   ├── server-hono/    # Hono adapter (HonoConfig, logger [rudderjs] tag, CORS, ViewResponse, multi-Set-Cookie)
│   ├── hash/           # Password hashing — Hash facade, BcryptDriver, Argon2Driver, hash() factory
│   ├── crypt/          # Symmetric encryption — Crypt facade, AES-256-CBC + HMAC-SHA256, crypt() factory
│   ├── session/        # Cookie sessions — sessionMiddleware (auto-installed on web group), drivers
│   ├── auth/           # Native auth: Guards (SessionGuard), Providers (EloquentUserProvider), Auth facade,
│   │                   #   Gate/Policy authorization, PasswordBroker, AuthMiddleware (auto-installed on web)
│   │                   #   Depends on @rudderjs/hash + @rudderjs/session
│   ├── sanctum/        # API tokens — Sanctum class, TokenGuard, SanctumMiddleware, RequireToken,
│   │                   #   SHA-256 hashed tokens with abilities
│   ├── passport/       # OAuth 2 server — JWT (RS256), 5 grant types (auth code + PKCE, client credentials,
│   │                   #   refresh token, device authorization), BearerMiddleware, scope() enforcement,
│   │                   #   HasApiTokens mixin, passport:keys/client/purge CLI commands
│   ├── socialite/      # OAuth client — Socialite facade, SocialUser, 4 built-in providers (GitHub, Google,
│   │                   #   Facebook, Apple), extensible
│   ├── cashier-paddle/  # Paddle billing — Billable mixin, SubscriptionResource (cancel/swap/pause),
│   │                    #   signed webhook receiver, Checkout sessions (overlay + inline + guest),
│   │                    #   single charges, refunds, price previews, React components
│   │                    #   (CheckoutButton/InlineCheckout/PaddleScript), cashier:install/webhook/sync CLI
│   ├── storage/        # Storage facade, LocalAdapter + S3Adapter (built-in), storage:link command
│   │                   #   S3 driver requires optional dep: @aws-sdk/client-s3
│   ├── schedule/       # Task scheduler — schedule singleton, scheduler() factory
│   ├── cache/          # Cache facade, MemoryAdapter + RedisAdapter (built-in)
│   │                   #   Redis driver requires optional dep: ioredis
│   ├── mail/           # Mailable, Mail facade, LogAdapter + SMTP (Nodemailer), mail() factory
│   ├── notification/   # Multi-channel notifications (mail, database, broadcast)
│   ├── broadcast/      # WebSocket broadcasting — public, private, presence channels
│   ├── sync/           # Real-time collaborative document sync via Yjs CRDT — /ws-sync endpoint
│   │                   #   Built-in: MemoryPersistence. Optional: syncPrisma(), syncRedis()
│   │                   #   Editor adapters under subpaths: @rudderjs/sync/lexical, /tiptap
│   ├── image/          # Fluent image processing — resize, crop, convert, optimize. Thin wrapper over sharp.
│   ├── ai/             # AI engine — 9 providers, Agent class, tools, streaming, middleware, structured output,
│   │                   #   conversations, attachments, queue, image gen, TTS/STT, provider tools (WebSearch/WebFetch),
│   │                   #   Vercel AI protocol, cached embeddings, AI facade, AiFake
│   ├── boost/          # AI dev tools — MCP server (11 tools), boost:install/update commands, guidelines/skills system, MCP resources, custom agents
│   ├── mcp/            # MCP server framework — McpServer, McpTool, McpResource, McpPrompt, stdio + HTTP transports
│   ├── log/            # Structured logging — channels (console, single, daily, stack, null), RFC 5424 levels,
│   │                   #   LineFormatter/JsonFormatter, context propagation (per-channel + shared), listeners,
│   │                   #   LogFake for testing, extendLog() for custom drivers
│   ├── http/           # HTTP client — fluent fetch wrapper, retries, timeouts, pools, interceptors, Http.fake()
│   ├── localization/   # i18n — trans(), setLocale(), locale-aware middleware, JSON translation files
│   ├── testing/        # TestCase, TestResponse assertions, RefreshDatabase, WithFaker, actingAs(),
│   │                   #   database assertions, HTTP request helpers (get/post/put/patch/delete)
│   ├── context/        # Request-scoped context — ALS-backed data bag, hidden context, stacks,
│   │                   #   scope(), remember(), dehydrate/hydrate for queue propagation, log integration
│   ├── pennant/        # Feature flags — Feature.define/active/value, scoping, Lottery rollout,
│   │                   #   memory driver, FeatureMiddleware, Feature.fake()
│   ├── process/        # Shell execution — Process.run/start/pool/pipe, timeouts, env vars,
│   │                   #   real-time output, Process.fake() with assertions
│   ├── concurrency/    # Parallel execution — worker thread pool, Concurrency.run/defer,
│   │                   #   sync driver for testing, Concurrency.fake()
│   ├── telescope/      # Dev inspector — 17 collectors (request, query, job, exception, log, mail, http, ai, mcp, …)
│   ├── pulse/          # App metrics dashboard — 7 aggregators, time-series 1-min buckets, cross-process SQLite
│   ├── horizon/        # Deep queue monitor — job lifecycle (queueObservers), per-queue metrics, worker status, retry/delete
│   └── cli/            # make:*, module:*, module:publish, providers:discover, rudder user commands
├── create-rudder-app/   # Interactive scaffolder CLI — see docs/claude/create-app.md
├── docs/               # VitePress documentation site
└── playground/         # Demo app — primary integration reference
```

---

## Package Status

| Package | Version | Notes |
|---|---|---|
| `@rudderjs/contracts` | 1.1.0 | TypeScript contracts + runtime helpers: AppRequest (typed input accessors), AppResponse, ServerAdapter, MiddlewareHandler, `InputTypeError`, `attachInputAccessors` |
| `@rudderjs/support` | 1.1.0 | Collection (30+ methods), Str (35+ helpers), Num (9 helpers), Env, defineEnv, ConfigRepository, resolveOptionalPeer, helpers |
| `@rudderjs/middleware` | 1.0.0 | Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware, RateLimit, CsrfMiddleware (`getCsrfToken()`) |
| `@rudderjs/console` | 0.0.4 | CommandRegistry, Command base, parseSignature, rudder singleton — still 0.x; renamed from `@rudderjs/rudder`, deferred from first 1.0 wave |
| `@rudderjs/core` | 1.0.0 | Application, DI container, ServiceProvider, Forge, AppBuilder, `HttpException`, `abort()`, `abort_if()`, `abort_unless()`, `report()`, `report_if()`, `setExceptionReporter()`, `Event.fake()` (EventFake: assertDispatched/assertNotDispatched/assertNothingDispatched), `container.scoped()` (per-request bindings via ALS), `container.when(Class).needs(token).give(factory)` (contextual binding), deferred providers (`provides(): string[]`), `container.runScoped(fn)`, `ScopeMiddleware()`, FormRequest + `validate()` + `z` re-export (validation absorbed) |
| `@rudderjs/server-hono` | 1.0.1 | Hono adapter, logger `[rudderjs]` tag, CORS, ViewResponse handling (Vike SSR), multi-value Set-Cookie support |
| `@rudderjs/router` | 1.0.0 | Fluent + decorator routing, named routes, `route()` URL generation, `Url` signed URLs (HMAC-SHA256), `ValidateSignature()` middleware — metadata keys: `rudderjs:controller:*/route:*` |
| `@rudderjs/view` | 1.0.0 | Controller views — `view('id', props)` factory, `ViewResponse`, `html\`\`` tagged template (auto-escaping), `escapeHtml()`, `SafeString`. Discovered by `@rudderjs/vite` scanner from `app/Views/**`. |
| `@rudderjs/vite` | 0.0.7 | Vite plugin suite — `rudderjs:routes` (HMR for routes/bootstrap/app), `rudderjs:ip` (dev `x-real-ip` injection), view scanner (PascalCase → kebab-case page generation). Still 0.x; deferred from first 1.0 wave. |
| `@rudderjs/queue` | 4.1.0 | Job, QueueAdapter, DispatchBuilder, SyncAdapter, queue:work/status/clear/failed/retry commands, `Chain.of()` (sequential execution, state sharing, `onFailure`), `Bus.batch()` (`then`/`catch`/`finally`, progress tracking, `allowFailures`), `ShouldBeUnique`/`ShouldBeUniqueUntilProcessing` (cache-backed locks), job middleware (`RateLimited`, `WithoutOverlapping`, `ThrottlesExceptions`, `Skip`), `dispatch(fn)` queued closures, `Queue.fake()` (FakeQueueAdapter: assertPushed/assertPushedOn/assertNotPushed/assertNothingPushed) |
| `@rudderjs/queue-inngest` | 1.0.0 | Inngest adapter — events: `rudderjs/job.<ClassName>` |
| `@rudderjs/queue-bullmq` | 1.1.0 | BullMQ Redis-backed queue — default prefix: `'rudderjs'`, per-queue id namespacing, worker-only metrics gate |
| `@rudderjs/orm` | 1.3.0 | Model, QueryBuilder (results ARE Model instances), ModelRegistry, Attribute casts (`boolean`, `date`, `json`, `encrypted`, custom `CastUsing`), `Attribute.make({ get, set })` accessors/mutators, `@Hidden`/`@Visible`/`@Appends`/`@Cast` decorators, instance `makeVisible()`/`makeHidden()`/`setVisible()`/`setHidden()`, mass assignment (`fillable`/`guarded`), `Model.increment()`/`decrement()`, `JsonResource`/`ResourceCollection` (conditional: `when`/`whenLoaded`/`whenNotNull`/`mergeWhen`), `ModelCollection` (wrap/find/contains/except/only/diff/unique/fresh/load/toQuery), `ModelFactory`/`sequence()`, ModelObserver registry |
| `@rudderjs/orm-prisma` | 1.2.0 | Prisma adapter, multi-driver |
| `@rudderjs/orm-drizzle` | 0.1.0 | Drizzle adapter — multi-driver (sqlite, postgresql, libsql). Still 0.x; deferred from first 1.0 wave. |
| `@rudderjs/cli` | 4.0.1 | make:* (model, provider, middleware, controller, request, job, command, event, listener, mail, agent, mcp-server, mcp-tool, mcp-resource, mcp-prompt), module:*, module:publish, providers:discover |
| `@rudderjs/hash` | 1.0.0 | Password hashing — Hash facade, BcryptDriver, Argon2Driver, hash() factory |
| `@rudderjs/crypt` | 1.0.0 | Symmetric encryption — Crypt facade, AES-256-CBC + HMAC-SHA256, parseKey(), crypt() factory |
| `@rudderjs/session` | 1.0.2 | Cookie sessions — `sessionMiddleware`, AsyncLocalStorage-backed `Session.get()/put()/flash()`, drivers (memory, cookie, file). Auto-installed on `web` group by `SessionProvider`. |
| `@rudderjs/auth` | 4.0.2 | Native auth: Guards (SessionGuard), Providers (EloquentUserProvider), Auth facade, Gate/Policy, PasswordBroker, AuthMiddleware(), RequireAuth(), `MustVerifyEmail` interface, `EnsureEmailIsVerified()` middleware, `verificationUrl()`, `handleEmailVerification()`. Depends on hash + session. Auto-installs `AuthMiddleware` on `web` group. |
| `@rudderjs/sanctum` | 6.0.0 | API tokens — Sanctum class, TokenGuard, SanctumMiddleware(), RequireToken(), SHA-256 hashed tokens with abilities |
| `@rudderjs/passport` | 1.0.0 | OAuth 2 server (Laravel Passport equivalent) — JWT (RS256), authorization code + PKCE, client credentials, refresh token, device authorization grants; `registerPassportRoutes()` for 8 `/oauth/*` endpoints; `BearerMiddleware`/`RequireBearer`/`scope()` middleware; `HasApiTokens` mixin for personal access tokens; `passport:keys`/`passport:client`/`passport:purge` CLI commands |
| `@rudderjs/socialite` | 1.0.0 | OAuth client — Socialite facade, SocialUser, 4 built-in providers (GitHub, Google, Facebook, Apple), extensible |
| `@rudderjs/cashier-paddle` | 2.0.0 | Paddle billing — `Billable(Model)` mixin, `SubscriptionResource` (cancel/swap/pause/resume/quantity/charge), Checkout sessions (overlay/inline/guest), single charges + refunds + credits, `previewPrices()`, signed webhook receiver (raw-body capture + HMAC verify, idempotent), 7 framework events (`cashier.subscription.{created,updated,paused,canceled}`, etc.), React drop-ins (CheckoutButton/InlineCheckout/PaddleScript), `cashier:install`/`cashier:webhook`/`cashier:sync` CLI |
| `@rudderjs/storage` | 1.0.0 | Storage facade, LocalAdapter + S3Adapter built-in (needs `@aws-sdk/client-s3`), `storage:link` command for public disk |
| `@rudderjs/schedule` | 1.0.0 | Task scheduler, schedule:run/work/list, sub-minute (`everyFiveSeconds`..`everyThirtySeconds`), hooks (`before`/`after`/`onSuccess`/`onFailure`), `withoutOverlapping(expiresAt)`, `evenInMaintenanceMode()`, `onOneServer()` (cache-backed distributed lock) |
| `@rudderjs/cache` | 1.0.0 | Cache facade, MemoryAdapter + RedisAdapter built-in (needs `ioredis`), `Cache.fake()` (FakeCacheAdapter: assertSet/assertGet/assertForgotten/assertFlushed) |
| `@rudderjs/mail` | 1.0.0 | Mailable, Mail facade, LogAdapter + SMTP (Nodemailer), `FailoverAdapter` (ordered mailer fallback), `MarkdownMailable` (markdown->responsive HTML, components: button/panel/table/header/footer), `Mail.to().queue()`/`.later(delay)` (queued via `@rudderjs/queue`), `mailPreview()` route handler, mail() factory, `Mail.fake()` (FakeMailAdapter: assertSent/assertNotSent/assertQueued/assertNothingSent) |
| `@rudderjs/notification` | 1.0.0 | Notifiable, Notification, ChannelRegistry, notify(), `ShouldQueue` (queued notifications via `@rudderjs/queue`), `BroadcastChannel` (WebSocket via `@rudderjs/broadcast`), `AnonymousNotifiable`/`Notification.route()` (on-demand notifications), `Notification.fake()` (NotificationFake: assertSentTo/assertNotSentTo/assertCount) |
| `@rudderjs/broadcast` | 1.0.0 | WebSocket channels — broadcasting(), broadcast(), broadcasting.auth(), BKSocket client |
| `@rudderjs/sync` | 0.2.2 | Yjs CRDT real-time document sync — sync(), MemoryPersistence, syncPrisma(), syncRedis(); editor adapters under subpaths (`@rudderjs/sync/lexical` available, `@rudderjs/sync/tiptap` scaffolded). Renamed from `@rudderjs/live` in 0.1.0. Still 0.x; deferred from first 1.0 wave. |
| `@rudderjs/image` | 1.0.0 | Fluent image processing — resize, crop, convert, optimize, batch conversions (`generateToStorage`). Wraps sharp (optional peer). |
| `@rudderjs/ai` | 1.0.0 | AI engine — 9 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), Agent class, tool system (server + client), async-generator tool execute with `tool-update` chunks, `.modelOutput(fn)` for decoupling model-input from UI/result, generative-UI registry, **`ToolCallContext`** (optional second arg to `ToolExecuteFn` carrying `toolCallId`), **`pauseForClientTools(toolCalls, handle)`** control chunk a server tool can yield to halt the loop and surface nested client-tool calls upward (the building block for sub-agent client-tool round-trips), streaming, middleware (wired into agent loop), structured output, conversation memory (`forUser()`/`continue()`), file/image attachments (`Document`/`Image`), queue integration (`agent.queue()`), image generation (`AI.image()`/`ImageGenerator`), TTS (`AI.audio()`/`AudioGenerator`), STT (`AI.transcribe()`/`Transcription`), provider tools (`WebSearch`/`WebFetch`/`CodeExecution`), Vercel AI Data Stream Protocol (`toVercelDataStream`/`toVercelResponse`), cached embeddings (`CachedEmbeddingAdapter`), batch embedding auto-chunking, Google+Mistral embeddings, AI facade, AiFake. Runtime-agnostic main entry; `AiProvider` lives at `/server` subpath. |
| `@rudderjs/boost` | 1.0.0 | AI dev tools — MCP server (11 tools: app_info, db_schema, route_list, model_list, config_get, last_error, db_query, read_logs, browser_logs, get_absolute_url, search_docs), MCP resources (guidelines://), `boost:install`/`boost:update` commands, `Boost.registerAgent()` for custom agents, auto-generated AI guidelines and skills from installed packages |
| `@rudderjs/mcp` | 4.0.0 | MCP server framework — `McpServer`, `McpTool`, `McpResource`, `McpPrompt` base classes, `@Name`/`@Version`/`@Instructions`/`@Description` decorators, `Mcp.web()`/`Mcp.local()` registration, stdio + HTTP transports, `McpTestClient` for testing, `mcp:start`/`mcp:list` CLI commands, `make:mcp-server`/`make:mcp-tool`/`make:mcp-resource`/`make:mcp-prompt` scaffolders |
| `@rudderjs/log` | 1.0.0 | Structured logging — channels (console, single, daily, stack, null), RFC 5424 levels, LineFormatter/JsonFormatter, per-channel + shared context, listeners, `LogFake` for testing, `extendLog()` for custom drivers |
| `@rudderjs/http` | 1.0.0 | Fluent HTTP client — `Http` facade, retries, timeouts, pools (`Pool.concurrency()`), request/response interceptors, `Http.fake()` with URL pattern matching + assertions, observer registry at `/observers` subpath |
| `@rudderjs/localization` | 1.0.0 | i18n — `trans()`, `setLocale()`, `getLocale()`, locale middleware, JSON translation files |
| `@rudderjs/testing` | 1.0.0 | TestCase base class, TestResponse assertions (assertOk/assertJson/assertJsonPath/assertJsonCount/assertHeader/assertRedirect), RefreshDatabase trait, WithFaker trait, database assertions (assertDatabaseHas/Missing/Count/Empty), HTTP request helpers (get/post/put/patch/delete), actingAs(user) |
| `@rudderjs/context` | 1.0.0 | Request-scoped context — `Context` facade (add/get/all/forget/has), hidden context, stacks (push/stack), `scope()` (child isolation), `remember()` (memoize), `dehydrate()`/`hydrate()` (queue propagation), `ContextMiddleware()`, auto-merges into `@rudderjs/log` entries |
| `@rudderjs/pennant` | 1.0.0 | Feature flags — `Feature.define()`/`active()`/`value()`, scoping (`Feature.for(scope)`), `Feature.values()` bulk, `Lottery.odds()` gradual rollout, `activate()`/`deactivate()`/`purge()`, MemoryDriver, `FeatureMiddleware()`, `Feature.fake()` |
| `@rudderjs/process` | 1.0.0 | Shell execution — `Process.run()`/`start()`/`pool()`/`pipe()`, `PendingProcess` builder (path/timeout/env/input/quietly/tty/onOutput), `ProcessResult` (successful/failed/throw), `RunningProcess`, `Process.fake()` with assertions |
| `@rudderjs/concurrency` | 1.0.0 | Parallel execution — `Concurrency.run(tasks)` via worker threads, `Concurrency.defer(fn)` fire-and-forget, sync driver for testing via `Concurrency.fake()` |
| `@rudderjs/telescope` | 11.0.0 | Dev inspector — 17 collectors (request, query, job, exception, log, mail, notification, event, cache, schedule, model, http, ai, mcp, gate, view, …), JSON API, `Telescope` facade, `TelescopeRegistry`, memory + SQLite storage (cross-process), `telescope()` factory, batchId correlation |
| `@rudderjs/pulse` | 6.1.1 | App metrics — 7 aggregators (request, queue, cache, exception, user, query, server), time-series 1-min buckets, individual entries (slow requests/queries, exceptions, failed jobs), JSON API, `Pulse` facade, `PulseRegistry`, memory + SQLite (WAL, cross-process) storage, `pulse()` factory |
| `@rudderjs/horizon` | 6.0.0 | Queue monitor — full job lifecycle tracking (pending→processing→completed/failed) via `queueObservers`, per-queue metrics (throughput, wait time, runtime), worker status, failed job retry/delete, JSON API, `Horizon` facade, `HorizonRegistry`, memory + SQLite storage, `horizon()` factory. BullMQ direct dep. |

**Merged/removed packages** (code absorbed, originals deleted):
- `@rudderjs/di` -> merged into `@rudderjs/core`
- `@rudderjs/validation` -> merged into `@rudderjs/core` (FormRequest, validate(), z re-export)
- `@rudderjs/events` -> merged into `@rudderjs/core` (dispatch, Listener)
- `@rudderjs/rate-limit` -> merged into `@rudderjs/middleware`
- `@rudderjs/storage-s3` -> merged into `@rudderjs/storage`
- `@rudderjs/cache-redis` -> merged into `@rudderjs/cache`
- `@rudderjs/mail-nodemailer` -> merged into `@rudderjs/mail`

**Renamed packages:**
- `@rudderjs/rudder` -> `@rudderjs/console` (2026-04-28; PR #97)
- `@rudderjs/live` -> `@rudderjs/sync` (2026-04-27)

**Extracted packages** (moved out of this monorepo to a separate project):
- `@rudderjs/panels`, `@rudderjs/panels-lexical`, `@rudderjs/media`, `@rudderjs/workspaces` were extracted into a separate admin/CMS-flavored project. They are not part of the framework anymore.

## Adding a New Provider Package

When adding a new framework package that ships a service provider, declare it in `package.json` so `defaultProviders()` picks it up automatically:

```json
{
  "name": "@rudderjs/my-package",
  "rudderjs": {
    "provider": "MyPackageProvider",
    "stage":    "feature",
    "depends":  ["@rudderjs/cache"],
    "optional": false
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `provider` | Yes | The PascalCase class name exported from the package's main entry. |
| `stage` | Yes | One of `foundation`, `infrastructure`, `feature`, `monitoring`. Determines boot order. |
| `depends` | No | Package names that must boot before this one. Topo-sorted within each stage. |
| `optional` | No | If `true`, missing peer is silently skipped instead of warning. Use for drivers (e.g. `orm-prisma`). |
| `autoDiscover` | No | Set to `false` to opt the package out of auto-discovery — users must register it manually. |

After adding the field, users run `pnpm rudder providers:discover` to refresh the manifest. New `*Provider` classes must extend `ServiceProvider` from `@rudderjs/core` and read their config from `config<TConfig>('key')` inside `boot()` (not from a constructor argument). See `packages/cache/src/index.ts` as the reference shape.

For the full third-party-author guide (manifest format, opt-out paths, common errors), see `docs/guide/service-providers.md`.
