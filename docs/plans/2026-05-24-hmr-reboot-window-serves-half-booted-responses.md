# Dev HMR re-bootstrap serves EMPTY/half-booted responses to in-window requests

> **Correctness bug — falsifies the "No correctness bug" claim in `2026-05-24-hmr-dx-improvements.md` (line 7).**
> That plan shipped scoped invalidation in `@rudderjs/vite@2.7.0` and reasoned only about the *single triggering* request. It did not account for **requests that arrive while the async re-bootstrap is still in flight** — those are served against a half-booted app and return empty data.

**Status:** SHIPPED — `@rudderjs/core@1.3.1` + `@rudderjs/vite@2.7.1` (#650/#651) fixed the single-request case; **#652 (2026-05-25)** closed the residual by reusing one `PrismaClient` across dev re-boots (the unbounded connection leak behind the wedge). Hypothesis #1 (concurrent `Application.create()` race) was disproven by trace. Connection-reuse validated on SQLite *and* real MySQL (leak is catastrophic on MySQL — see "MySQL validation" at the bottom). Only open item: a headless regression test that reproduces the full wedge symptom (gated on a deterministic in-repo repro).
**Scope:** `@rudderjs/vite` (`rudderjs:routes` watcher) + `@rudderjs/core` (`Application.create()` globalThis caching / `_bootstrapProviders()` / `handleRequest`).
**Severity:** **correctness** (dev shows empty data after a routine edit), not just DX.
**Affected:** `@rudderjs/vite@2.7.0` (current). Any app that loads data in a provider-booted route handler (ORM queries) is exposed; visible in the pilotiq playground as empty resource tables.

---

## Symptom

Editing an `app/` file in dev (e.g. `app/Pilotiq/AdminPanel.ts`, even a one-line `.branding()` change) triggers the `[RudderJS] change detected — reloading` re-bootstrap. **Requests that land during the ~50ms–1.5s re-boot window render empty** — resource tables show their empty-state ("No records yet") despite rows in the DB, while pure-config (branding) reflects fine. Steady-state (a refresh ~2s later) is correct.

The browser's own post-edit `full-reload` fires a request **straight into this window**, so the user routinely sees the broken state. **Editor format-on-save makes it reliable**: the second write (a few hundred ms after the first) is a distinct watcher event → with no debounce, a *second* concurrent re-boot fires (log shows `change detected` ×2, `page reload` ×2, two overlapping SSR renders), widening/duplicating the window.

## Reproduction (pilotiq playground, `@rudderjs/vite@2.7.0`)

Single clean edits (one `sed` write, waited out) are always fine — that's why 2.7.0 "passed" initial validation. The race only shows under (a) an immediate post-edit request or (b) a double-write:

```sh
# simulate edit + format-on-save: two writes ~300ms apart → 2 "change detected"
sed -i '' "s/title: 'X'/title: 'Y'/" app/Pilotiq/AdminPanel.ts ; sleep 0.3
sed -i '' "s/title: 'Y'/title: 'Z'/" app/Pilotiq/AdminPanel.ts
# flood the reboot window with concurrent requests:
for w in $(seq 1 8); do ( curl -s localhost:3003/new-admin/articles | grep -oc '</td>' ) & sleep 0.25; done; wait
```

Result across 5 rounds: most requests return `1` `</td>` (empty table); one round had **all 8** empty. Steady-state after the window: `101` (full data). The `orm-prisma` query returns empty (not an error) when the provider isn't booted yet.

## Mechanism (hypothesis for the framework session to confirm against source)

Per the chain documented in `2026-05-24-hmr-dx-improvements.md` §"How the pieces actually connect":

1. Watcher clears `globalThis.__rudderjs_instance__` + `__rudderjs_app__`, invalidates, sends `full-reload`.
2. Next request: `Application.create()` misses the globalThis cache → constructs fresh → `await _bootstrapProviders()` (async, ~50ms cold-warm to ~1.5s).
3. **A request arriving during that await** either (a) reads the freshly-cached-but-not-yet-booted instance (if `globalThis.__rudderjs_app__` is set *before* `boot()` completes), or (b) kicks off its own parallel `create()` + re-boot. Either way the `orm-prisma` provider's `boot()` hasn't finished → `app.make('prisma')` resolves to a not-ready/stale binding → the model query returns empty instead of throwing → empty table.
4. No **debounce** on the watcher means editor atomic-save / format-on-save fires the whole sequence twice → two concurrent re-boots → larger/duplicated window.

## Framework confirmation (rudder side, 2026-05-24 — verified against source)

Confirmed the two unguarded spots, with one correction to the mechanism above:

- **Double-fire — CONFIRMED.** `packages/vite/src/index.ts` `server.watcher.on('change', …)` has **no debounce**: every event runs clear-globals → `invalidateBackendSubtree` → `full-reload` immediately. Format-on-save / atomic-write (two writes ms apart) = two `change detected` = two concurrent re-boots. This is the reliable-repro trigger.
- **Un-booted app published to the global — CONFIRMED.** `Application.create()` (`packages/core/src/application.ts:95`) sets `globalThis.__rudderjs_app__ = new Application(config)` at *construction*; `app.bootstrap()` runs later inside `_bootstrapProviders`. So `app()` points at an un-booted Application during the window. `RudderJS.handleRequest()` (`app-builder.ts:444-448`) DOES `await this._boot`, so a *single* re-boot is gated **for code that goes through that instance's handler** — but a *concurrent* re-boot (the double-fire) clears + swaps the globals out from under an in-flight request.
- **No single-flight** on the re-boot: each `create()` after a globals-clear builds a fresh instance + Application and boots independently.
- **CORRECTION to mechanism step 3:** the ORM does **not** resolve `app().make('prisma')` at query time. It reads a **globalThis-backed registry** `__rudderjs_orm_registry__` (`packages/orm/src/index.ts:92-116`) via `ModelRegistry.getAdapter()`. orm-prisma's `boot()` (`orm-prisma/src/index.ts:1231-1248`) does `ModelRegistry.set(adapter)`; nothing in the re-boot path calls `ModelRegistry.reset()`, so the **previous** adapter persists until the new boot overwrites it. So the empty render is **not** simply "un-booted app" — `getAdapter()` would otherwise *throw* (it errors on a null adapter, doesn't return empty). The empty almost certainly comes from the **double-fire** interacting with the Prisma client lifecycle (a concurrent re-boot building/connecting a new `PrismaAdapter` while an in-flight request queries) and/or `_store.adapter` being mid-swap. **This last link was not fully pinned statically — reproduce with `RUDDER_HMR_TRACE=1` + concurrent curls (the repro above) to confirm before finalizing lever 3.**

**Takeaway:** lever 1 (debounce) is the safe, high-value first fix — it removes the double-fire that is the reliable trigger, independent of the exact empty path. Levers 2+3 are the deeper correctness fixes; confirm the empty mechanism via the repro first so lever 3 targets the real culprit (ORM-registry swap vs. un-booted-app publish).

## Proposed fix (three independent levers)

1. **Debounce the watcher** (`@rudderjs/vite`, the `server.watcher.on('change')` handler): coalesce events within ~75–150ms so one save = one reload, regardless of atomic-write / format-on-save double events.
2. **Single-flight the re-bootstrap** (`@rudderjs/core`): store the in-flight boot as a promise; concurrent `create()`/request triggers `await` the same promise instead of starting a parallel boot.
3. **Gate request handling on boot completion** (`@rudderjs/core`, `handleRequest` / `Application.create`): do **not** publish the app instance to `globalThis.__rudderjs_app__` (or do not dispatch a request) until its providers have finished booting — i.e. requests during a reboot block briefly on the boot promise rather than observing a half-booted app. This is the actual correctness fix; (1) and (2) reduce how often the window is hit.

## Constraints (from the shipped plan — keep them)

- Never `server.restart()` (breaks in-flight SSR). `invalidateModule` is safe mid-request — but the **globals-clear + async re-boot** is the unguarded part this doc is about.
- Keep scoped invalidation (B1) from 2.7.0.

## Cross-repo context

Pilotiq bumped `@rudderjs/vite` 2.0→2.7 (its `project_pilotiq_panel_hmr_data_loss_fix`) which fixed the **common single-edit** case (the coarse `invalidateAll` reboot was even more exposed). This race is the residual: it remains under format-on-save double-fire and immediate post-reload requests. No pilotiq-side fix is possible — the half-booted window is owned by `@rudderjs/core`'s reboot lifecycle.

## Shipped (2026-05-24)

All three levers landed. Branch `fix/hmr-reboot-window-half-booted`.

1. **Debounce — `@rudderjs/vite` (`packages/vite/src/index.ts`).** The `rudderjs:routes` watcher now collects changed files into a `Set` and fires a single re-boot `100ms` after the last event in a burst (`performReboot()`, extracted + exported for unit testing). One save = one re-boot regardless of atomic-write / format-on-save double events. Tests: `performReboot` (multi-file invalidation, single full-reload, `invalidateAll` fallback, empty no-op) + watcher-debounce coalescing (via `node:test` `mock.timers`); the two pre-existing positive `plugins.test.ts` watcher tests now tick the debounce.

2. **Single-flight — `@rudderjs/core` (`app-builder.ts` `RudderJS`).** The constructor now goes through `_singleFlightBootstrap()`, which chains each re-boot after the previous one via `globalThis.__rudderjs_boot__`. Concurrent re-boots run strictly serially, so no boot interleaves its `router.reset()` / `resetGroupMiddleware()` / provider boot / `ModelRegistry.set()` with another. No-op in production (single boot, `prev === undefined`).

3. **Request gate — `@rudderjs/core` (`handleRequest()`).** After awaiting its own `_boot`, `handleRequest()` also awaits `globalThis.__rudderjs_boot__` when that points at a *newer* re-boot (a concurrent reload that started after this instance built its handler). In-window requests block on the latest boot instead of being served against half-booted shared state. No-op in the steady state and in production (`latest === this._providerBoot`).

**Reproduction → regression test.** The flaky curl-flood repro was converted to a deterministic test (`packages/core/src/reboot-single-flight.test.ts`) modelling both invariants with gated provider boots (no Vite/DB needed): (a) a re-boot triggered while another is in flight does not start until the first finishes; (b) `handleRequest()` blocks until the latest in-flight re-boot completes. Both **failed against the unfixed code** and pass after. This is independent of the exact empty-data path (ORM-registry swap vs. PrismaClient lifecycle vs. un-booted-app publish — the lever-3 open question in "Framework confirmation"): serializing + gating removes the concurrent-reboot window entirely, so whichever path produced empty is closed.

**Constraints kept:** no `server.restart()`; scoped invalidation (B1) untouched; `RUDDER_HMR_TRACE` instrumentation preserved (t0 is now taken at re-boot time, after the debounce settles, so the debounce delay isn't attributed to Vite's re-import).

---

## ⚠️ REOPEN — post-ship validation found a residual (pilotiq cross-repo E2E, 2026-05-25)

Validated `@rudderjs/core@1.3.1` + `@rudderjs/vite@2.7.1` against the live pilotiq playground. **The common case is fixed, but the concurrent path is not** — the "removes the concurrent-reboot window entirely" claim above is too strong.

**Fixed (confirmed):** the realistic **single-request** reload — format-on-save double-write edit → browser full-reload → one SSR request — was **6/6 clean** (steady-state 101 cells AND post-edit 101, 0 errors). 2.7.0 broke even this. Debounce + single-flight + gate clearly help.

**NOT fixed (reproduced):** **concurrent requests landing in the reboot window still race to empty, and can WEDGE the server permanently.**
- An 8-way concurrent flood through one reboot returned **3/8 empty** on a freshly-warmed, single-process server (no Vite `.build-*.mjs` ENOENT, no other error logged).
- Worse: that concurrent load left the server **stuck empty at steady-state** — repeated no-edit requests kept returning the empty-state, **no error, no self-recovery** (only a process restart clears it). The app still served (`/_notifications` → 200), so it's specifically the **ORM/table-data path** that wedged, not a crash. This matches the original "table stops showing data and doesn't come back."

**Why this is hit in practice, not just synthetic:** a real browser reload does NOT fire one request — it fires the document request **plus** the app's own polls **concurrently** (e.g. pilotiq's `databaseNotifications({ polling })` hits `/_notifications` alongside `/articles`). So 2–4 concurrent requests through the reboot window is the *normal* reload shape, not an edge case.

**Hypothesis (gap the current levers miss):** the gate (`handleRequest` awaits `globalThis.__rudderjs_boot__`) and single-flight both assume **one fresh instance per reboot**. But after the watcher clears `__rudderjs_instance__`/`__rudderjs_app__`, several concurrent requests can each miss the globalThis cache and race into `Application.create()` *before* any of them publishes its boot promise — so the serialization/gate has nothing to await yet, and multiple instances build + each runs `ModelRegistry.set()`/PrismaClient init. The regression test (`reboot-single-flight.test.ts`) models **gated provider boots** but NOT this **concurrent `Application.create()` race to publish the globals** — which is why it's green while the live server still breaks.

**Suggested direction:**
1. **Serialize/queue instance *creation*, not just the boot** — concurrent post-clear requests must share ONE freshly-created instance + its boot promise (e.g. publish an in-flight `create()` promise to globalThis and have racers await it), so the gate always has something to block on.
2. **Investigate the wedge** — a persistent stuck-empty ORM path (no error, survives steady-state) suggests `ModelRegistry`/`PrismaAdapter` left in a bad state after concurrent `ModelRegistry.set()` + PrismaClient (re)connect during reboot. Likely needs an atomic adapter swap and/or disconnect of the superseded client.
3. **Extend the regression test** to model N concurrent requests racing `create()` after a globals-clear (not just gated boots), reproducing the wedge headlessly.

**Repro (pilotiq playground, deps at 2.7.1):**
```sh
# warm a SINGLE fresh server first (kill ALL stray vike procs — orphans holding
# :3003 silently route requests to a wedged old server and pollute results).
sed -i '' "s/title: 'X'/title: 'Ya'/" app/Pilotiq/AdminPanel.ts; sleep 0.3   # format-on-save double-write
sed -i '' "s/title: 'Ya'/title: 'Yb'/" app/Pilotiq/AdminPanel.ts
for x in $(seq 1 8); do ( curl -s localhost:3003/new-admin/articles | grep -oc '</td>' ) & sleep 0.2; done; wait
# → some return 1 (empty-state) not 101; then no-edit steady-state stays 1 (wedged).
```
Pilotiq stays on 2.7.1 (strictly better than 2.7.0); this residual tracked for a follow-up PR.

---

## Framework session 2026-05-25 — hypothesis #1 disproven, adapter-reuse fix landed

Shipped via **#652** (`fix/hmr-reboot-adapter-reuse`, core + orm-prisma patch).

**Hypothesis #1 (concurrent `Application.create()` race) is FALSE — proven by trace.** Added `RUDDER_HMR_TRACE=1` construct counters to `Application.create()` (`application.ts`) and `AppBuilder.create()` (`app-builder.ts`). Live framework-playground run, flooding the re-boot window with 8 concurrent requests across 16 re-boots (incl. format-on-save double-writes): the counters climbed by **exactly 1 per re-boot** (`RudderJS construct #1…#17`, always paired with `Application construct #N`), never by 2. Vite's SSR module-runner dedupes the concurrent `bootstrap/app.ts` re-evaluation, and the synchronous globalThis guard + JS run-to-completion guarantee one instance per re-boot. **There is nothing to serialize at `create()` — drop suggested-direction #1.**

**Wedge cause confirmed in source = the ORM adapter is never torn down on re-boot.** `DatabaseProvider.boot()` (`orm-prisma/src/index.ts`) calls `PrismaAdapter.make()` on every re-boot → `new PrismaClient(...)` + a fresh driver connection (`new PrismaBetterSqlite3`, a new pg/mariadb pool, …); the superseded client was never `$disconnect()`ed and there was no globalThis-cached client (the standard Prisma-HMR guard). Under Prisma 7's driver-adapter model the app owns this lifecycle and Prisma de-dupes nothing — updating 7.4.2 → 7.8.0 does **not** fix it.

**Fix shipped (suggested-direction #2):** `PrismaAdapter.make()` now caches the live `PrismaClient` on `globalThis` keyed by connection signature (driver + url). Same signature → reuse the live client (zero new connections per edit); changed signature (a `config/database.ts` edit) → fresh client + `$disconnect()` the superseded one. No-op in production; `config.client` apps opt out. Regression test `packages/orm-prisma/src/client-reuse.test.ts` pins all three behaviours (reuse / disconnect-on-change / config.client opt-out).

**Wedge NOT reproducible in the framework playground (SQLite).** The pilotiq repro (8-way flood) was run against the framework playground on **both** the unfixed and fixed builds — **all requests returned full data (posts=100) on both**, even at 16 accumulated re-boots, no steady-state wedge. The reason became clear once measured: on SQLite (better-sqlite3) a leaked connection is a single local file handle, and across 10 re-boots the dev server held just `1→2→3→4→5` `dev.db` handles (dropping back whenever V8 GC'd the abandoned `PrismaClient`s) — harmless, queries keep working. With the fix it stayed flat at **1**. So the leak is real on SQLite but benign; that's why the framework playground stayed clean.

### MySQL validation 2026-05-25 — the leak is CATASTROPHIC on MySQL

The reason the wedge bites in the pilotiq environment but not the framework playground is the **driver**. Validated the same before/after against a **real MySQL** (`mysql://…@127.0.0.1:3306`, MySQL 8.0.33, **Prisma 7.8.0 — the latest**, `@prisma/adapter-mariadb`): a node loop calling `PrismaAdapter.make()` + a `SELECT 1` per simulated re-boot, counting established TCP connections to `:3306`.

| re-boot | unfixed | fixed |
|---|---|---|
| 1 | 20 | 20 |
| 2 | 26 | 20 |
| 3 | 38 | 20 |
| 4 | 54 | 20 |
| 5 | 66 | 20 |
| 6 | 78 | 20 |
| 7 | 112 | 20 |
| 8 | **132** | **20** |

Unlike SQLite's one-file-handle-per-leak, the mariadb adapter opens a **pool of ~16–20 connections per client**, and each leaked client keeps its whole pool → **132 connections after 8 edits**. MySQL's default `max_connections` is **151**, so **~9–10 edits exhausts the server**: new connections are refused (`ER_CON_COUNT_ERROR`, "Too many connections"), hard-wedging the app *and anything else pointed at that MySQL* with no self-recovery — a far better match for the reported "stops working, doesn't come back" than the silent-empty SQLite path. The fix holds it flat at one pool (`20`).

**Takeaways:** (1) the wedge severity is driver-dependent — benign GC-reclaimed file handles on SQLite, server-connection exhaustion on MySQL/Postgres pools; (2) **updating Prisma does not help** — this ran on 7.8.0; (3) the fix is validated on real MySQL, not just unit tests. Suggested-direction #3 (a headless wedge regression test) is still gated on a deterministic in-repo repro, but the connection-count before/after above is the deterministic signal that matters and is covered by `client-reuse.test.ts` at the unit level.

---

## ⚠️ REOPEN #2 — pilotiq SQLite still wedges on the #652-"fixed" deps; NOT the connection leak (pilotiq session, 2026-05-25 later)

Validated the **pilotiq playground** (SQLite / better-sqlite3) on the exact shipped-fixed deps — `@rudderjs/core@1.3.2` + `@rudderjs/orm-prisma@2.0.1` + `@rudderjs/vite@2.7.1` (#652). **The resource-table wedge still reproduces**, which contradicts "the connection-reuse fix closed the residual" *for the SQLite/pilotiq case*. The prior MySQL validation is not in question — this is a second, distinct mechanism the connection-reuse fix doesn't touch.

**Single most important finding — the pilotiq-SQLite wedge is independent of the orm-prisma version (A/B proven):**
- Pinned the playground back to `@rudderjs/orm-prisma@1.9.1` (pre-#652, no globalThis client reuse), reinstalled, re-ran the repro: **identical behaviour** — baseline 6 rows → one `AdminPanel.ts` edit → `articles` stuck at `0` for 8s.
- Pinned forward to `2.0.1` again: same wedge.
- ∴ the empty/wedge the pilotiq user reports is **NOT the PrismaClient connection-leak** #652 addressed (that path is benign on SQLite anyway, as this plan already established). There is a **second residual** on the half-booted ORM path that survives #652.

**Repro is lighter than the documented 8-way flood** (single server, **confirmed no orphan vike procs** — `lsof -ti :3003` = 1 PID throughout):
- A **single** one-line `sed`/`perl` edit to `AdminPanel.ts` (no double-write needed) → `change detected — reloading` (one re-boot) → `articles` list wedges empty and **does not self-recover over 24s** of light *sequential* (not concurrent-flood) polling.
- A **cold boot** can also start wedged (baseline `0` before any edit) — flaky: some fresh boots render full data, some serve empty from the first request. The readiness poll + `predev` doctor + first SSR request supply enough concurrency at initial boot.
- The browser concurrency is supplied in practice by pilotiq's `databaseNotifications` polling hitting `/_notifications` alongside the page request (already noted in REOPEN #1).

**Two discriminators that point away from "dead shared adapter" and toward per-model / registration staleness** (new signal for the framework session):
1. **Per-resource:** in the wedged state, `posts` list renders full data while `articles` / `users` / `tags` / `videos` lists are empty — *on the same process and the same globalThis `ModelRegistry` adapter*. A wedged/disconnected shared adapter would empty **all** tables; one resource surviving suggests the breakage is **per-model** (a model class that lost/never-got its registration or adapter binding), not a dead adapter.
2. **Per-method:** for the *same* wedged resource, the single-record path works while the list path doesn't — `Article.find(id)` (the view page) returns the record while `Article.query().paginate()` (the list) returns empty. pilotiq's `Resource.query()` is just `this.model.query()`, so both use the same `Article` class — yet `query()` empties and `find()` doesn't.

**Pilotiq-side contribution RULED OUT (tested 2026-05-25).** I floated a hypothesis that pilotiq's *own* HMR re-import (`configureServer`'s watcher → `onPanelChange()` → `devServer.ssrLoadModule(AdminPanel.ts)` + `PilotiqRegistry` swap, incl. `watcher.on('add')` firing during initial boot) races the rudder re-boot and re-evaluates `Models/*` into fresh class identities that miss `ModelRegistry`. **Disproven:** disabled pilotiq's `onPanelChange` entirely (commented the three `watcher.on(...)` registrations, rebuilt dist), re-ran the repro → **the wedge still reproduces identically** (warm 6 rows → one edit → 0, stuck 18s; log still shows exactly one `change detected` = the rudder re-boot). So pilotiq's re-import is **not** a contributor — **the wedge is owned entirely by the `@rudderjs/*` re-boot/ORM lifecycle**, confirming this plan's "No pilotiq-side fix is possible" stance. The per-resource (`posts` survives) and per-method (`find()` vs `query().paginate()`) discriminators must therefore be explained **within the rudder ORM re-boot path** (e.g. `ModelRegistry` per-model state or `_store.adapter`/PrismaClient mid-swap), not by a second re-importer. ORM returns **empty, not an error**; nothing logged.

Also note this **broadens the affected surface**: the pilotiq user reports the **SiteSettings Global** (a single-record load via `find`, not a list `paginate`) *also* intermittently loses its data on an edit. So the "find works / list empties" split observed in one snapshot was timing luck, not a structural boundary — the whole booted-ORM data path can wedge, lists and single-record alike.

**Repro (pilotiq playground, deps core@1.3.2 / orm-prisma@2.0.1 / vite@2.7.1):**
```sh
# single clean server, then ONE edit (no double-write) — light sequential polling:
perl -pi -e "s/title: 'Pilotiq'/title: 'PilotiqZ'/" app/Pilotiq/AdminPanel.ts
for i in $(seq 1 16); do curl -s localhost:3003/new-admin/articles | grep -oc 'articles/cm'; sleep 1.5; done
# → drops to 0 and stays 0 for the full window; `posts` and the article view page stay full.
```

### Diagnostic probe shipped — `RUDDER_ORM_TRACE=1` (framework session, 2026-05-25)

Because the framework playground can't reproduce REOPEN #2 (SQLite leak is benign there), patching the ORM blind would be guessing. Instead shipped a probe in **`@rudderjs/orm`** (`ormTraceTerminal`, env-gated, zero overhead off): set `RUDDER_ORM_TRACE=1` and every read terminal logs

```
[orm] get model=Article class=#7 table=article adapter=#2 softDeletes=false scopes=[] rows=0
```

Run the repro above with the env var set against the **reproducing pilotiq playground**; the wedged `articles` line names the cause directly:
- `rows=0` **+ different `class=#N`** than a working query → a **stale re-imported model class** is being queried (closure captured the old/new identity wrongly). This is my leading hypothesis — confirmed in source that `ModelRegistry.register()` is a **no-op on name collision**, so a re-imported model class never re-installs its relation methods/listeners.
- `rows=0` **+ different `adapter=#M`** than a working query → adapter swap / a second adapter object.
- `rows=0` **+ unexpected `table=`** → class-name → table drift.
- `rows=0` **+ non-empty `scopes=[...]` or `softDeletes=true`** → a filter emptying the set.
- `rows=0` with everything matching a working query → the empty is below the Model layer (adapter/PrismaClient state).

Confirmed from source while building the probe: `find()` (via `_q()`) and `query()` take the **same** adapter + soft-delete + global-scope path, so the earlier "find works / query empties" split is **not structural** (timing luck, as the broadening note above already concluded). Ships via the next `@rudderjs/orm` patch; the pilotiq agent runs the probe and reports the line.

### Probe results — pilotiq agent ran `RUDDER_ORM_TRACE=1` (pilotiq session, 2026-05-25)

Bumped the pilotiq playground to `@rudderjs/orm@1.12.1` (within its `^1.12.0` range), ran `RUDDER_ORM_TRACE=1 pnpm dev`, reproduced against the live wedge. Deps: `orm@1.12.1` + `core@1.3.2` + `orm-prisma@2.0.1` + `vite@2.7.1`, SQLite.

**Headline: the wedged query emits NO trace line at all — so the `rows=0`-line decision tree above does not apply. The signal is the line's ABSENCE.** The wedged list query never reaches the read terminal; it throws/short-circuits *upstream* of `get`/`paginate`.

- **Working baseline + clean reboots:** `paginate model=Article class=#1 table=article adapter=#1 softDeletes=false scopes=[] rows=6`. The **`adapter=#N` object identity increments once per reboot** (`#1→#2→…→#5`); a query landing *after* the reboot window hits the new adapter and returns full rows. **So a swapped adapter is benign on its own — not the wedge.** The **`class=` tag stayed `#1` across every reboot** (model NOT re-imported in these runs) → the "stale re-imported model class" leading hypothesis **did not fire here**: `app/Models/*` kept identity (`Resource.model` is a static class ref imported once; pilotiq's panel re-import is incremental and doesn't re-eval the model modules). The `register()`-no-op-on-collision finding may still bite a *different* edit shape, but it is not what wedges the pilotiq playground.
- **Wedge captured (in-window concurrent flood):** double-write edit, then 10 concurrent `/articles` fired immediately (no settle). **9/10 returned empty, 1 returned full** — the 1 full logged exactly one line `paginate model=Article class=#1 adapter=#5 rows=6`; the **9 empty produced no `model=Article` line whatsoever**. Server then **stayed wedged** (`settled rows=0`, no self-recovery). A *single* edit followed by a `sleep`+query never wedges (the query lands after the window on the fresh adapter, logs `rows=6`).
- No error logged anywhere; the wedged response is a normal **200 with the empty-state table** (so the throw is swallowed to an empty render, not surfaced as a 500).

**Implication / next instrumentation:** the read-terminal probe can't see this cause because the wedged path never reaches it. Instrument **upstream** — the query-builder entry and `ModelRegistry.getAdapter()` — and log on the **throw path**, not just on a returned row count. The empty-not-error + no-line strongly indicates `getAdapter()` (or builder construction) **throws while `_store.adapter` is null/mid-swap during a *concurrent* reboot**, and the caller (pilotiq's records handler or the ORM builder) catches it into an empty result. The per-resource flakiness (`posts` survives a reboot that `articles` doesn't) is then just which request's builder-construction lands in the null-adapter gap — consistent with the concurrent-`create()`/adapter-mid-swap race this plan already suspects, now localized to **before** the read terminal.

### Upstream probe shipped + a source correction (framework session, 2026-05-25 later)

⚠️ **Correction to the hypothesis above:** `getAdapter()` is **NOT** the null-throw suspect. Verified against source — `_store.adapter` is only nulled by `ModelRegistry.reset()` (`packages/orm/src/index.ts:196`), and **`reset()` has ZERO callers in the entire non-test codebase**. `ModelRegistry.set()` only ever *overwrites* the adapter (and #652 keeps the client reused for pilotiq's stable SQLite url). So `_store.adapter` is never null after the first boot → `getAdapter()` cannot be the throw. The wedge throw is elsewhere: either (#1) `Model.query()` is never reached (the request dies above the ORM — route/resource not ready under the concurrent re-boot), or (#2) `adapter.paginate()`/`get()` *execution* throws (Prisma errors under the concurrent re-boot) and pilotiq swallows it to an empty 200.

**Extended `RUDDER_ORM_TRACE` (next `@rudderjs/orm` patch)** to discriminate those, two new line types:
- `[orm] build model=… class=#N table=… adapter=#M …` — at query **construction**, before scopes. **Presence proves `Model.query()` was reached.**
- `[orm] THREW <terminal> … :: <error.message>` — a terminal's adapter call **threw** (then re-thrown).

**How the agent reads the rerun** (run the single-edit + concurrent-flood repro with `RUDDER_ORM_TRACE=1`, watch the 9 wedged requests):
- **No `build` line** for the wedged requests → cause **#1**: the wedge is upstream of the ORM (route/resource), not the ORM itself. Instrument pilotiq's records handler / the request gate next.
- **`build` but no terminal/`THREW`** → threw between construction and the terminal (a global-scope fn, the proxy) — narrow there.
- **`build` + `THREW … :: <msg>`** → cause **#2**: the adapter execution threw; `<msg>` names it (Prisma connection state, undefined access, …) → fix targets that.

### Rerun results — extended trace `orm@1.12.2` (pilotiq agent, 2026-05-25)

Bumped the playground to `@rudderjs/orm@1.12.2`, `RUDDER_ORM_TRACE=1`, reproduced the wedge (double-write edit + 10 concurrent `/articles` in-window → `settled rows=0`, ~5/10 empty). Deps: `orm@1.12.2` + `core@1.3.2` + `orm-prisma@2.0.1` + `vite@2.7.1`, SQLite.

**Lands on your middle branch — `build` present, NO terminal, NO `THREW`.** The wedged requests log `[orm] build model=Article …` but **never a matching `paginate`**, and there are **zero `THREW` lines anywhere**. Counts across the run: `class=#1` → 5 `build` / 2 `paginate`; `class=#2` → 5 `build` / 3 `paginate` ⇒ **5 builds with no terminal and no throw**. So the query is constructed and then the terminal is simply **never executed** — the `.paginate()`/`.get()` call is *dropped*, not failing. (Adapter is `#2` for both — not an adapter-identity issue.)

**New signal the tree didn't anticipate — DUAL model-class identity after one reboot.** Article shows up as **both `class=#1` and `class=#2`** post-edit (it was uniformly `#1` before, and stayed `#1` across reboots that did NOT re-import the model module). So the *wedging* reboot **re-imports `app/Models/Article.ts` → a second class identity** while the first lingers; requests resolve `Resource.model` to one or the other (the per-request flakiness). Both identities show build-without-terminal, so it isn't simply "query the stale one." This fits the `ModelRegistry.register()` no-op-on-collision note: the second import can't re-install, so whichever identity a request lands on, the builder is half-wired and the terminal is silently skipped.

**Suggested next probe:** log at the boundary *between* `build` and the terminal — i.e. whether the deferred/proxy chain actually invokes `.paginate()` (and whether a global-scope/relation closure on the re-imported class returns a non-thenable or swallows). "No throw + no terminal" means execution stops after construction without an exception reaching the read terminal — the drop is in that chain on a re-imported class, not in the adapter.

### ⚠️ Probe gap — `count()` was untraced; "dropped terminal" is likely an ARTIFACT (framework session, 2026-05-25 later)

Before chasing "the terminal is dropped," a confound: **`count()` is a QueryBuilder read terminal that the first two probe versions did NOT trace** — it fell through the proxy's pass-through `default` case and logged **no terminal line**. And `orm-prisma`'s `paginate()` counts **internally** (a single `Promise.all([findMany, count])`), so a `.paginate()` is exactly **1 `build` : 1 `paginate`** — it does *not* create extra builds. So the surplus builds (5 vs. 2–3 `paginate`) are almost certainly **separate `Model.query().count()` calls** (a list total / badge count), which were **invisible**. "build with no terminal" was very likely those counts, **not** dropped `paginate`s.

Two more reasons to distrust the "dropped" reading:
- The rerun's own **`settled rows=0`** *is* a `paginate` terminal line returning 0 — i.e. at least some wedged renders are **`paginate` returning empty**, not a missing terminal. That points back at the adapter execution returning `[]`, the original empty-not-error question.
- The **dual `class=#1/#2`** finding is real (the model *was* re-imported this run), but the `register()`-no-op-on-collision only skips re-installing **relation accessors** (`belongsToMany`/morph, on the prototype). `query().paginate()` doesn't use those — it goes through the proxy terminal — so a re-imported class still paginates. That chain doesn't obviously drop a plain list terminal; treat it as unconfirmed.

**Fixed (folded into the same `@rudderjs/orm` patch / PR #659):** `count` is now a traced terminal (`[orm] count … rows=N`). The trace is now **1 `build` : 1 terminal** for the whole read surface. **Rerun read:**
- the surplus builds resolve to **`count rows=N` lines** → "dropped terminal" disproven; the real signal is the **`rows=` on the `paginate` lines**.
- if those `paginate` lines show **`rows=0`** → the wedge is **`adapter.paginate()` returning empty** under the concurrent re-boot (instrument the adapter / Prisma execution next — *not* the proxy chain).
- only if a `build` still has **no** matching `count`/`paginate`/`THREW` is a terminal genuinely dropped.

### Clean re-run — `orm@1.12.3` (count() traced), pilotiq agent 2026-05-25

Bumped the playground to `orm@1.12.3`, `RUDDER_ORM_TRACE=1`, reproduced the wedge (double-write + 10 concurrent `/articles` in-window → `settled rows=0`, 3/10 full / 7 empty). Reads against your tree:

- **"Dropped terminal" disproven ✓.** Build:terminal is now ~1:1 — post-edit `7 build = 4 count + 3 paginate`, no orphan builds. The earlier "build with no terminal" was exactly the untraced `count()`. Your count()-trace fix did its job.
- **`adapter.paginate()` returning empty is RULED OUT ✗.** Every `paginate model=Article` line shows **`rows=6`**, never `rows=0` — both warm (`adapter=#1`) and post-reboot (`adapter=#2`). When paginate runs, it returns the full set.
- **`count()` is a constant red herring.** Every `count model=Article` line is **`rows=0`, including the warm/working baseline** (`adapter=#1`, before any edit) — yet the warm table renders 6 rows. So `count()=0` does not drive the empty table; it's a secondary/badge count of something genuinely empty (nav badge or similar), unrelated to the wedge.
- **The actual wedge signal (new, not on the tree): empty requests issue a `count` but NEVER a `paginate`.** The 3 full requests each produced `paginate rows=6`; the 7 empty requests produced only `count rows=0` (or no ORM line at all) — **no `paginate` is ever built/issued for them**. So the data query isn't *dropped at the terminal* and isn't *returning empty* — it's **never issued** for the wedged requests. That puts the gap **upstream of the adapter**: the half-booted request runs the chrome/badge path (`count`) but **skips the resource table-data builder** (`paginate`), rendering the empty-state. Matches this plan's original "half-booted app serves a request that doesn't run the full data path" thesis — now pinned to *which* path runs (badge `count`) vs is skipped (table `paginate`).
- **Dual class identity (`#1` + `#2`) still present** post-reboot (model module re-imported) — orthogonal to the above, but a real reboot artifact.

**Next probe suggestion:** instrument *upstream* of the ORM — pilotiq's `modelTableRecords` / the SSR `+data` table-data step — to log whether `R.query().paginate()` is even reached on the wedged requests (vs the records handler short-circuiting / the half-booted page-data builder skipping the table). The "issues `count` but never `paginate`" split says the request is executing *something* (badge) but not the table-data branch.
