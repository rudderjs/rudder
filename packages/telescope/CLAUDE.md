# @rudderjs/telescope

Debug dashboard — 17 collectors recording requests, queries, jobs, exceptions, logs, mail, events, cache, and more.

## Key Files

- `src/index.ts` — Exports `TelescopeProvider`, `TelescopeRegistry`, `Telescope` facade, all collectors
- `src/types.ts` — `TelescopeEntry`, `Collector`, `TelescopeStorage`, `TelescopeConfig`
- `src/storage.ts` — `MemoryStorage` (bounded, default) and `SqliteStorage` (persistent via better-sqlite3)
- `src/batch-context.ts` — Correlates entries within a request lifecycle via `batchId`
- `src/redact.ts` — Sensitive data redaction (headers, fields) at collection time
- `src/routes.ts` — Dashboard + API route registration
- `src/collectors/` — 17 collectors: request, query, job, exception, log, mail, notification, event, cache, schedule, model, command, broadcast, live, http, gate, dump
- `src/views/vanilla/` — Dashboard UI (HTML + Alpine.js + Tailwind, framework-agnostic)

## Architecture Rules

- **Observer-registry pattern**: each collector subscribes to its peer package's observer singleton during `boot()`
- **Graceful degradation**: collectors silently skip if their peer package isn't installed
- **Redaction**: sensitive data is stripped at collection time, never stored
- **Batch correlation**: queries, cache hits, model events within a request share the same `batchId`
- **Auto-prune**: entries pruned on interval (default 24h)

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- `rm -rf dist && rm dist/.tsbuildinfo` before rebuilding — shared `tsBuildInfoFile` causes false cache hits
- Exception collector must swallow its own errors (try/catch around `record()`) to prevent cascading stack overflows
- Slow query threshold defaults to 100ms — configurable in `config/telescope.ts`
- `better-sqlite3` is optional — falls back to `MemoryStorage` if not installed
