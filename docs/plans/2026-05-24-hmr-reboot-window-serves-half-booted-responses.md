# Dev HMR re-bootstrap serves EMPTY/half-booted responses to in-window requests

> **Correctness bug — falsifies the "No correctness bug" claim in `2026-05-24-hmr-dx-improvements.md` (line 7).**
> That plan shipped scoped invalidation in `@rudderjs/vite@2.7.0` and reasoned only about the *single triggering* request. It did not account for **requests that arrive while the async re-bootstrap is still in flight** — those are served against a half-booted app and return empty data.

**Status:** handoff from a pilotiq dev session, 2026-05-24. Framework pickup.
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

## Proposed fix (three independent levers)

1. **Debounce the watcher** (`@rudderjs/vite`, the `server.watcher.on('change')` handler): coalesce events within ~75–150ms so one save = one reload, regardless of atomic-write / format-on-save double events.
2. **Single-flight the re-bootstrap** (`@rudderjs/core`): store the in-flight boot as a promise; concurrent `create()`/request triggers `await` the same promise instead of starting a parallel boot.
3. **Gate request handling on boot completion** (`@rudderjs/core`, `handleRequest` / `Application.create`): do **not** publish the app instance to `globalThis.__rudderjs_app__` (or do not dispatch a request) until its providers have finished booting — i.e. requests during a reboot block briefly on the boot promise rather than observing a half-booted app. This is the actual correctness fix; (1) and (2) reduce how often the window is hit.

## Constraints (from the shipped plan — keep them)

- Never `server.restart()` (breaks in-flight SSR). `invalidateModule` is safe mid-request — but the **globals-clear + async re-boot** is the unguarded part this doc is about.
- Keep scoped invalidation (B1) from 2.7.0.

## Cross-repo context

Pilotiq bumped `@rudderjs/vite` 2.0→2.7 (its `project_pilotiq_panel_hmr_data_loss_fix`) which fixed the **common single-edit** case (the coarse `invalidateAll` reboot was even more exposed). This race is the residual: it remains under format-on-save double-fire and immediate post-reload requests. No pilotiq-side fix is possible — the half-booted window is owned by `@rudderjs/core`'s reboot lifecycle.
