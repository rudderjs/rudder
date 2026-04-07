# Plan 7: Monitoring — Telescope, Pulse, Horizon, Nightwatch

## Context

Plans 1–6 and Plan 8 are complete. This is the last major roadmap plan. Each monitoring tool follows a three-layer architecture: **collectors** (data capture), **API** (JSON endpoints), **UI** (standalone Vike pages). A future panels plugin can consume the same API.

---

## Architecture (All Packages)

```
@rudderjs/{tool}
├── src/
│   ├── collectors/      # Framework hooks that record data
│   ├── storage/         # Prisma schema + data access layer
│   ├── api/             # JSON API routes (/telescope/api/*, etc.)
│   ├── pages/           # Vike pages (standalone UI)
│   ├── provider.ts      # Service provider factory
│   └── index.ts         # Exports
├── prisma/
│   └── schema.prisma    # Monitoring-specific tables
├── boost/
│   └── guidelines.md    # AI coding guidelines
└── package.json
```

**Three layers:**

1. **Collectors** — Middleware, event listeners, and hooks that passively record app activity. Zero impact when disabled.
2. **API** — RESTful JSON endpoints. Auth-protected. Can be consumed by standalone UI, panels plugin, or custom dashboards.
3. **UI** — Self-contained Vike pages with minimal dependencies. Server-rendered HTML + vanilla JS or lightweight framework.

**Shared patterns:**
- Each tool registers routes via its service provider (e.g., `telescope()`)
- Storage uses its own Prisma schema (separate from app schema)
- Auth middleware protects both API and UI (configurable: closure, gate, or IP whitelist)
- Data retention is configurable (auto-prune old entries)
- Enable/disable per-environment (`telescope.enabled` config)

---

## Phase 1: Telescope (Development Inspector) — High Priority

### What It Records

| Entry Type | Collector | How |
|---|---|---|
| Requests | HTTP middleware | Method, URL, status, duration, headers, payload, response |
| Queries | ORM hook | SQL, bindings, duration, connection, caller |
| Jobs | Queue event listener | Class, queue, status, duration, payload, exception |
| Exceptions | Exception handler hook | Class, message, stack, request context |
| Logs | Log channel listener | Level, message, context |
| Mail | Mail event listener | To, subject, mailable class, queued? |
| Notifications | Notification event listener | Notifiable, channel, notification class |
| Events | Event dispatcher listener | Event class, listeners, payload |
| Cache | Cache event listener | Key, operation (hit/miss/set/forget), value size |
| Scheduled Tasks | Schedule hook | Command, expression, duration, output |
| Model Changes | ORM observer | Model, action (created/updated/deleted), old/new values |

### API Endpoints

```
GET    /telescope/api/requests          # List recorded requests
GET    /telescope/api/requests/:id      # Single request detail
GET    /telescope/api/queries           # List recorded queries
GET    /telescope/api/queries/:id       # Single query detail
GET    /telescope/api/jobs              # List recorded jobs
GET    /telescope/api/exceptions        # List recorded exceptions
GET    /telescope/api/logs              # List recorded log entries
GET    /telescope/api/mail              # List recorded mail
GET    /telescope/api/notifications     # List recorded notifications
GET    /telescope/api/events            # List recorded events
GET    /telescope/api/cache             # List recorded cache operations
GET    /telescope/api/schedule          # List recorded scheduled tasks
GET    /telescope/api/models            # List recorded model changes
DELETE /telescope/api/entries           # Prune all entries
```

All endpoints support: `?page=1&per_page=50&type=request&tag=user:1&search=keyword`

### UI Pages

```
/telescope                    # Dashboard overview
/telescope/requests           # Request list + detail panel
/telescope/queries            # Query list (sortable by duration)
/telescope/jobs               # Job list with status badges
/telescope/exceptions         # Exception list with stack traces
/telescope/logs               # Log viewer
/telescope/mail               # Mail previews
/telescope/notifications      # Notification list
/telescope/events             # Event list
/telescope/cache              # Cache operation list
/telescope/schedule           # Scheduled task list
/telescope/models             # Model change audit log
```

### Storage Schema

```prisma
model TelescopeEntry {
  id          String   @id @default(uuid())
  batchId     String?  // Group related entries (same request)
  type        String   // request, query, job, exception, log, mail, ...
  content     Json     // Type-specific payload
  tags        String[] // Searchable tags (e.g., "user:1", "slow")
  familyHash  String?  // Group similar entries
  createdAt   DateTime @default(now())

  @@index([type, createdAt])
  @@index([batchId])
}
```

### Config

```ts
// config/telescope.ts
export default {
  enabled: env('TELESCOPE_ENABLED', true),
  path: 'telescope',           // URL prefix
  storage: 'sqlite',           // or 'prisma' (app DB)
  pruneAfterHours: 24,
  recordRequests: true,
  recordQueries: true,
  recordJobs: true,
  recordExceptions: true,
  recordLogs: true,
  recordMail: true,
  recordNotifications: true,
  recordEvents: true,
  recordCache: true,
  recordSchedule: true,
  recordModels: true,
  ignoreRequests: ['/telescope*', '/health'],
  slowQueryThreshold: 100,     // ms — tag as "slow"
  auth: null,                  // closure, gate name, or null (open)
}
```

### Effort: Medium-Large

---

## Phase 2: Pulse (Application Metrics) — High Priority

### What It Tracks

| Metric | How | Resolution |
|---|---|---|
| Request throughput | Middleware counter | Per-minute buckets |
| Request duration (p50, p95, p99) | Middleware timing | Per-minute buckets |
| Slow requests | Middleware (> threshold) | Individual entries |
| Queue throughput | Queue event listener | Per-minute buckets |
| Queue wait time | Job start - dispatch time | Per-minute buckets |
| Failed jobs | Queue event listener | Individual entries |
| Cache hit rate | Cache event listener | Per-minute buckets |
| Active users | Middleware + session | Per-minute snapshots |
| Slow queries | ORM hook (> threshold) | Individual entries |
| Exceptions | Exception handler | Per-minute count |
| Server stats | Periodic collector | CPU, memory, disk |

### API Endpoints

```
GET /pulse/api/overview             # Dashboard summary (all metrics)
GET /pulse/api/requests             # Request metrics (throughput, duration)
GET /pulse/api/slow-requests        # Slow request list
GET /pulse/api/queues               # Queue metrics
GET /pulse/api/slow-queries         # Slow query list
GET /pulse/api/exceptions           # Exception count over time
GET /pulse/api/cache                # Cache hit/miss ratios
GET /pulse/api/users                # Active users
GET /pulse/api/servers              # Server resource usage
```

All endpoints support: `?period=1h|6h|24h|7d`

### UI Pages

```
/pulse                        # Single-page dashboard with all metric cards
```

Pulse is a **single page** with a grid of cards. Each card shows a metric with a sparkline chart and trend. Auto-refreshes every 10 seconds.

### Storage

Aggregated metrics in time-series buckets (not individual entries like Telescope):

```prisma
model PulseAggregate {
  id        String   @id @default(uuid())
  bucket    DateTime // Start of time bucket (1-minute resolution)
  type      String   // requests, queue_throughput, cache_hits, ...
  key       String?  // Optional grouping key (route, queue name, ...)
  count     Int      @default(0)
  sum       Float    @default(0)    // e.g., total duration
  min       Float?
  max       Float?
  createdAt DateTime @default(now())

  @@unique([bucket, type, key])
  @@index([type, bucket])
}

model PulseEntry {
  id        String   @id @default(uuid())
  type      String   // slow_request, slow_query, exception, failed_job
  content   Json
  createdAt DateTime @default(now())

  @@index([type, createdAt])
}
```

### Effort: Medium

---

## Phase 3: Horizon (Queue Monitor) — Medium Priority

### What It Does

Deep queue monitoring — goes beyond Telescope's basic job recording.

| Feature | Description |
|---|---|
| Job throughput | Jobs processed per minute, per queue |
| Job wait time | Time from dispatch to processing start |
| Job runtime | Processing duration distribution |
| Failed jobs | List, inspect, retry, delete |
| Recent jobs | Searchable list with status, tags |
| Worker status | Active workers, memory usage, uptime |
| Queue balancing | Auto-scaling recommendations |

### API Endpoints

```
GET    /horizon/api/stats              # Overview stats
GET    /horizon/api/jobs/recent        # Recent jobs list
GET    /horizon/api/jobs/failed        # Failed jobs list
GET    /horizon/api/jobs/:id           # Job detail
POST   /horizon/api/jobs/:id/retry     # Retry a failed job
DELETE /horizon/api/jobs/:id           # Delete a failed job
GET    /horizon/api/queues             # Queue-level metrics
GET    /horizon/api/workers            # Worker status
```

### UI Pages

```
/horizon                      # Dashboard with charts
/horizon/jobs/recent          # Recent jobs list
/horizon/jobs/failed          # Failed jobs list with retry/delete
/horizon/queues               # Per-queue metrics
/horizon/workers              # Worker status
```

### Effort: Medium

---

## Phase 4: Nightwatch (Uptime Monitor) — Lower Priority

### What It Does

External endpoint monitoring with alerting.

| Feature | Description |
|---|---|
| HTTP checks | Periodic requests to configured endpoints |
| Response time | Track p50, p95, p99 over time |
| SSL expiry | Check certificate expiration dates |
| Status history | Uptime percentage per endpoint |
| Alerting | Email/notification on failure |
| Multi-region | Check from different origins (future) |

### Effort: Medium — Defer until Phases 1-3 are done

---

## Execution Order

```
Phase 1 (Telescope)  — collectors, storage, API, UI
Phase 2 (Pulse)      — aggregators, storage, API, UI     ← parallel with Phase 1
Phase 3 (Horizon)    — queue collectors, API, UI
Phase 4 (Nightwatch) — check runner, alerting, API, UI   ← defer
```

---

## Summary Table

| # | Feature | Package | Effort | Priority |
|---|---------|---------|--------|----------|
| 1 | Telescope (dev inspector) | telescope (new) | M-L | High |
| 2 | Pulse (app metrics) | pulse (new) | M | High |
| 3 | Horizon (queue monitor) | horizon (new) | M | Medium |
| 4 | Nightwatch (uptime) | nightwatch (new) | M | Low |

---

## UI Technology Decision

Standalone Vike pages per package. Each package ships its own `/pages` directory. UI is self-contained — no dependency on `@rudderjs/panels`.

The API layer enables future panels integration via plugins (e.g., `panelsTelescope()`) that consume the same JSON endpoints.

---

## Publishable Assets

Each package uses `ServiceProvider.publishes()` to let users customize config and views:

```bash
rudder vendor:publish --tag=telescope-config    # → config/telescope.ts
rudder vendor:publish --tag=telescope-views     # → resources/views/telescope/
rudder vendor:publish --tag=pulse-config        # → config/pulse.ts
rudder vendor:publish --tag=pulse-views         # → resources/views/pulse/
rudder vendor:publish --tag=horizon-config      # → config/horizon.ts
rudder vendor:publish --tag=horizon-views       # → resources/views/horizon/
```

Published views override the package defaults. Users can modify layouts, styling, or add custom cards without forking.

---

## Open Questions

1. **UI framework for pages**: Vanilla HTML + Alpine.js? Or ship lightweight React/Vue components? Laravel uses Blade + Tailwind for Pulse, Vue for Horizon.
2. **Shared UI components**: Should monitoring packages share a UI kit (charts, tables, nav) or be fully independent?
3. **Storage strategy**: Separate SQLite DB per tool (zero config) vs. tables in app's Prisma schema (requires migration)?
