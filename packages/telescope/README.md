# @rudderjs/telescope

Debug assistant for RudderJS — records requests, queries, jobs, exceptions, logs, mail, notifications, events, cache operations, scheduled tasks, model changes, CLI commands, outgoing HTTP requests, authorization decisions, WebSocket lifecycle, Yjs CRDT events, and `dump()`/`dd()` calls.

## Installation

```bash
pnpm add @rudderjs/telescope
```

## Setup

Telescope is auto-discovered via `defaultProviders()`. Just install the package, run `pnpm rudder providers:discover`, and add a config file:

```ts
// config/telescope.ts
import { Env } from '@rudderjs/core'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled: Env.getBool('TELESCOPE_ENABLED', true),
  path: 'telescope',
  storage: 'memory',
} satisfies TelescopeConfig
```

## Dashboard

Telescope serves a built-in UI at `/{path}` (default `/telescope`) with:

- **Dashboard** — count cards for all entry types
- **Per-type list pages** — searchable, paginated tables with tag filtering and auto-refresh (2s polling)
- **Detail pages** — rich, type-specific views at `/telescope/{type}/{id}` (formatted SQL, mail HTML preview, stack traces, WebSocket timelines, etc.)
- **Batch grouping** — entries linked by `batchId` (e.g. all queries from one request, all events from one WebSocket connection) viewable at `/telescope/batches/{batchId}`
- **Sensitive data redaction** — headers and body fields are redacted at collection time, before they reach storage

The UI is vanilla HTML + Alpine.js + Tailwind CDN — no client framework dependency. Works regardless of whether your app uses React, Vue, Solid, or none.

## Telescope Facade

```ts
import { Telescope } from '@rudderjs/telescope'

// List entries by type
const requests   = await Telescope.list({ type: 'request', perPage: 25 })
const exceptions = await Telescope.list({ type: 'exception' })
const queries    = await Telescope.list({ type: 'query', search: 'SELECT' })

// Find a single entry
const entry = await Telescope.find('entry-id')

// Count entries
const total       = await Telescope.count()
const jobCount    = await Telescope.count('job')

// Prune entries
await Telescope.prune('log')   // prune by type
await Telescope.prune()        // prune all
```

| Method | Returns | Description |
|--------|---------|-------------|
| `list(options?)` | `TelescopeEntry[]` | List entries with type/tag/search/pagination filters |
| `find(id)` | `TelescopeEntry \| null` | Find a single entry by ID |
| `count(type?)` | `number` | Count entries, optionally filtered by type |
| `prune(type?)` | `void` | Delete entries, optionally by type |
| `record(entry)` | `void` | Manually record an entry |

## Entry Types

Telescope records 17 entry types via the observer-registry pattern — each peer package exports a process-wide observer singleton, and the corresponding collector subscribes at boot. If a peer package isn't installed, its collector silently skips.

### Core watchers

| Type | Collector | Source | Description |
|------|-----------|--------|-------------|
| `request` | RequestCollector | `@rudderjs/router` | Incoming HTTP requests and responses |
| `query` | QueryCollector | `@rudderjs/orm` | Database queries (flags slow queries above threshold) |
| `job` | JobCollector | `@rudderjs/queue` | Queue job dispatch and execution |
| `exception` | ExceptionCollector | `@rudderjs/core` | Unhandled exceptions |
| `log` | LogCollector | `@rudderjs/log` | Log messages across all channels |
| `mail` | MailCollector | `@rudderjs/mail` | Sent emails |
| `notification` | NotificationCollector | `@rudderjs/notification` | Dispatched notifications |
| `event` | EventCollector | `@rudderjs/core` | Dispatched events with listener list |
| `cache` | CacheCollector | `@rudderjs/cache` | Cache hits, misses, writes, forgets |
| `schedule` | ScheduleCollector | `@rudderjs/schedule` | Scheduled task execution with output |
| `model` | ModelCollector | `@rudderjs/orm` | Model create/update/delete with dirty attributes diff |
| `command` | CommandCollector | `@rudderjs/rudder` | CLI command invocations with args, duration, exit code |
| `http` | HttpCollector | `@rudderjs/http` | Outgoing HTTP requests with timing, headers, response body |
| `gate` | GateCollector | `@rudderjs/auth` | Authorization decisions — ability, allowed/denied, resolution path (ability/policy/before), timing |
| `dump` | DumpCollector | `@rudderjs/support` | `dump()` and `dd()` calls with arguments and caller location |

### Real-time watchers (differentiators — Laravel Telescope doesn't have these)

| Type | Collector | Source | Description |
|------|-----------|--------|-------------|
| `broadcast` | BroadcastCollector | `@rudderjs/broadcast` | Full WebSocket lifecycle — connections, subscriptions, presence, broadcasts, auth failures. Grouped by `connectionId`. |
| `live` | LiveCollector | `@rudderjs/live` | Yjs CRDT debugging — document open/close, updates applied, awareness changes (throttled), persistence events, sync errors |

## Storage Drivers

- **`memory`** (default) — In-process, bounded by `maxEntries`. Good for development.
- **`sqlite`** — Persistent storage via `better-sqlite3`. Run `pnpm add better-sqlite3` to enable.

## Configuration

Every collector can be toggled independently:

```ts
// config/telescope.ts
export default {
  enabled: true,
  path: 'telescope',
  storage: 'memory',
  sqlitePath: '.telescope.db',
  maxEntries: 1000,
  pruneAfterHours: 24,

  // Core watchers
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
  recordCommands: true,
  recordHttp: true,
  recordGate: true,
  recordDumps: true,

  // Real-time watchers
  recordBroadcasts: true,
  recordLive: true,
  liveAwarenessSampleMs: 500,  // throttle Yjs awareness events

  // Filtering
  ignoreRequests: ['/telescope*', '/health'],
  slowQueryThreshold: 100,     // ms

  // Sensitive data redaction (at collection time, never stored)
  hideRequestHeaders: ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key'],
  hideRequestFields: ['password', 'password_confirmation', 'token', 'secret'],

  // Auth gate for the dashboard
  auth: null,
} satisfies TelescopeConfig
```

## Custom routes registration

For packages or apps that need manual control over telescope routes:

```ts
import { registerTelescopeRoutes } from '@rudderjs/telescope'

await registerTelescopeRoutes(storage, {
  path: 'telescope',
  auth: (req) => req.user?.isAdmin ?? false,
  middleware: [myCustomMiddleware],
})
```

## API

The dashboard UI is built on a JSON API that you can use directly to build custom UIs:

| Endpoint | Description |
|----------|-------------|
| `GET /telescope/api/overview` | Count per entry type |
| `GET /telescope/api/{type}s` | List entries (supports `?page`, `?tag`, `?search`) |
| `GET /telescope/api/{type}s/:id` | Single entry |
| `GET /telescope/api/batches/:batchId` | All entries in a batch |
| `DELETE /telescope/api/entries` | Prune entries (supports `?type`) |

## Notes

- Auto-prune runs on a background interval based on `pruneAfterHours`.
- All peer packages are optional — install only the ones you use, and only those collectors activate.
- `createEntry()` helper is exported for manually constructing entries.
- The observer-registry pattern means collectors never break the build if a peer package is absent — they fail gracefully via try/catch on dynamic import.
