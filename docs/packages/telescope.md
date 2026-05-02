# Telescope

Debug dashboard for RudderJS. Records requests, queries, jobs, exceptions, logs, mail, notifications, events, cache, schedule, model changes, CLI commands, outgoing HTTP, authorization decisions, WebSocket lifecycle, Yjs CRDT events, AI agent runs, MCP activity, and `dump()` calls. Serves a built-in UI at `/telescope`.

::: tip About the version number
Telescope is currently published at v9.x. The high major doesn't reflect 9 ground-up rewrites — it's the result of Changesets peer-bump cascades across the `@rudderjs/*` workspace. The public API has been stable since v6.
:::

## Install

```bash
pnpm add @rudderjs/telescope
```

Auto-discovered. Add a config:

```ts
// config/telescope.ts
import { Env } from '@rudderjs/support'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled: Env.getBool('TELESCOPE_ENABLED', true),
  path:    'telescope',
  storage: 'memory',
} satisfies TelescopeConfig
```

Run `pnpm rudder providers:discover` after install. The UI lives at `/{path}` (default `/telescope`) — vanilla HTML + Alpine.js + Tailwind CDN, so it works in React, Vue, Solid, or pure-API apps.

## What it records

19 entry types via the observer-registry pattern: each peer package exports a process-wide observer singleton; the matching collector subscribes at boot. Missing peers silently skip — no crash.

| Type | Source | Records |
|---|---|---|
| `request` | router | HTTP requests + responses |
| `query` | orm | DB queries (flags slow ones) |
| `job` | queue | Job lifecycle — one entry per terminal state (`dispatched`, `completed`, `failed`) with shared `jobId` |
| `exception` | core | Unhandled exceptions |
| `log` | log | All log channels |
| `mail` | mail | Sent emails |
| `notification` | notification | Dispatched notifications |
| `event` | core | Events + listener list |
| `cache` | cache | Hits, misses, writes, forgets |
| `schedule` | schedule | Task execution + output |
| `model` | orm | Create / update / delete with dirty diff |
| `command` | rudder | CLI invocations |
| `http` | http | Outgoing HTTP requests |
| `gate` | auth | Authorization decisions |
| `ai` | ai | Agent runs, tool calls, token usage |
| `mcp` | mcp | Tool calls, resource reads, prompt renders |
| `dump` | support | `dump()` / `dd()` calls |
| `broadcast` | broadcast | WebSocket lifecycle, presence, broadcasts |
| `sync` | sync | Yjs CRDT updates, awareness, persistence |

## Dashboard

- **Overview** — count cards per entry type
- **List** — searchable, paginated, tag-filtered, auto-refreshing
- **Detail** — type-specific views (formatted SQL, mail HTML preview, stack traces, WebSocket timelines)
- **Batches** — entries linked by `batchId` viewable at `/telescope/batches/{id}` so a single request shows alongside its queries, cache ops, and dispatched jobs

## Telescope facade

```ts
import { Telescope } from '@rudderjs/telescope'

const requests = await Telescope.list({ type: 'request', perPage: 25 })
const entry    = await Telescope.find('entry-id')
const total    = await Telescope.count('job')
await Telescope.prune('log')
```

| Method | Description |
|---|---|
| `Telescope.list(options?)` | Filter by type/tag/search with pagination |
| `Telescope.find(id)` | Single entry |
| `Telescope.count(type?)` | Total count, optionally per type |
| `Telescope.prune(type?)` | Delete, optionally per type |
| `Telescope.record(entry)` | Manually record a custom entry |

## Storage drivers

| Driver | When |
|---|---|
| `memory` (default) | Development. In-process, bounded by `maxEntries`. |
| `sqlite` | Persistent. Install `better-sqlite3` as a peer. WAL journal mode is enabled by default so the dev server, CLI commands, and BullMQ worker process all read/write the same `.telescope.db` concurrently — required for cross-process job lifecycle entries. |

```ts
storage:    'sqlite',
sqlitePath: '.telescope.db',
maxEntries: 1000,
pruneAfterHours: 24,
```

## Config knobs

Every collector toggles independently with `recordX: false`. Sensitive headers and request fields are redacted at collection time, before storage:

```ts
recordRequests: true,
recordQueries:  true,
// ...

ignoreRequests:     ['/telescope*', '/health'],
slowQueryThreshold: 100,      // ms

hideRequestHeaders: ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key'],
hideRequestFields:  ['password', 'password_confirmation', 'token', 'secret'],

auth: (req) => req.user?.isAdmin ?? false,    // gate the dashboard
```

## JSON API

The dashboard UI is built on a JSON API:

| Endpoint | Description |
|---|---|
| `GET /telescope/api/overview` | Count per entry type |
| `GET /telescope/api/{type}s` | List (`?page`, `?tag`, `?search`) |
| `GET /telescope/api/{type}s/:id` | Single entry |
| `GET /telescope/api/batches/:batchId` | All entries in a batch |
| `DELETE /telescope/api/entries` | Prune (`?type` optional) |

## Recording toggle

Pause and resume from the dashboard or via the API. The toggle lives on `globalThis` so it survives Vite SSR module re-evaluation; the storage layer checks it centrally before writing.

## Pitfalls

- **SQLite peer missing.** Setting `storage: 'sqlite'` without `better-sqlite3` installed throws — it does not silently fall back to memory.
- **Exception collector failing on its own error.** The collector must swallow internal errors (try/catch around `record()`) to prevent cascading stack overflows.
- **Field-name mismatch in detail vs list.** When a collector writes `agentName` but the list config expects `agent`, the entry shows in the list with a dash and full data in detail. Keep the column config and collector aligned.
- **Dump line numbers off in dev.** Under Vite SSR, line numbers are off by ~40-50 because Vite's Module Runner uses `new Function()` and source maps don't apply. Production reports correct lines.
- **Job entries split across processes (10.1+).** Telescope writes one entry per terminal lifecycle state — `dispatched` from the dispatcher process (with the request `batchId`), `completed`/`failed` from the worker process (no `batchId`). Use the `jobId` field to correlate dispatcher / worker rows for the same job. Under BullMQ this requires `storage: 'sqlite'` so both processes share the same DB; with `storage: 'memory'` the worker writes to its own process memory and never reaches the dashboard.

## Related

- [`@rudderjs/pulse`](https://github.com/rudderjs/rudder/tree/main/packages/pulse) — application metrics and aggregates
- [`@rudderjs/horizon`](https://github.com/rudderjs/rudder/tree/main/packages/horizon) — queue-specific monitoring
- [AI](/guide/ai) — AI agent runs appear under the AI tab
- [MCP](/guide/mcp) — MCP activity appears under the MCP tab
