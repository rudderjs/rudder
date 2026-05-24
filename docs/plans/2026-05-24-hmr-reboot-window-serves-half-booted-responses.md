# Dev HMR re-bootstrap serves EMPTY/half-booted responses to in-window requests

> **Correctness bug — falsifies the "No correctness bug" claim in `2026-05-24-hmr-dx-improvements.md` (line 7).**
> That plan shipped scoped invalidation in `@rudderjs/vite@2.7.0` and reasoned only about the *single triggering* request. It did not account for **requests that arrive while the async re-bootstrap is still in flight** — those are served against a half-booted app and return empty data.

**Status:** PARTIALLY SHIPPED — `@rudderjs/core@1.3.1` + `@rudderjs/vite@2.7.1` (#650/#651) fixed the single-request case, but **REOPENED 2026-05-25**: post-ship pilotiq E2E found concurrent requests during a reboot still race to empty and can wedge the ORM path permanently. See "Shipped" then "⚠️ REOPEN" at the bottom.
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
