# @rudderjs/telescope

Debug dashboard for RudderJS. Records requests, queries, jobs, exceptions, logs, mail, notifications, events, cache operations, scheduled tasks, model changes, CLI commands, outgoing HTTP, authorization decisions, WebSocket lifecycle, Yjs CRDT events, AI agent runs, MCP server activity, and `dump()`/`dd()` calls. Serves a built-in UI at `/telescope`.

## Installation

```bash
pnpm add @rudderjs/telescope
```

Auto-discovered via `defaultProviders()`. Just install, run `pnpm rudder providers:discover`, and add a config file:

```ts
// config/telescope.ts
import { Env } from '@rudderjs/core'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled: Env.getBool('TELESCOPE_ENABLED', true),
  path:    'telescope',
  storage: 'memory',
} satisfies TelescopeConfig
```

## Dashboard

Telescope serves a built-in UI at `/{path}` (default `/telescope`):

- **Dashboard** — count cards for all entry types
- **Per-type list pages** — searchable, paginated, tag-filtered, auto-refresh (2s polling)
- **Detail pages** — rich type-specific views (formatted SQL, mail HTML preview, stack traces, WebSocket timelines)
- **Batch grouping** — entries linked by `batchId` viewable at `/telescope/batches/{batchId}`
- **Sensitive data redaction** — headers and body fields stripped at collection time, before storage

The UI is vanilla HTML + Alpine.js + Tailwind CDN — no client framework dependency. Works with React, Vue, Solid, or pure API apps.

## Entry types

Telescope records 19 entry types via the observer-registry pattern — each peer package exports a process-wide observer singleton, and the corresponding collector subscribes at boot. Missing peer packages silently skip — no crash.

### Core watchers

| Type | Source | Description |
|------|--------|-------------|
| `request` | `@rudderjs/router` | Incoming HTTP requests and responses |
| `query` | `@rudderjs/orm` | Database queries (flags slow queries above threshold) |
| `job` | `@rudderjs/queue` | Queue job dispatch and execution |
| `exception` | `@rudderjs/core` | Unhandled exceptions |
| `log` | `@rudderjs/log` | Log messages across all channels |
| `mail` | `@rudderjs/mail` | Sent emails |
| `notification` | `@rudderjs/notification` | Dispatched notifications |
| `event` | `@rudderjs/core` | Dispatched events with listener list |
| `cache` | `@rudderjs/cache` | Cache hits, misses, writes, forgets |
| `schedule` | `@rudderjs/schedule` | Scheduled task execution with output |
| `model` | `@rudderjs/orm` | Model create/update/delete with dirty attributes diff |
| `command` | `@rudderjs/rudder` | CLI command invocations — args, duration, exit code |
| `http` | `@rudderjs/http` | Outgoing HTTP requests with timing, headers, response body |
| `gate` | `@rudderjs/auth` | Authorization decisions — ability, allowed/denied, resolution path, timing |
| `ai` | `@rudderjs/ai` | Agent runs — model, prompt, tool calls, token usage, middleware timing |
| `mcp` | `@rudderjs/mcp` | MCP server activity — tool calls, resource reads, prompt renders |
| `dump` | `@rudderjs/support` | `dump()` and `dd()` calls with arguments and caller location |

### Real-time watchers (Laravel Telescope doesn't have these)

| Type | Source | Description |
|------|--------|-------------|
| `broadcast` | `@rudderjs/broadcast` | Full WebSocket lifecycle — connections, subscriptions, presence, broadcasts. Grouped by `connectionId`. |
| `live` | `@rudderjs/live` | Yjs CRDT debugging — document open/close, updates applied, awareness changes (throttled), persistence events |

## Telescope facade

```ts
import { Telescope } from '@rudderjs/telescope'

// List entries by type
const requests   = await Telescope.list({ type: 'request', perPage: 25 })
const exceptions = await Telescope.list({ type: 'exception' })
const queries    = await Telescope.list({ type: 'query', search: 'SELECT' })

// Find a single entry
const entry = await Telescope.find('entry-id')

// Count
const total    = await Telescope.count()
const jobCount = await Telescope.count('job')

// Prune
await Telescope.prune('log')   // by type
await Telescope.prune()        // all
```

| Method | Returns | Description |
|---|---|---|
| `list(options?)` | `TelescopeEntry[]` | Filter by type/tag/search with pagination |
| `find(id)` | `TelescopeEntry \| null` | Single entry by ID |
| `count(type?)` | `number` | Count, optionally by type |
| `prune(type?)` | `void` | Delete, optionally by type |
| `record(entry)` | `void` | Manually record an entry |

## Storage drivers

| Driver | Description |
|---|---|
| `memory` (default) | In-process, bounded by `maxEntries`. Good for development. |
| `sqlite` | Persistent storage via `better-sqlite3`. Install the peer: `pnpm add better-sqlite3`. |

## Configuration

Every collector toggles independently:

```ts
// config/telescope.ts
export default {
  enabled: true,
  path:    'telescope',
  storage: 'memory',
  sqlitePath:     '.telescope.db',
  maxEntries:     1000,
  pruneAfterHours: 24,

  // Core watchers
  recordRequests:      true,
  recordQueries:       true,
  recordJobs:          true,
  recordExceptions:    true,
  recordLogs:          true,
  recordMail:          true,
  recordNotifications: true,
  recordEvents:        true,
  recordCache:         true,
  recordSchedule:      true,
  recordModels:        true,
  recordCommands:      true,
  recordHttp:          true,
  recordGate:          true,
  recordAi:            true,
  recordMcp:           true,
  recordDumps:         true,

  // Real-time
  recordBroadcasts:      true,
  recordLive:            true,
  liveAwarenessSampleMs: 500,   // throttle Yjs awareness events

  // Filtering
  ignoreRequests:     ['/telescope*', '/health'],
  slowQueryThreshold: 100,       // ms

  // Sensitive data redaction (at collection time)
  hideRequestHeaders: ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key'],
  hideRequestFields:  ['password', 'password_confirmation', 'token', 'secret'],

  // Auth gate for the dashboard
  auth: null,
} satisfies TelescopeConfig
```

## Custom route registration

For apps that need manual control:

```ts
import { registerTelescopeRoutes } from '@rudderjs/telescope'

await registerTelescopeRoutes(storage, {
  path:       'telescope',
  auth:       (req) => req.user?.isAdmin ?? false,
  middleware: [myCustomMiddleware],
})
```

## JSON API

The dashboard UI is built on a JSON API you can query directly:

| Endpoint | Description |
|---|---|
| `GET /telescope/api/overview` | Count per entry type |
| `GET /telescope/api/{type}s` | List entries (`?page`, `?tag`, `?search`) |
| `GET /telescope/api/{type}s/:id` | Single entry |
| `GET /telescope/api/batches/:batchId` | All entries in a batch |
| `DELETE /telescope/api/entries` | Prune (`?type` optional) |

## Architecture

- **Observer-registry pattern**: each collector subscribes to its peer package's observer singleton during `boot()`. If the peer isn't installed, the collector silently skips.
- **Batch correlation**: queries, cache hits, model events within a request share the same `batchId`.
- **Sensitive data redaction**: stripped at collection time, never stored.
- **Auto-prune**: runs on a background interval based on `pruneAfterHours` (default 24h).
- **Recording toggle**: lives on `globalThis` (survives Vite SSR re-evaluation); `storage.store()` checks `isRecording()` centrally.
- **Dark mode**: Tailwind `class` strategy with `prefers-color-scheme` detection; all views have `dark:` variants.

---

## Common pitfalls

- **SQLite loader throws.** `SqliteStorage` resolves `better-sqlite3` via `createRequire(import.meta.url)`. If the peer isn't installed, it throws on `storage: 'sqlite'` — it does NOT silently fall back to memory.
- **SQLite concurrency.** WAL mode is enabled by default so the dev server and CLI commands can read/write the same `.telescope.db` without "database is locked" errors.
- **Stale dist when rebuilding.** `rm -rf dist && rm dist/.tsbuildinfo` before rebuilding — shared `tsBuildInfoFile` causes false cache hits. Build with `--incremental false` or delete `.tsbuildinfo`.
- **Exception collector silent cascade.** The collector must swallow its own errors (try/catch around `record()`) to prevent cascading stack overflows from error-in-error-handler scenarios.
- **Collector field-name parity.** List `columns.ts` keys must match what the collector actually writes (e.g. AI collector writes `agentName`, not `agent`). Mismatch produces a confusing "value-in-list, dash-in-detail" symptom.
- **Dump line numbers in dev.** File path is correct, line number is off by ~40-50 under Vite SSR dev. Known limitation — Vite's Module Runner uses `new Function()` and Node's `--enable-source-maps` doesn't apply. Production reports correct lines.

---

## Related

- [`@rudderjs/pulse`](./pulse) — application metrics + aggregates (complements Telescope's per-entry detail)
- [`@rudderjs/horizon`](./horizon) — queue-specific monitoring with lifecycle tracking + failed-job retry
- [`@rudderjs/ai`](./ai/) — AI agent runs appear under the AI tab
- [`@rudderjs/mcp`](./mcp) — MCP activity appears under the MCP tab
