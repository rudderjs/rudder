---
status: done
created: 2026-04-12
completed: 2026-04-12
---

# Plan: Telescope Refresh — Architecture Migration + Laravel Parity + Real-Time Differentiators

## Status — DONE (All phases), 2026-04-12

Phases 1–3.2 shipped in session 1. Phase 3.3 (HttpClient, Gate, Dump) shipped in session 2.

| Phase | What shipped |
|---|---|
| **Phase 1** | Architecture migration to `src/views/vanilla/` + `registerTelescopeRoutes()`. `src/ui/` deleted. Pure refactor. |
| **Phase 2a** | Per-watcher detail pages at `/telescope/{type}/{id}` — 11 type-specific views using reusable sections (Card, KeyValueTable, JsonBlock, CodeBlock, Badge). Modal removed. |
| **Phase 2b** | Tag pills with click-to-filter (`?tag=X`), batch grouping page at `/telescope/batches/{batchId}` with chronological timeline and ms offsets. |
| **Phase 2c** | Auto-refresh toggle (2s polling, localStorage-persisted). Sensitive data redaction at collection time (`hideRequestHeaders`, `hideRequestFields`). |
| **Phase 3.1** | **CommandCollector** — records every CLI invocation via `commandObservers` registry in `@rudderjs/rudder`. |
| **Phase 3.2** | **BroadcastCollector** — full WebSocket lifecycle via `broadcastObservers` in `@rudderjs/broadcast`. 7-variant `BroadcastEvent` union. connectionId as batchId. UI labelled "WebSockets". |
| **Phase 3.2** | **LiveCollector** — Yjs CRDT debugging via `liveObservers` in `@rudderjs/live`. 7-variant `LiveEvent` union. Awareness throttled per-(docName, clientId) at 500ms window (configurable). |

**Deviations from original plan:**
- Phase 1 did NOT introduce `html\`\`` from `@rudderjs/view` — the embedded Alpine.js `<script>` blocks have HTML-escape semantics that are wrong for JS. Phase 2 introduced a tiny inlined `_html.ts` helper instead, keeping telescope free of the Vike peer dep.
- View files live at `src/views/vanilla/` (inside `src/`) instead of `views/vanilla/` (package root) because they're compiled as part of telescope's build, unlike auth's vendored views which are raw source files for consumers.
- Phase 3.1 "Batches index page" (top-level batch list) was deferred — the per-batch detail page from Phase 2b covers the main use case.

**Final entry type count: 14** (request, query, job, exception, log, mail, notification, event, cache, schedule, model, command, broadcast, live)

**Final test count: 37/37** telescope, 26/26 broadcast, 45/45 live, 89/89 CLI — no regressions.

---

## Overview

`@rudderjs/telescope` ships today with 11 watchers and a working but architecturally inconsistent UI: server-rendered HTML strings via `src/ui/{layout,pages}.ts` (~338 LOC) + Alpine.js, served by inline route registration in `src/api/routes.ts`. It does **not** follow the package-UI shape (`views/<fw>/` + `registerXRoutes()`) that `@rudderjs/auth` established as the convention.

This plan refreshes telescope in three phases:

1. **Architecture migration** — pure refactor to vanilla mode (`html\`\``) + `registerTelescopeRoutes()`. No behavior change. Becomes the **reference for vanilla-mode packages**, mirroring `@rudderjs/auth` as the React reference.
2. **Rich detail pages** — replace the generic JSON modal with per-watcher detail views (formatted SQL, mail HTML preview, exception stack traces, etc.) + tag pills + batch grouping.
3. **New watchers** — close the Laravel parity gap (Command, Batch, HTTP Client, Gate, Dump) **and** add the two RudderJS differentiators Laravel Telescope doesn't have: **Broadcast** and **Live (Yjs)**.

---

## Why this matters

- **Consistency:** every other package shipping UI uses `views/<fw>/` + `registerXRoutes(router, opts)`. Telescope is the outlier and there's no good reason for it.
- **Editability:** HTML strings have no JSX, no type safety on props, no syntax highlighting in editors, and modal-based detail views dead-end at "JSON.stringify the entry."
- **Differentiation:** Laravel Telescope has no native WebSocket or CRDT debugging. RudderJS owns the real-time story (`@rudderjs/broadcast` + `@rudderjs/live`) and telescope is the natural place to surface it. This is the strongest "we're not just porting Laravel" pitch.
- **Self-imposed constraint:** telescope is a debug tool, so it must keep zero-client-framework dependency. A user telescope-ing a Vue app shouldn't be forced to install React. Vanilla mode (`html\`\`` + Alpine) is the right answer.

---

## Cross-cutting decisions

| Decision | Resolution |
|---|---|
| Framework for telescope UI | Vanilla mode (`html\`\`` from `@rudderjs/view`) — keeps zero-framework constraint |
| Client interactivity | Alpine.js (via CDN, as today) — no build step, no bundler dep |
| Package shape | Match `@rudderjs/auth`: `views/vanilla/` + `src/routes.ts` exporting `registerTelescopeRoutes(router, opts)` |
| `@rudderjs/broadcast` rename | **Rejected.** Broadcast is the abstraction; WebSocket is one transport. Laravel parity matters. UI tab can still be labelled "WebSockets" if that reads better. |
| Watcher naming | Laravel-aligned class names (`BroadcastCollector`, `LiveCollector`) regardless of UI tab label |

---

## Phase 1 — Architecture migration

**Goal:** pure refactor to the package-UI shape. All 11 existing watchers render identically. No new features, no behavior change.

### Deliverables

- **`packages/telescope/views/vanilla/`** (new directory)
  - `Layout.ts` — shared chrome (sidebar nav, header, Alpine includes, Tailwind via CDN). Translates the current `src/ui/layout.ts`.
  - `Dashboard.ts` — count cards. Translates `dashboardPage()`.
  - `EntryList.ts` — generic master list with search/pagination/modal. Translates `entryListPage()`. Takes a `columns` config object identical to today's `Column[]`.
  - `EntryDetail.ts` — for now still the JSON dump in a modal (Phase 2 replaces it).
  - `pages/{Requests,Queries,Jobs,Exceptions,Logs,Mail,Notifications,Events,Cache,Schedule,Models}.ts` — one per watcher, each composing `EntryList` with its column config. Translates the per-type `requestsPage()`, `queriesPage()`, etc.
- **`packages/telescope/src/routes.ts`** (new) — exports:
  ```ts
  export interface RegisterTelescopeRoutesOptions {
    /** Path prefix for all telescope routes — default `/telescope` */
    path?: string
    /** Auth gate — receives request, returns boolean */
    auth?: (req: AppRequest) => boolean | Promise<boolean>
    /** Extra middleware to prepend to all routes */
    middleware?: MiddlewareHandler[]
  }
  export function registerTelescopeRoutes(
    router: Router,
    storage: TelescopeStorage,
    opts: RegisterTelescopeRoutesOptions = {},
  ): void
  ```
- **`packages/telescope/src/index.ts`** — `TelescopeProvider.boot()` calls `registerTelescopeRoutes(router, storage, { path, auth })` instead of inlining route registration.
- **`packages/telescope/src/api/routes.ts`** — slim down to just the API handlers (`listEntries`, `showEntry`, `overview`, `prune`). Page-rendering routes move to `routes.ts`.
- **Delete:** `packages/telescope/src/ui/` (both files).

### Verification

- `pnpm build && pnpm typecheck && pnpm test` — all pass
- `pnpm dev` in playground, navigate to `/telescope` and every list page — visual diff against current behavior
- `route:list` should show identical telescope routes as before
- Removing the package from providers should cleanly disable everything (provider opt-out path still works)

### Effort: ~2-3h, single commit

---

## Phase 2 — Rich detail pages + UX polish

**Goal:** replace the generic JSON modal with per-watcher detail views. Add the UX features Laravel has but we don't.

### Deliverables

#### Per-watcher detail views (`views/vanilla/details/`)

| Watcher | Detail view |
|---|---|
| **Request** | Tabbed: Headers / Body / Response / Timing. Sensitive header redaction. |
| **Query** | Formatted SQL via Prism (CDN). Shows bindings separately. Duration + model link. |
| **Exception** | Parsed stack trace with file/line. "Open in editor" links via `vscode://` URI. |
| **Mail** | Iframe HTML preview + plain text fallback + `.eml` download button. |
| **Job** | Class, payload (collapsible), status, attempts, exception (if failed). |
| **Log** | Level pill, channel, formatted message + context object. |
| **Notification** | Channel, notifiable, payload. |
| **Event** | Event class, payload, listener list. |
| **Cache** | Operation, key, value (collapsible). |
| **Schedule** | Description, expression, output, exit code. |
| **Model** | Model class, action, dirty attributes diff (before/after). |

Detail pages live at `/telescope/{type}/{id}` (full pages, not modals — they replace the modal entirely for deep linking + back-button navigation).

#### Cross-cutting UX

- **Tag pills** in list rows + click-to-filter (backend already supports `?tag=`)
- **Batch grouping**: when an entry has `batchId`, show "View all 47 entries from this request" link → filtered list view by `batchId`
- **Filter bar**: type selector, tag selector, status selector, search — all in one bar above the table
- **Auto-refresh toggle**: 2s polling on list pages, opt-in
- **Sensitive data redaction config**: `hideRequestHeaders: ['authorization', 'cookie']` config option

### Effort: ~3-4h

---

## Phase 3 — New watchers

Each watcher is independent and can ship as its own commit. Priority order favors quick wins, then differentiators, then breadth.

### Phase 3.1 — Quick wins (Laravel parity, low effort)

#### 1. CommandCollector — `~30 min`

Records every `rudder` CLI invocation: command name, arguments, options, exit code, duration, output (truncated).

**Hook point:** `packages/cli/src/index.ts` `main()` — wrap the command action in a try/finally that builds a TelescopeEntry. Skip if telescope isn't installed/booted (try/catch on the optional peer).

#### 2. BatchCollector — `~1h`

Surfaces queue batches as a first-class entity. Mostly UI work since the storage already has a `batchId` column.

**New page:** `/telescope/batches` listing distinct `batchId`s with: status, total jobs, pending, completed, failed, duration.

**Hook point:** `@rudderjs/queue` already tracks batches; just emit one entry per batch lifecycle event (start, complete, fail).

### Phase 3.2 — Differentiators (real-time debugging Laravel doesn't ship)

#### 3. ⭐ BroadcastCollector — `~2-3h`

The big differentiator. Records the full WebSocket lifecycle.

**Records per entry:**
- **Connection** — connect / disconnect with `connectionId`, IP, user agent, user id (if authenticated)
- **Subscription** — channel name, channel type (public/private/presence), auth result, duration of auth check
- **Broadcast** — channel, event name, payload size, recipient count, fanout duration
- **Presence** — join / leave with user info
- **Auth failure** — channel name, reason, request

**Hook point:** `@rudderjs/broadcast` already exposes `broadcast:connections` (so the introspection API exists). Hook the same emit points the CLI command reads from. Add a `BroadcastCollector` class in `packages/telescope/src/collectors/broadcast.ts`.

**Design constraint — hook the abstraction, not the driver.** The collector must subscribe to events from the abstraction layer (the `Broadcast` facade / `BroadcastingProvider`), **not** from `ws-server.ts` internals. Rationale: `@rudderjs/broadcast` currently conflates the Laravel-style broadcasting abstraction (channels, presence, auth, the `Broadcast` facade) with a first-party WebSocket server impl (`ws-server.ts`, ~288 LOC). Long-term, the driver may be extracted into `@rudderjs/reverb` (mirroring Laravel's `Illuminate\Broadcasting` + `laravel/reverb` split), opening the door to alternative drivers (Pusher, Ably, SSE fallback). If the collector hooks the abstraction, the eventual split is transparent — telescope keeps working against any driver. If it hooks `ws-server.ts` internals, the split breaks it. See `feedback_broadcast_split_future.md` in memory for the full reasoning.

**Detail page:** timeline view grouped by `connectionId` — analogous to Laravel's batch grouping by `batchId`. Shows the full life of one connection: subscribes, messages received, presence changes, disconnect.

**UI tab label:** "WebSockets" (more recognizable than "Broadcast" for non-Laravel users), even though the collector class is `BroadcastCollector` and the entry type is `broadcast`.

#### 4. ⭐ LiveCollector — `~3-4h`

The other differentiator. CRDT-aware Yjs debugging.

**Records per entry:**
- **Document opened/closed** — doc id, client id, user, byte size of initial sync
- **Updates applied** — doc id, update size in bytes, originating client, vector clock summary (NOT the raw CRDT bytes — too noisy and not human-readable)
- **Awareness updates** — cursor / selection / presence diffs, **sampled** to avoid 10k entries/second from one user typing. Sampling strategy: dedupe by `(docId, clientId, fieldChanged)` within a 500ms window, store the latest only.
- **Persistence events** — load from / save to disk, snapshot creation, GC runs
- **Errors** — schema mismatch, sync conflicts at the transport layer

**Hook point:** `@rudderjs/live` already exposes `live:docs` and `live:inspect` CLI commands (introspection exists). Add `LiveCollector` in `packages/telescope/src/collectors/live.ts`.

**Detail page:** Y.Doc tree inspector — browser version of `live:inspect` CLI. Shows the current document state, connected clients with cursor positions, recent update history with replay controls (step through CRDT updates one at a time).

**Open design question:** awareness sampling is the unique problem. 500ms dedupe window is a starting point — may need to be configurable or adaptive based on entry-rate.

### Phase 3.3 — Remaining Laravel parity

#### 5. HttpClientCollector — `~1h`

Outgoing HTTP requests via `fetch()`, `got`, `axios`. Fetch interceptor pattern.

**Records:** URL, method, request headers/body, response status/headers/body, duration.

#### 6. GateCollector — `~1h`

Authorization decisions. Needs `@rudderjs/auth` to expose a hook on `Gate::allows()` / `Gate::check()`.

**Records:** ability name, user id, model, allowed/denied, reason (if provided).

#### 7. DumpCollector — `~3h`

Real-time `dump()` output. The most involved because it needs:
- A global `dump(...args)` function (new export from `@rudderjs/core` or a new tiny package)
- A WebSocket channel to push dumps live to any open telescope tab
- A "Dump screen" that listens on the channel and renders dumps as they arrive

This is the only watcher that needs the broadcast package as a runtime dep — fitting, since Phase 3.2 already added the BroadcastCollector.

### Phase 3 total effort: ~12-15h across 7 commits

---

## Sequencing recommendation

1. **Phase 1** as one commit. Merge, dogfood for a day, fix anything visual that drifted.
2. **Phase 2** as one commit OR three smaller commits (detail pages / filter bar / auto-refresh).
3. **Phase 3.1** (Command + Batch) as two small commits — quick wins.
4. **Phase 3.2** (Broadcast + Live) — the strategically important block. Two commits, but ship them in the same session so the "real-time debug story" lands as a coherent unit.
5. **Phase 3.3** (HttpClient + Gate + Dump) — opportunistic, ship as time allows.

---

## Success criteria

Phase 1 done when:
- `packages/telescope/src/ui/` is gone
- `packages/telescope/views/vanilla/` and `src/routes.ts` exist
- All current routes work and render the same pages
- Provider's `boot()` calls `registerTelescopeRoutes(...)`
- All tests pass
- Telescope listed in CLAUDE.md as a vanilla-mode reference (next to auth as the React reference)

Phase 2 done when:
- Every watcher has a dedicated detail page at `/telescope/{type}/{id}`
- Tag click filtering works
- Batch grouping link on entries with `batchId`
- Auto-refresh toggle on list pages

Phase 3 done when:
- All 7 new watchers ship (or are explicitly deferred with a note in this plan)
- Telescope dashboard tab labels: Dashboard, Requests, WebSockets, Live, Queries, Jobs, Batches, Commands, Exceptions, Logs, Mail, Notifications, Events, Cache, Schedule, Models, HTTP, Gates, Dumps
- README updated highlighting "real-time debugging Laravel doesn't ship"

---

## Open questions

1. **Awareness sampling rate for LiveCollector** — start at 500ms dedupe window; revisit after dogfooding. Should this be a config option (`telescope.live.awarenessSampleMs`)?
2. **Sensitive data redaction defaults** — Laravel's defaults: `password`, `password_confirmation`, `_token`, `secret`, `authorization`, `cookie`. Adopt as-is?
3. **Detail page deep links** — should `/telescope/requests/abc123` work as a permalink (full page) AND as a modal when navigated from the list? Modal-vs-page tension. Recommend: page only (simpler, cleaner Back button, deep-linkable).
4. **Dump broadcast channel auth** — dumps may contain sensitive runtime values. Default to local-only? Behind the existing telescope auth gate? Both?

---

## Future direction (NOT in this plan, but design for it)

**`@rudderjs/broadcast` → abstraction + `@rudderjs/reverb` driver split.** Mirrors Laravel's mature `Illuminate\Broadcasting` + `laravel/reverb` architecture. Today the package is ~400 LOC and conflates both layers; splitting now is premature, but Phase 3.2's BroadcastCollector is designed to hook the abstraction so the eventual split is transparent. See `feedback_broadcast_split_future.md` in memory.

---

## Out of scope (explicitly NOT in this plan)

- Multi-process aggregation (collecting from multiple Node workers into one telescope instance) — needs a real distributed storage backend, separate effort
- Telescope-as-MCP-server (exposing entries to AI agents) — interesting but distinct
- Pulse integration (Pulse handles aggregate metrics, telescope handles per-event detail — they should coexist, not merge)
- Mobile-responsive UI — telescope is a developer tool, desktop-only is fine
- i18n — telescope is a developer tool, English-only is fine
