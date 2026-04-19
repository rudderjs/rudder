# @rudderjs/telescope

Debug dashboard — 18 collectors recording requests, queries, jobs, exceptions, logs, mail, events, cache, AI, and more. Dark mode support via OS preference.

## Key Files

- `src/index.ts` — Exports `TelescopeProvider`, `TelescopeRegistry`, `Telescope` facade, all collectors
- `src/types.ts` — `TelescopeEntry`, `Collector`, `TelescopeStorage`, `TelescopeConfig`
- `src/storage.ts` — `MemoryStorage` (bounded, default) and `SqliteStorage` (persistent via better-sqlite3)
- `src/batch-context.ts` — Correlates entries within a request lifecycle via `batchId`
- `src/redact.ts` — Sensitive data redaction (headers, fields) at collection time
- `src/routes.ts` — Dashboard + API route registration
- `src/collectors/` — 18 collectors: request, query, job, exception, log, mail, notification, event, cache, schedule, model, command, broadcast, live, http, gate, dump, ai
- `src/views/vanilla/` — Dashboard UI (HTML + Alpine.js + Tailwind, framework-agnostic)

## Architecture Rules

- **Observer-registry pattern**: each collector subscribes to its peer package's observer singleton during `boot()`
- **Graceful degradation**: collectors silently skip if their peer package isn't installed
- **Redaction**: sensitive data is stripped at collection time, never stored
- **Batch correlation**: queries, cache hits, model events within a request share the same `batchId`
- **Auto-prune**: entries pruned on interval (default 24h)
- **Recording toggle**: state on `globalThis` (survives Vite SSR re-evaluation); `storage.store()` checks `isRecording()` centrally
- **Dark mode**: Tailwind `class` strategy with `prefers-color-scheme` detection; all views have `dark:` variants
- **Universal Context + Auth User cards**: `details/Layout.ts:renderRequestContext()` renders Hostname + "View Request" link + Authenticated User on every detail page (sourced from the related Request entry by `batchId`). Skipped on the Request entry itself. Don't duplicate these into per-watcher views.
- **List slug parity**: `EntryList.ts:apiPath` MUST match the slug logic in `routes.ts:apiPath`. `http`/`ai`/`mcp` stay singular, `view` → `views`, `query` → `queries`, everything else gets `s`. Mismatch silently 404s the listing API and the table renders empty.
- **Smoke tests**: every collector has a `/test/<name>` route in `playground/routes/web.ts` (request-triggered) plus CLI/scheduler tests via `pnpm rudder greet "Bob"` / `pnpm rudder schedule:run`. Treat these as the canonical end-to-end fixtures when adding or refactoring a collector.

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- `rm -rf dist && rm dist/.tsbuildinfo` before rebuilding — shared `tsBuildInfoFile` causes false cache hits
- Exception collector must swallow its own errors (try/catch around `record()`) to prevent cascading stack overflows
- Slow query threshold defaults to 100ms — configurable in `config/telescope.ts`
- Build with `--incremental false` or the dist may be empty (stale tsBuildInfoFile)
- Recording API uses `globalThis` directly — never `require('../index.js')` (ESM-only)
- **SQLite loader**: `SqliteStorage` resolves `better-sqlite3` via `createRequire(import.meta.url)` (with a `globalThis.__betterSqlite3` escape hatch for bundled environments). It will throw on `storage: 'sqlite'` if the package isn't installed — does NOT silently fall back to memory.
- **SQLite WAL mode**: enabled by default so the dev server and CLI commands can read/write the same `.telescope.db` concurrently. Without WAL, `pnpm rudder ...` would hit "database is locked" while `pnpm dev` was running.
- **Method-as-property bug pattern** (recurring): never read peer-class fields with bracket access (`obj['subject']`, `obj['description']`) when the class exposes a fluent setter of the same name — you get the *function source*, not the value. Read the underlying private field (`_subject`) or the explicit getter (`getDescription()`). Bit us in mail, schedule; check this when adding any new collector that introspects framework objects.
- **`SafeString` and `.join('')`**: rendering `arr.map(x => Card(...)).join('')` converts each `SafeString` to a plain string, so the outer `html\`\`` template re-escapes it as text. Pass the array directly: `${arr.map(x => Card(...))}`. The template handles `SafeString[]` natively.
- **Collector field name parity**: list `columns.ts` keys MUST match the keys the collector actually writes (e.g. ai collector writes `agentName`, not `agent`). Mismatch produces a confusing "value-in-list, dash-in-detail" symptom. When you find one, fix the *view* to the collector's naming, not the other way around.
- **Dump caller line numbers in Vite SSR dev**: file path is correct, line number is off by ~40-50. Vite's Module Runner uses `new Function()` to evaluate SSR modules, and Node's `--enable-source-maps` doesn't apply to those frames. `ssr.sourcemap: 'inline'` in `vite.config.ts` is also not honored. Treat this as a known dev-mode-only limitation; production (real files) reports correct lines.
