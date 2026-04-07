# Package Status & Monorepo Layout

> This file is read on-demand by Claude Code when working on specific packages.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## Monorepo Layout

```
rudderjs/
├── packages/           # 45 published packages (@rudderjs/*)
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
│   ├── panels/         # Admin panel builder — see docs/claude/panels.md for details
│   ├── panels-lexical/ # Lexical rich-text editor adapter — see docs/claude/panels.md
│   ├── image/          # Fluent image processing — resize, crop, convert, optimize. Thin wrapper over sharp.
│   ├── media/          # Media library — Media.make() schema element, file browser, uploads, preview, conversions
│   ├── ai/             # AI engine — 9 providers, Agent class, tools, streaming, middleware, structured output,
│   │                   #   conversations, attachments, queue, image gen, TTS/STT, provider tools (WebSearch/WebFetch),
│   │                   #   Vercel AI protocol, cached embeddings, AI facade, AiFake
│   ├── workspaces/     # AI workspace canvas — Isoflow-style 3D nodes, departments, connections, chat, orchestrator
│   │                   #   Panel plugin: workspaces(). Uses @rudderjs/ai for LLM, Prisma for persistence.
│   ├── boost/          # AI dev tools — MCP server (10 tools), boost:install/update commands, guidelines/skills system
│   ├── mcp/            # MCP server framework — McpServer, McpTool, McpResource, McpPrompt, decorators, testing
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
│   ├── telescope/      # Dev inspector — records requests, queries, jobs, exceptions, logs, mail, etc.
│   ├── pulse/          # App metrics dashboard — request throughput, cache hit rates, server stats
│   └── cli/            # make:*, module:*, module:publish, rudder user commands
├── create-rudderjs-app/   # Interactive scaffolder CLI — see docs/claude/create-app.md
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
| `@rudderjs/core` | 0.0.8 | Application, DI container, ServiceProvider, Forge, AppBuilder, `HttpException`, `abort()`, `abort_if()`, `abort_unless()`, `report()`, `report_if()`, `setExceptionReporter()`, `Event.fake()` (EventFake: assertDispatched/assertNotDispatched/assertNothingDispatched), `container.scoped()` (per-request bindings via ALS), `container.when(Class).needs(token).give(factory)` (contextual binding), deferred providers (`provides(): string[]`), `container.runScoped(fn)`, `ScopeMiddleware()` |
| `@rudderjs/server-hono` | 0.0.2 | Hono adapter, logger `[rudderjs]` tag, CORS |
| `@rudderjs/router` | 0.0.3 | Fluent + decorator routing, named routes, `route()` URL generation, `Url` signed URLs (HMAC-SHA256), `ValidateSignature()` middleware — metadata keys: `rudderjs:controller:*/route:*` |
| `@rudderjs/queue` | 0.0.5 | Job, QueueAdapter, DispatchBuilder, SyncAdapter, queue:work/status/clear/failed/retry commands, `Chain.of()` (sequential execution, state sharing, `onFailure`), `Bus.batch()` (`then`/`catch`/`finally`, progress tracking, `allowFailures`), `ShouldBeUnique`/`ShouldBeUniqueUntilProcessing` (cache-backed locks), job middleware (`RateLimited`, `WithoutOverlapping`, `ThrottlesExceptions`, `Skip`), `dispatch(fn)` queued closures, `Queue.fake()` (FakeQueueAdapter: assertPushed/assertPushedOn/assertNotPushed/assertNothingPushed) |
| `@rudderjs/queue-inngest` | 0.0.2 | Inngest adapter — events: `rudderjs/job.<ClassName>` |
| `@rudderjs/queue-bullmq` | 0.0.2 | BullMQ Redis-backed queue — default prefix: `'rudderjs'` |
| `@rudderjs/orm` | 0.0.6 | Model, QueryBuilder, ModelRegistry, Attribute casts (`boolean`, `date`, `json`, `encrypted`, custom `CastUsing`), `Attribute.make({ get, set })` accessors/mutators, `@Hidden`/`@Visible`/`@Appends`/`@Cast` decorators, instance `makeVisible()`/`makeHidden()`/`setVisible()`/`setHidden()`, `JsonResource`/`ResourceCollection` (conditional: `when`/`whenLoaded`/`whenNotNull`/`mergeWhen`), `ModelCollection` (wrap/find/contains/except/only/diff/unique/fresh/load/toQuery), `ModelFactory`/`sequence()` |
| `@rudderjs/orm-prisma` | 0.0.1 | Prisma adapter, multi-driver |
| `@rudderjs/orm-drizzle` | 0.0.1 | Drizzle adapter — multi-driver (sqlite, postgresql, libsql) |
| `@rudderjs/cli` | 0.0.6 | make:* (model, provider, middleware, controller, request, job, command, event, listener, mail, agent, mcp-server, mcp-tool, mcp-resource, mcp-prompt), module:*, module:publish |
| `@rudderjs/hash` | 0.0.1 | Password hashing — Hash facade, BcryptDriver, Argon2Driver, hash() factory |
| `@rudderjs/crypt` | 0.0.1 | Symmetric encryption — Crypt facade, AES-256-CBC, parseKey(), crypt() factory |
| `@rudderjs/auth` | 0.2.0 | Native auth: Guards (SessionGuard), Providers (EloquentUserProvider), Auth facade, Gate/Policy, PasswordBroker, AuthMiddleware(), RequireAuth(), `MustVerifyEmail` interface, `EnsureEmailIsVerified()` middleware, `verificationUrl()`, `handleEmailVerification()`. Depends on hash + session |
| `@rudderjs/sanctum` | 0.0.1 | API tokens — Sanctum class, TokenGuard, SanctumMiddleware(), RequireToken(), SHA-256 hashed tokens with abilities |
| `@rudderjs/socialite` | 0.0.1 | OAuth — Socialite facade, SocialUser, 4 built-in providers (GitHub, Google, Facebook, Apple), extensible |
| `@rudderjs/storage` | 0.0.2 | Storage facade, LocalAdapter + S3Adapter built-in (needs `@aws-sdk/client-s3`) |
| `@rudderjs/schedule` | 0.0.6 | Task scheduler, schedule:run/work/list, sub-minute (`everyFiveSeconds`..`everyThirtySeconds`), hooks (`before`/`after`/`onSuccess`/`onFailure`), `withoutOverlapping(expiresAt)`, `evenInMaintenanceMode()`, `onOneServer()` (cache-backed distributed lock) |
| `@rudderjs/cache` | 0.0.2 | Cache facade, MemoryAdapter + RedisAdapter built-in (needs `ioredis`), `Cache.fake()` (FakeCacheAdapter: assertSet/assertGet/assertForgotten/assertFlushed) |
| `@rudderjs/mail` | 0.0.5 | Mailable, Mail facade, LogAdapter + SMTP (Nodemailer), `FailoverAdapter` (ordered mailer fallback), `MarkdownMailable` (markdown->responsive HTML, components: button/panel/table/header/footer), `Mail.to().queue()`/`.later(delay)` (queued via `@rudderjs/queue`), `mailPreview()` route handler, mail() factory, `Mail.fake()` (FakeMailAdapter: assertSent/assertNotSent/assertQueued/assertNothingSent) |
| `@rudderjs/notification` | 0.0.5 | Notifiable, Notification, ChannelRegistry, notify(), `ShouldQueue` (queued notifications via `@rudderjs/queue`), `BroadcastChannel` (WebSocket via `@rudderjs/broadcast`), `AnonymousNotifiable`/`Notification.route()` (on-demand notifications), `Notification.fake()` (NotificationFake: assertSentTo/assertNotSentTo/assertCount) |
| `@rudderjs/broadcast` | 0.0.1 | WebSocket channels — broadcasting(), broadcast(), broadcasting.auth(), BKSocket client |
| `@rudderjs/live` | 0.0.1 | Yjs CRDT real-time sync — live(), MemoryPersistence, livePrisma(), liveRedis() |
| `@rudderjs/panels` | 0.0.3 | Admin panel builder — see docs/claude/panels.md for full details |
| `@rudderjs/panels-lexical` | 0.0.1 | Lexical rich-text editor adapter — see docs/claude/panels.md |
| `@rudderjs/image` | 0.0.1 | Fluent image processing — resize, crop, convert, optimize. Wraps sharp. |
| `@rudderjs/media` | 0.0.1 | Media library — `Media.make()` schema element, file browser, uploads, folders, preview, image conversions |
| `@rudderjs/ai` | 0.0.1 | AI engine — 9 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), Agent class, tool system, streaming, middleware (wired into agent loop), structured output, conversation memory (`forUser()`/`continue()`), file/image attachments (`Document`/`Image`), queue integration (`agent.queue()`), image generation (`AI.image()`/`ImageGenerator`), TTS (`AI.audio()`/`AudioGenerator`), STT (`AI.transcribe()`/`Transcription`), provider tools (`WebSearch`/`WebFetch`/`CodeExecution`), Vercel AI Data Stream Protocol (`toVercelDataStream`/`toVercelResponse`), cached embeddings (`CachedEmbeddingAdapter`), batch embedding auto-chunking, Google+Mistral embeddings, AI facade, AiFake |
| `@rudderjs/workspaces` | 0.0.1 | AI workspace canvas — Isoflow-style 3D nodes, departments, connections. Panel plugin: `workspaces()` |
| `@rudderjs/boost` | 0.0.1 | AI dev tools — MCP server (10 tools: app_info, db_schema, route_list, model_list, config_get, last_error, db_query, read_logs, browser_logs, get_absolute_url), `boost:install`/`boost:update` commands, auto-generated AI guidelines and skills from installed packages |
| `@rudderjs/mcp` | 0.0.1 | MCP server framework — `McpServer`, `McpTool`, `McpResource`, `McpPrompt` base classes, `@Name`/`@Version`/`@Instructions`/`@Description` decorators, `Mcp.web()`/`Mcp.local()` registration, stdio transport, `McpTestClient` for testing, `mcp:start`/`mcp:list` CLI commands, `make:mcp-server`/`make:mcp-tool`/`make:mcp-resource`/`make:mcp-prompt` scaffolders |
| `@rudderjs/log` | 0.0.1 | Structured logging — channels (console, single, daily, stack, null), RFC 5424 levels, LineFormatter/JsonFormatter, per-channel + shared context, listeners, `LogFake` for testing, `extendLog()` for custom drivers |
| `@rudderjs/http` | 0.0.1 | Fluent HTTP client — `Http` facade, retries, timeouts, pools (`Pool.concurrency()`), request/response interceptors, `Http.fake()` with URL pattern matching + assertions |
| `@rudderjs/localization` | 0.0.1 | i18n — `trans()`, `setLocale()`, `getLocale()`, locale middleware, JSON translation files |
| `@rudderjs/testing` | 0.0.1 | TestCase base class, TestResponse assertions (assertOk/assertJson/assertJsonPath/assertJsonCount/assertHeader/assertRedirect), RefreshDatabase trait, WithFaker trait, database assertions (assertDatabaseHas/Missing/Count/Empty), HTTP request helpers (get/post/put/patch/delete), actingAs(user) |
| `@rudderjs/context` | 0.0.1 | Request-scoped context — `Context` facade (add/get/all/forget/has), hidden context, stacks (push/stack), `scope()` (child isolation), `remember()` (memoize), `dehydrate()`/`hydrate()` (queue propagation), `ContextMiddleware()`, auto-merges into `@rudderjs/log` entries |
| `@rudderjs/pennant` | 0.0.1 | Feature flags — `Feature.define()`/`active()`/`value()`, scoping (`Feature.for(scope)`), `Feature.values()` bulk, `Lottery.odds()` gradual rollout, `activate()`/`deactivate()`/`purge()`, MemoryDriver, `FeatureMiddleware()`, `Feature.fake()` |
| `@rudderjs/process` | 0.0.1 | Shell execution — `Process.run()`/`start()`/`pool()`/`pipe()`, `PendingProcess` builder (path/timeout/env/input/quietly/tty/onOutput), `ProcessResult` (successful/failed/throw), `RunningProcess`, `Process.fake()` with assertions |
| `@rudderjs/concurrency` | 0.0.1 | Parallel execution — `Concurrency.run(tasks)` via worker threads, `Concurrency.defer(fn)` fire-and-forget, sync driver for testing via `Concurrency.fake()` |
| `@rudderjs/telescope` | 0.0.1 | Dev inspector — 11 collectors (request, query, job, exception, log, mail, notification, event, cache, schedule, model), JSON API, `Telescope` facade, `TelescopeRegistry`, memory + SQLite storage, `telescope()` factory |
| `@rudderjs/pulse` | 0.0.1 | App metrics — 7 aggregators (request, queue, cache, exception, user, query, server), time-series 1-min buckets, individual entries (slow requests/queries, exceptions, failed jobs), JSON API, `Pulse` facade, `PulseRegistry`, memory + SQLite storage, `pulse()` factory |

**Merged/removed packages** (code absorbed, originals deleted):
- `@rudderjs/di` -> merged into `@rudderjs/core`
- `@rudderjs/rate-limit` -> merged into `@rudderjs/middleware`
- `@rudderjs/storage-s3` -> merged into `@rudderjs/storage`
- `@rudderjs/cache-redis` -> merged into `@rudderjs/cache`
- `@rudderjs/mail-nodemailer` -> merged into `@rudderjs/mail`
- `@rudderjs/events` -> merged into `@rudderjs/core`
- `@rudderjs/dashboards` -> merged into `@rudderjs/panels`
