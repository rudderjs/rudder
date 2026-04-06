# RudderJS Feature Roadmap

> Laravel 13 gap analysis — compiled 2026-04-06
>
> Legend: S = Small (1-2 days) | M = Medium (3-5 days) | L = Large (1-2 weeks)

---

## Plan 1: Core DX Foundation ✅

*Things every app needs — blocks real-world usage without them.*

**Status**: Complete

| # | Package | Feature | Status |
|---|---|---|---|
| 1.1 | `@rudderjs/log` | Logging — channels (console, single, daily, stack, null), log levels, formatters, context propagation | ✅ |
| 1.2 | `@rudderjs/http` | HTTP Client — fluent fetch, retries, timeouts, pools, interceptors, `Http.fake()` | ✅ |
| 1.3 | `@rudderjs/support` | Collection expansion — 15+ new methods (`chunk`, `partition`, `crossJoin`, `keyBy`, `sliding`, etc.) | ✅ |
| 1.4 | `@rudderjs/support` | `Str` class — 35+ string helpers | ✅ |
| 1.5 | `@rudderjs/support` | `Num` class — 9 numeric helpers | ✅ |
| 1.6 | `@rudderjs/contracts` | Typed request input — `req.string()`, `req.integer()`, `req.boolean()`, `req.date()`, etc. | ✅ |
| 1.7 | `@rudderjs/core` | Error handling — `HttpException`, `abort()`, `abort_if()`, `abort_unless()`, `report()`, `report_if()` | ✅ |
| 1.8 | `@rudderjs/router` | URL generation — `route()`, `Url.signedRoute()`, `Url.temporarySignedRoute()`, `ValidateSignature()` | ✅ |

---

## Plan 2: ORM & Data Layer ✅

*Makes the ORM competitive with Eloquent.*

**Status**: Complete

| # | Package | Feature | Status |
|---|---|---|---|
| 2.1 | `@rudderjs/orm` | Attribute casts — 12 built-in types + custom `CastUsing` classes, `@Cast` decorator | ✅ |
| 2.2 | `@rudderjs/orm` | Accessors & Mutators — `Attribute.make({ get, set })`, computed properties | ✅ |
| 2.3 | `@rudderjs/orm` | API Resources — `JsonResource`, `ResourceCollection`, `when`/`whenLoaded`/`whenNotNull`/`mergeWhen` | ✅ |
| 2.4 | `@rudderjs/orm` | ModelCollection — `modelKeys`, `find`, `contains`, `except`, `only`, `diff`, `unique`, `fresh`, `load` | ✅ |
| 2.5 | `@rudderjs/orm` | Model Factories — `ModelFactory`, named states, `sequence()`, `make()`/`create()` with count | ✅ |
| 2.6 | `@rudderjs/orm` | Serialization — `@Hidden`/`@Visible`/`@Appends` decorators, instance `makeVisible`/`makeHidden`/`setVisible`/`setHidden` | ✅ |

---

## Plan 3: Queue & Scheduling Power-ups ✅

*Makes background processing production-ready.*

**Status**: Complete

| # | Package | Feature | Status |
|---|---|---|---|
| 3.1 | `@rudderjs/queue` | Job chaining — `Chain.of()`, sequential execution, `onFailure()`, `getChainState()` | ✅ |
| 3.2 | `@rudderjs/queue` | Job batching — `Bus.batch()`, `then`/`catch`/`finally`, `Batch` progress/cancel tracking | ✅ |
| 3.3 | `@rudderjs/queue` | Unique jobs — `ShouldBeUnique`, `ShouldBeUniqueUntilProcessing`, cache-backed locks | ✅ |
| 3.4 | `@rudderjs/queue` | Job middleware — `RateLimited`, `WithoutOverlapping`, `ThrottlesExceptions`, `Skip` | ✅ |
| 3.5 | `@rudderjs/queue` | Queued closures — `dispatch(async () => { ... })` | ✅ |
| 3.6 | `@rudderjs/schedule` | Sub-minute scheduling — `everyFiveSeconds()` through `everyThirtySeconds()` | ✅ |
| 3.7 | `@rudderjs/schedule` | Schedule hooks — `before()`, `after()`, `onSuccess()`, `onFailure()`, `withoutOverlapping()`, `evenInMaintenanceMode()` | ✅ |
| 3.8 | `@rudderjs/schedule` | Single-server execution — `onOneServer()` with cache-backed distributed locking | ✅ |

---

## Plan 4: Auth & Mail Completeness ✅

*Rounds out auth flows and mail capabilities.*

**Status**: Complete

| # | Package | Feature | Status |
|---|---|---|---|
| 4.1 | `@rudderjs/auth` | Email verification — `MustVerifyEmail`, `EnsureEmailIsVerified()`, `verificationUrl()`, `handleEmailVerification()` | ✅ |
| 4.2 | `@rudderjs/mail` | Queued mail — `Mail.to().queue()`, `.later(delay)`, `.onQueue(name)` | ✅ |
| 4.3 | `@rudderjs/mail` | Markdown mail — `MarkdownMailable`, 5 components (button, panel, table, header, footer) | ✅ |
| 4.4 | `@rudderjs/mail` | Failover transport — `FailoverAdapter`, ordered mailer fallback, configurable `retryAfter` | ✅ |
| 4.5 | `@rudderjs/mail` | Mail preview — `mailPreview()` route handler with iframe render | ✅ |
| 4.6 | `@rudderjs/notification` | Queued notifications — `ShouldQueue` interface, auto-queue dispatch | ✅ |
| 4.7 | `@rudderjs/notification` | Broadcast channel — `BroadcastChannel` via `@rudderjs/broadcast` WebSocket | ✅ |
| 4.8 | `@rudderjs/notification` | On-demand notifications — `AnonymousNotifiable`, `Notification.route()` | ✅ |

---

## Plan 5: Advanced Framework Features

*Differentiators and power-user features.*

**Priority**: Medium — valuable but apps can ship without them.

| # | Package | Feature | Effort | Depends On |
|---|---|---|---|---|
| 5.1 | `@rudderjs/context` (new) | Context — request-scoped data bag via AsyncLocalStorage, auto-propagates to log entries + queued jobs, hidden context, stacks, scoped context, `when()`/`remember()` | M | log |
| 5.2 | `@rudderjs/pennant` (new) | Feature Flags — `Feature.define()`, `Feature.active()`, scoping (user/team/any), rich values (not just boolean), database + memory drivers, `Lottery` for gradual rollout, `@feature` middleware | M | cache, orm |
| 5.3 | `@rudderjs/core` | Scoped container bindings — per-request lifecycle scope, auto-cleanup at request end, `Container.scoped()` | S | — |
| 5.4 | `@rudderjs/core` | Deferred providers — lazy-load providers until their bindings are first resolved, `provides()` method | S | — |
| 5.5 | `@rudderjs/core` | Contextual binding — `container.when(ClassA).needs(InterfaceB).give(ImplC)`, closure-based, per-class resolution | S | — |
| 5.6 | `@rudderjs/process` (new) | Process facade — `Process.run('cmd')`, async `Process.start()`, pools, pipes, timeouts, environment vars, real-time output, testing fakes | M | — |
| 5.7 | `@rudderjs/concurrency` (new) | Concurrency — `Concurrency.run([fn1, fn2])` via worker threads, `Concurrency.defer()` for post-response fire-and-forget, sync driver for testing | M | — |

### Deliverables
- [ ] `@rudderjs/context` package with ALS-backed request context
- [ ] `@rudderjs/pennant` package with feature flag system
- [ ] Scoped + deferred + contextual container bindings
- [ ] `@rudderjs/process` package for shell execution
- [ ] `@rudderjs/concurrency` package for parallel work

---

## Plan 6: Testing Infrastructure ✅

*Makes the framework properly testable.*

**Status**: Complete

| # | Package | Feature | Effort | Depends On | Status |
|---|---|---|---|---|---|
| 6.1 | `@rudderjs/testing` (new) | Testing base — `TestCase` class with app bootstrapping, `RefreshDatabase` trait (truncate/migrate), `WithFaker` (data generation), request helpers (`get`, `post`, `put`, `delete`), response assertions (`assertOk`, `assertRedirect`, `assertJson`) | M | core | ✅ |
| 6.2 | `@rudderjs/queue` | `Queue.fake()` — in-memory fake driver, `assertPushed()`, `assertNotPushed()`, `assertPushedOn()`, `assertCount()`, chain/batch assertions | S | — | ✅ |
| 6.3 | `@rudderjs/mail` | `Mail.fake()` — `assertSent()`, `assertQueued()`, `assertNotSent()`, `assertSentCount()`, content assertions | S | — | ✅ |
| 6.4 | `@rudderjs/notification` | `Notification.fake()` — `assertSentTo()`, `assertNotSentTo()`, `assertCount()`, channel assertions | S | — | ✅ |
| 6.5 | `@rudderjs/http` | `Http.fake()` — ~~URL pattern matching, response sequences, assertions~~ **Already implemented in Plan 1** | — | ✅ | ✅ |
| 6.6 | `@rudderjs/core` | `Event.fake()` — `assertDispatched()`, `assertNotDispatched()`, `assertDispatchedTimes()` | S | — | ✅ |
| 6.7 | `@rudderjs/cache` | `Cache.fake()` — in-memory test driver with assertions | S | — | ✅ |

### Deliverables
- [x] `@rudderjs/testing` package with TestCase + request helpers + response assertions
- [x] `RefreshDatabase` trait for test isolation
- [x] `Http.fake()` — done (Plan 1.2)
- [x] Fake drivers for: Queue, Mail, Notification, Event, Cache
- [x] Full assertion APIs on all fakes

---

## Plan 7: Monitoring & Observability

*Production visibility — equivalent to Pulse, Telescope, Horizon, Nightwatch.*

**Priority**: Lower — build after core is stable. These are Pilotiq panel plugins.

### 7.1 — Pulse Plugin (`@pilotiq/pulse`)

**Laravel equivalent**: [Laravel Pulse](https://laravel.com/docs/13.x/pulse) — self-hosted performance monitoring dashboard.

**Effort**: Large

**Built-in Cards (9):**
- **Servers** — CPU, memory, storage usage per server (requires background check daemon)
- **Application Usage** — top 10 users by requests, slow requests, or job dispatching
- **Exceptions** — frequency + recency of exceptions, grouped by class + location
- **Queues** — throughput: queued, processing, processed, released, failed
- **Slow Requests** — HTTP requests exceeding configurable threshold (default 1s)
- **Slow Jobs** — queued jobs exceeding configurable threshold (default 1s)
- **Slow Queries** — database queries exceeding threshold, with SQL highlighting
- **Slow Outgoing Requests** — HTTP client requests exceeding threshold
- **Cache** — hit/miss statistics globally and per-key

**Recorders (10):**
- CacheInteractions, Exceptions, Queues, SlowJobs, SlowOutgoingRequests, SlowQueries, SlowRequests, Servers, UserJobs, UserRequests
- Each recorder has: configurable threshold, sample rate, ignore patterns, regex grouping

**Infrastructure:**
- Separate database support (don't pollute app DB)
- Redis ingest driver for non-blocking writes + batched DB inserts
- Configurable sampling per recorder to reduce volume
- Automatic trimming of old data
- Background daemons: `pulse:check` (server metrics), `pulse:work` (Redis stream processing)

**Dashboard:**
- Composable card grid layout (cols, rows, expand)
- Custom card API (create your own cards)
- Auto user resolution (name, email, avatar)
- Gate-based authorization
- Served at `/pulse` route within panel

**Depends on**: panels, log, cache, orm

---

### 7.2 — Telescope Plugin (`@pilotiq/telescope`)

**Laravel equivalent**: [Laravel Telescope](https://laravel.com/docs/13.x/telescope) — development debug assistant.

**Effort**: Large

**Watchers (18 types):**
1. **Request Watcher** — HTTP request/response details, headers, payload, status
2. **Query Watcher** — database queries with execution time, slow query threshold (default 100ms)
3. **Exception Watcher** — reportable exceptions with full stack traces
4. **Job Watcher** — job dispatching, status, queue data
5. **Mail Watcher** — in-browser email preview, download as `.eml`
6. **Notification Watcher** — notification sending, channels, recipients
7. **Cache Watcher** — cache hits, misses, updates, deletions
8. **Log Watcher** — application logs, configurable minimum level
9. **Event Watcher** — event payloads, listeners, broadcast data
10. **Command Watcher** — CLI command execution, arguments, exit code
11. **Schedule Watcher** — scheduled task execution and performance
12. **HTTP Client Watcher** — outgoing HTTP requests to external APIs
13. **Model Watcher** — Eloquent model events (created, updated, deleted)
14. **Gate Watcher** — authorization gate and policy check results
15. **View Watcher** — view/page rendering data
16. **Batch Watcher** — queued batch info
17. **Redis Watcher** — Redis commands and responses
18. **Dump Watcher** — `dump()` output capture (dev only)

**Features:**
- Entry-level and batch-level filtering (include/exclude)
- Auto-tagging entries with model class names + authenticated user IDs
- Custom tagging via closures
- Sensitive data masking (passwords, tokens, credit cards)
- Data pruning (configurable retention, default 24h)
- Per-watcher enable/disable via config or env vars

**Dashboard:**
- Web dashboard within panel
- Real-time monitoring of all watched events
- Search and filtering by entry type + tags
- Detailed inspection of each entry
- Mail preview with download
- Exception stack traces with full context

**Depends on**: panels, log, orm

---

### 7.3 — Horizon Plugin (`@pilotiq/horizon`)

**Laravel equivalent**: [Laravel Horizon](https://laravel.com/docs/13.x/horizon) — Redis queue monitoring + management.

**Effort**: Medium

**Worker Management:**
- 3 balancing strategies: `auto` (dynamic scaling), `simple` (even distribution), `false` (disabled)
- Auto-balancing: `time`-based (estimated clear time) or `size`-based (job count)
- Configurable: `minProcesses`, `maxProcesses`, `balanceMaxShift`, `balanceCooldown`
- Multiple supervisors per environment with separate configs
- Environment-based configuration (production, staging, local)

**Job Management:**
- Per-job class config overrides (tries, timeout, backoff)
- Job silencing (reduce dashboard noise by class, tag, or interface)
- Job tagging for organization and filtering
- Failed job inspection with stack traces
- Retry/delete failed jobs from dashboard
- Clear queues

**Metrics:**
- Job throughput (jobs per unit time)
- Job runtime (execution duration)
- Job failure rates
- Queue length/depth
- Worker process status
- In-progress / completed / failed job lists

**Notifications:**
- Job failure alerts via notification system
- Customizable channels

**Dashboard:**
- Real-time queue monitoring
- Completed, failed, in-progress job views
- Job history and analytics
- Tag-based filtering
- Metrics visualization (charts)

**Depends on**: panels, queue-bullmq

---

### 7.4 — Nightwatch (External Monitoring)

**Laravel equivalent**: [Laravel Nightwatch](https://nightwatch.laravel.com/) — hosted monitoring SaaS.

**Effort**: Large — this is a standalone product, not just a plugin.

**Two options:**
1. **Panel plugin** (`@pilotiq/nightwatch`) — self-hosted monitoring within Pilotiq
2. **SaaS product** — hosted service at `nightwatch.pilotiq.dev` (long-term)

**Monitored Event Types (9):**
- Requests — trace with detailed interaction + performance metrics
- Outgoing Requests — external API call monitoring
- Jobs — queue execution, attempts, duration
- Queries — SQL performance, problematic query detection
- Mail — sending, recipients, rendering performance
- Commands — CLI execution, resource impact
- Cache — hit rates, storage patterns, invalidation
- Scheduled Tasks — execution timing, completion status
- Notifications — delivery across all channels

**Connected Events / Tracing:**
- Microsecond-precision event correlation
- Request waterfall view (REQUEST → QUERY → QUERY → CACHE HIT → QUERY)
- Timeline visualization of event sequences

**Smart Alerts:**
- Intelligent grouping of related exceptions
- Noise-reduced notifications
- Issue assignment to team members

**Uptime Monitoring:**
- HTTP/TCP/DNS endpoint checks
- SSL certificate expiry tracking
- Response time tracking
- Status pages
- Incident management

**Depends on**: panels, http, notification, log

---

### Plan 7 Deliverables
- [ ] `@pilotiq/pulse` — performance dashboard panel plugin (9 cards, 10 recorders, Redis ingest)
- [ ] `@pilotiq/telescope` — debug inspector panel plugin (18 watchers, tagging, filtering, mail preview)
- [ ] `@pilotiq/horizon` — queue monitoring panel plugin (auto-balancing, metrics, job management)
- [ ] `@pilotiq/nightwatch` — external monitoring (panel plugin first, SaaS later)

---

## Execution Order

```
Phase 1 ──── Plan 1 (Core DX Foundation)                          ✅ DONE
              ├── log, http, Str, Num, Collection, typed input, errors, URLs
              │
Phase 2 ──── Plan 2 (ORM) + Plan 3 (Queue/Schedule)  ← parallel  ✅ DONE
              ├── casts, resources, factories, chains, batches, unique jobs
              │
Phase 3 ──── Plan 4 (Auth/Mail)                                   ✅ DONE
              ├── email verification, queued mail, markdown, failover
              │
Phase 4 ──── Plan 5 (Advanced) + Plan 6 (Testing)  ← parallel    ✅/⬜ (Plan 6 DONE)
              ├── context, pennant, process, concurrency, fakes
              │
Phase 5 ──── Plan 7 (Monitoring & Observability)                  ⬜ LATER
              ├── pulse, telescope, horizon, nightwatch
```

---

## New Packages Summary

| Package | Plan | Type | Status |
|---|---|---|---|
| `@rudderjs/log` | 1 | Core framework | ✅ |
| `@rudderjs/http` | 1 | Core framework | ✅ |
| `@rudderjs/context` | 5 | Core framework | ⬜ |
| `@rudderjs/pennant` | 5 | Core framework | ⬜ |
| `@rudderjs/process` | 5 | Core framework | ⬜ |
| `@rudderjs/concurrency` | 5 | Core framework | ⬜ |
| `@rudderjs/testing` | 6 | Core framework | ✅ |
| `@pilotiq/pulse` | 7 | Panel plugin | ⬜ |
| `@pilotiq/telescope` | 7 | Panel plugin | ⬜ |
| `@pilotiq/horizon` | 7 | Panel plugin | ⬜ |
| `@pilotiq/nightwatch` | 7 | Panel plugin / SaaS | ⬜ |

## Existing Package Enhancements

| Package | Plans | Changes | Status |
|---|---|---|---|
| `@rudderjs/support` | 1 | +Str, +Num, +15 Collection methods | ✅ |
| `@rudderjs/contracts` | 1 | +typed request input | ✅ |
| `@rudderjs/core` | 1, 5, 6 | +ExceptionHandler ✅ / +scoped/deferred/contextual bindings ⬜ / +Event.fake() ✅ | partial |
| `@rudderjs/router` | 1 | +URL generation, +signed URLs | ✅ |
| `@rudderjs/orm` | 2 | +casts, +accessors, +resources, +factories, +serialization | ✅ |
| `@rudderjs/queue` | 3, 6 | +chains, +batches, +unique, +middleware, +closures ✅ / +fake ✅ | ✅ |
| `@rudderjs/schedule` | 3 | +sub-minute, +hooks, +onOneServer | ✅ |
| `@rudderjs/auth` | 4 | +email verification | ✅ |
| `@rudderjs/mail` | 4, 6 | +queued, +markdown, +failover, +preview ✅ / +fake ✅ | ✅ |
| `@rudderjs/notification` | 4, 6 | +queued, +broadcast channel, +on-demand ✅ / +fake ✅ | ✅ |
| `@rudderjs/cache` | 6 | +fake | ✅ |
