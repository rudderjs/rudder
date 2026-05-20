# @rudderjs/telescope

Debug dashboard — 18 collectors recording requests, queries, jobs, exceptions, logs, mail, events, cache, AI, and more. Dark mode support via OS preference.

## Key Files

- `src/index.ts` — Exports `TelescopeProvider`, `TelescopeRegistry`, `Telescope` facade, all collectors
- `src/types.ts` — `TelescopeEntry`, `Collector`, `TelescopeStorage`, `TelescopeConfig`
- `src/storage.ts` — `MemoryStorage` (bounded, default) and `SqliteStorage` (persistent via better-sqlite3)
- `src/batch-context.ts` — Correlates entries within a request lifecycle via `batchId`
- `src/redact.ts` — Sensitive data redaction (headers, fields) at collection time
- `src/routes.ts` — Dashboard + API route registration (incl. SSE stream route when `updates: 'stream'`)
- `src/stream.ts` — SSE push channel: subscriber registry on `globalThis`, `notifySubscribers()` fan-out, `createStreamResponse()` factory
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
- **List slug parity**: both `EntryList.ts` and `routes.ts` call `toApiSlug(type)` from `types.ts` — the single source of truth for `type → URL slug` mapping. `http`/`ai`/`mcp` stay singular, `view` → `views`, `query` → `queries`, everything else gets `s`. **Never inline this logic at either site** — historically a recurring footgun (drift between sites silently 404s the listing API). When adding a new `EntryType`, update `toApiSlug` in lockstep.
- **Smoke tests**: every collector has a `/test/<name>` route in `playground/routes/web.ts` (request-triggered) plus CLI/scheduler tests via `pnpm rudder greet "Bob"` / `pnpm rudder schedule:run`. Treat these as the canonical end-to-end fixtures when adding or refactoring a collector.
- **Dashboard updates transport**: `config.telescope.updates` is `'polling'` (default) or `'stream'`. Polling re-fetches `<apiPrefix>/<type-slug>` every `pollInterval` ms when Live is on. Stream registers `<apiPrefix>/stream` (SSE) and the dashboard opens an `EventSource` to it instead. Pure HTTP, no peer deps. Both share the same auth gate and recording toggle.
- **SSE subscriber registry**: lives on `globalThis['__rudderjs_telescope_subscribers__']` so it survives Vite SSR module re-evaluation (same pattern as the recording slot). Each `createStreamResponse()` call adds one `Subscriber` to the set; `cancel()` on the stream (client disconnect) removes it. Subscribers whose `write()` throws are silently dropped — never let a closed controller crash the fan-out.
- **Notify before store**: `Telescope.record()` calls `notifySubscribers(entry)` *before* `storage.store()`. Dashboard latency tracks the in-process emit, not however long persistence takes. Recording-toggle check still runs first so paused state suppresses both.
- **SSE keepalive**: `: keepalive\n\n` comment frame every 30s, below common 60s proxy idle timeouts. `X-Accel-Buffering: no` header disables nginx proxy buffering — without it, entries pile server-side until the buffer fills and dashboards look frozen. Don't strip these "cleanup" headers without re-reading this note.
- **Peer-bridge casts in collectors are load-bearing — don't refactor them.** Collectors like `ai`, `mcp`, `model`, `notification`, `query`, `schedule`, `mail` import peer-package observer registries via `await import('@rudderjs/<peer>/observers') as unknown as { subscribe(...) }`. Each defines its own minimal interface inline because (a) telescope is *downstream* of those packages — importing their full types would invert the dep graph, and (b) the minimal shape is the contract — a generic `observerBridge<T>()` helper would obscure which collector touches which registry. Each cast costs ~3 LOC; leave them in place.

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Doctor checks

Ships `src/doctor.ts`: `telescope:dashboard` — warns when telescope is installed but `registerTelescopeRoutes()` isn't called in `routes/web.ts`.

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
