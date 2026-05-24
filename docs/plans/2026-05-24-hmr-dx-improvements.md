# Dev HMR DX — targeted invalidation, tiered reload, external-package HMR

**Status:** plan, 2026-05-24. Pickup task for a framework session.
**Scope:** `@rudderjs/vite` (`rudderjs:routes` plugin) + `@rudderjs/core` (`RudderJS._bootstrapProviders()` / re-boot lifecycle). Touches `@rudderjs/server-hono` only for instrumentation.
**Severity:** DX / perf. No correctness bug — the current path is *correct* but blunt. Every backend edit triggers a full re-bootstrap of all 23 providers + a whole-graph SSR invalidation + a full browser reload.
**Effort:** Phase A ~2h (instrument), Phase B ~1–2 days (targeted invalidation + tiering), Phase C ~1 day (external-package HMR). Phases are independently shippable; A gates B and C.

---

## Why this exists

RudderJS runs **two** HMR tracks in dev:

- **Track 1 — Frontend (fast, keep it):** `app/Views/**`, `pages/**`, components go through Vike + Vite native HMR / React Fast Refresh — partial swap, ~50ms, no page reload. `rudderjs:routes` deliberately excludes `app/Views/**` (`packages/vite/src/index.ts:190-195`) so views stay on this path.
- **Track 2 — Backend (blunt, the problem):** any change under `routes/`, `bootstrap/`, or `app/` (minus `app/Views/`) triggers the `rudderjs:routes` watcher (`packages/vite/src/index.ts:173-216`), which (1) deletes `globalThis.__rudderjs_instance__` + `__rudderjs_app__`, (2) calls `server.environments.ssr.moduleGraph.invalidateAll()`, (3) `server.hot.send({ type: 'full-reload' })`. The next SSR request re-imports the entry chain and re-runs the *entire* boot.

The three goals from the framework lead:

1. **Improve DX** — a one-line controller edit shouldn't re-boot every provider and full-reload the browser.
2. **Make it faster** — replace the `invalidateAll()` sledgehammer with scoped invalidation; only re-run what changed.
3. **Make it work with external packages** (e.g. `@pilotiq/*`) — today editing a linked package's source triggers nothing, and even if it did, externalized packages are Node-import-cached outside Vite's graph so `invalidateAll()` wouldn't re-evaluate them. This is the "pilotiq AdminPanel.ts needs a restart" staleness (`memory/project_pilotiq_hmr_staleness.md`).

### Measured baseline (captured 2026-05-24, `playground` on `pnpm dev`, `RUDDER_PERF_TRACE=1`)

Real numbers, not the cold-boot-audit estimate. These reshape the optimization target:

| Phase | First cold boot | Warm re-boot (after an edit) |
|---|---|---|
| `providers:register` | 0.5ms | ~0.1ms |
| `providers:boot` | **317.8ms** | **49–67ms** |
| `application.bootstrap` total | 318.3ms | 49–67ms |
| First SSR render after edit (`req view.renderPage`) | — | ~52ms (then ~4.5ms warm) |
| **Edit → `[RudderJS] ready` wall-clock** | — | **~1.1–1.5s** |

Key findings that change the plan:

- **The warm re-boot is ~50–67ms of provider `boot()` logic, not module re-import.** Modules are mostly cached (SSR-externalized + Node ESM cache, or warm in Vite's graph), so the cost is the boot *logic* re-running — every provider's `boot()` fires again. This contradicts the old "Application.bootstrap is 1.1ms" memory (`project_perf_baseline_findings`): that was measured with all providers no-op-warm; under a real 23-provider app the warm re-boot is ~50ms and the cold first boot is ~318ms (Prisma client init + lazy provider module loads dominate the cold delta).
- **The ~1.1–1.5s edit-to-ready wall-clock is dominated by Vite's file-watch debounce + invalidation machinery + the re-import round-trip, NOT our boot logic.** `invalidateAll()` walks and dirties the *entire* SSR module graph; the next request re-fetches that graph through Vike's runner. Scoping the invalidation (Phase B) is where the wall-clock win lives, more than shaving the 50ms boot.
- **The first request after an edit was ~48–78ms total in the warm playground**, not 600ms. The 600ms figure in the cold-boot audit is a *true cold* boot (fresh process). After an edit the process is warm, so the real pain is (a) the full browser reload (loses scroll/SPA state, jarring) and (b) the ~1s wall-clock before the page is interactive again — both DX, not raw latency.

> **To validate:** the ~1.1–1.5s edit-to-ready was measured by polling the dev log for `[RudderJS] ready` after appending a comment to `routes/web.ts`. Phase A replaces this with precise markers so we attribute the wall-clock to (watcher-fire → invalidate → re-import → boot → first-render) segments instead of guessing.

---

## How the pieces actually connect (verified against source)

The chain that makes a backend edit reload, end to end:

1. **Watcher fires** — `server.watcher.on('change', ...)` in `rudderjs:routes` (`packages/vite/src/index.ts:193`). Filters to `routes/`/`bootstrap/`/`app/` minus `app/Views/`.
2. **Globals cleared** — `delete g['__rudderjs_instance__']` + `delete g['__rudderjs_app__']` (`index.ts:202-203`).
3. **Whole SSR graph invalidated** — `server.environments.ssr.moduleGraph.invalidateAll()` (`index.ts:209`).
4. **Browser full-reload** — `server.hot.send({ type: 'full-reload' })` (`index.ts:213`).
5. **Next request re-imports the entry** — Vike's SSR runner re-evaluates `+server.ts`, which statically imports `./bootstrap/app.js` (`playground/+server.ts:2`). That module runs `Application.configure(...).create()`.
6. **`create()` builds a fresh instance** — because the global was cleared, `AppBuilder.create()` (`packages/core/src/app-builder.ts:226-237`) and `Application.create()` (`packages/core/src/application.ts:92-100`) both miss their globalThis cache and construct fresh objects. The `RudderJS` constructor calls `this._bootstrapProviders()` (`app-builder.ts:256`).
7. **Re-boot runs** — `_bootstrapProviders()` (`app-builder.ts:274-292`) in dev: `rudder.reset()` → `router.reset()` → `resetGroupMiddleware()` → `await app.bootstrap()` (every provider `register()` + `boot()`) → serial route loaders (`runWithGroup` per loader).
8. **First request renders** — `RudderJS.handleRequest()` (`app-builder.ts:429-434`) lazily builds the HTTP handler (`_createHandler()`), `router.mount(adapter)`, then `app.fetch`.

**Why route-handler closures DO go live (this is load-bearing for the tiering design):** route handlers in `routes/web.ts` are inline arrow functions (`Route.get('/', async () => view('welcome', ...))`, `Route.registerController(AuthController)`) that close over **statically-imported** symbols (`AuthController`, `BillingController`, `User`, etc.). Those imports resolve through Vite's SSR module graph (they are app source under the `App/` alias, NOT externalized), so when `routes/web.ts` re-evaluates, the closures capture the *fresh* module bindings. This is exactly why the plain playground reflects controller edits live and pilotiq's externalized-package path does not (`project_pilotiq_hmr_staleness.md`).

**The router does NOT accumulate stale routes** — `router.reset()` runs before re-registration (`app-builder.ts:279`) and a fresh `new Hono()` is built per `createFetchHandler` (`server-hono index.ts:803`). The "duplicate handler / first-match-wins" hypothesis in `2026-05-24-provider-boot-route-handler-hmr-staleness.md` is falsified; do not rebuild on it.

---

## Phase A — Instrument & measure the re-bootstrap (gates B and C)

**Severity:** prerequisite. We optimize the measured hot spot, not a guessed one — per `feedback_measure_per_phase_not_inspect`.
**Effort:** ~2h
**Bumps:** none (instrumentation behind an env flag; not a published behavior change)

### The problem

There is already excellent per-*request* boundary instrumentation (`packages/server-hono/src/perf-boundaries.ts`, gated on `RUDDER_PERF_BOUNDARIES=1`) and a coarse boot trace (`RUDDER_PERF_TRACE=1` in `application.ts:298-308`). Neither covers the **re-bootstrap segment** specifically: the wall-clock from the watcher firing to the page being interactive again. We measured ~1.1–1.5s for that segment by log-polling, but we cannot yet attribute it across watcher-debounce / invalidate / re-import / boot / first-render.

### Fix — add re-boot phase markers, reuse the existing pattern

Two cheap additions, both env-gated so prod and normal dev are untouched:

**A1 — watcher-side timestamp.** In `rudderjs:routes` (`packages/vite/src/index.ts:193-214`), when `RUDDER_HMR_TRACE=1`, stamp `globalThis.__rudderjs_hmr_t0__ = performance.now()` and log the segment boundaries:

```ts
server.watcher.on('change', (file) => {
  if (!watchDirs.some(d => file.startsWith(d))) return
  if (file.startsWith(viewsRoot)) return
  const trace = process.env['RUDDER_HMR_TRACE'] === '1'
  const t0 = trace ? performance.now() : 0
  const g = globalThis as Record<string, unknown>
  if (trace) g['__rudderjs_hmr_t0__'] = t0
  delete g['__rudderjs_instance__']
  delete g['__rudderjs_app__']
  const tCleared = trace ? performance.now() : 0
  server.environments.ssr.moduleGraph.invalidateAll()
  const tInvalidated = trace ? performance.now() : 0
  server.hot.send({ type: 'full-reload' })
  if (trace) {
    console.log(`[hmr] clear-globals ${(tCleared - t0).toFixed(1)}ms · invalidate ${(tInvalidated - tCleared).toFixed(1)}ms`)
  }
  console.log(`[RudderJS] change detected — reloading (${path.relative(cwd, file)})`)
})
```

**A2 — re-boot segment in `_bootstrapProviders()`.** In `packages/core/src/app-builder.ts:274-292`, when `RUDDER_HMR_TRACE=1` and `__rudderjs_hmr_t0__` is present (i.e. this boot was triggered by a watcher event), log the gap from the watcher event to boot-start (that's the re-import + Vike-runner latency) and from boot-start to ready:

```ts
private async _bootstrapProviders(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  const hmrT0 = g['__rudderjs_hmr_t0__'] as number | undefined
  const trace = process.env['RUDDER_HMR_TRACE'] === '1' && typeof hmrT0 === 'number'
  const tStart = trace ? performance.now() : 0
  if (trace) console.log(`[hmr] watcher→reimport ${(tStart - hmrT0!).toFixed(1)}ms`)
  // ... existing reset + bootstrap + loaders ...
  if (trace) {
    console.log(`[hmr] reboot→ready ${(performance.now() - tStart).toFixed(1)}ms`)
    delete g['__rudderjs_hmr_t0__']
  }
}
```

**A3 — per-provider boot timing (opt-in deep mode).** The warm re-boot is ~50ms across 23 providers. To know *which* providers cost the most (so the tiering in Phase B can skip the cheap ones intelligently, and so we can spot a provider doing expensive work on every boot), extend the existing `RUDDER_PERF_TRACE` block in `Application._bootAll()` (`application.ts:276-294`) to log each provider's `boot()` duration when `RUDDER_PERF_TRACE=2`:

```ts
for (const provider of this.providers) {
  if (this._bootedProviders.has(provider)) continue
  const tp = deepTrace ? performance.now() : 0
  await provider.boot?.()
  if (deepTrace) console.log(`[perf]   ${provider.constructor.name} boot ${(performance.now() - tp).toFixed(1)}ms`)
  this._bootedProviders.add(provider)
}
```

### What this gives us

A single `RUDDER_HMR_TRACE=1 RUDDER_PERF_TRACE=2 pnpm dev` run, then an edit to a controller, prints:

```
[RudderJS] change detected — reloading (app/Http/Controllers/AuthController.ts)
[hmr] clear-globals 0.0ms · invalidate 12.3ms
[hmr] watcher→reimport 940.0ms        ← the dominant segment (Vite/Vike re-fetch)
[perf]   DatabaseServiceProvider boot 31.2ms   ← per-provider attribution
[perf]   AuthServiceProvider boot 4.1ms
...
[hmr] reboot→ready 51.7ms
```

### Regression test

Instrumentation is env-gated and dev-only; the test is a smoke assert that the markers don't fire when the flag is off (zero overhead) and that `__rudderjs_hmr_t0__` is cleaned up after boot so it doesn't leak into a non-HMR boot:

```ts
// packages/core/src/app-builder.test.ts
it('does not leave __rudderjs_hmr_t0__ on globalThis after a traced reboot', async () => {
  process.env.RUDDER_HMR_TRACE = '1'
  ;(globalThis as any).__rudderjs_hmr_t0__ = performance.now()
  // ... construct + await providerBoot ...
  assert.equal((globalThis as any).__rudderjs_hmr_t0__, undefined)
})
```

### Kill criteria

If A1+A2 confirm the dominant segment is `watcher→reimport` (Vite/Vike-owned, ~940ms in our run) and **not** our boot logic or the invalidation, then Phase B's value shifts from "skip re-boot" toward "shrink the invalidation set so Vite re-fetches fewer modules." If `watcher→reimport` is already small and boot logic dominates, Phase B's tiering (skip re-boot for controller-only edits) is the bigger win. **Measure before committing Phase B's design.**

---

## Phase B — Targeted invalidation + tiered reload (goals 1 + 2)

**Severity:** DX + perf.
**Effort:** ~1–2 days
**Bumps:** `@rudderjs/vite` minor, `@rudderjs/core` minor (new internal re-register entry point)

### The problem

`server.environments.ssr.moduleGraph.invalidateAll()` (`packages/vite/src/index.ts:209`) dirties the *entire* SSR graph on every backend edit. Combined with the unconditional full re-boot of all providers, a one-line controller change pays the same cost as a `bootstrap/providers.ts` change. Vite 7 exposes a scoped API we aren't using:

```ts
// node_modules/vite/dist/node/index.d.ts:1002-1006
getModulesByFile(file: string): Set<EnvironmentModuleNode> | undefined
invalidateModule(mod: EnvironmentModuleNode, seen?, timestamp?, isHmr?, softInvalidate?): void
invalidateAll(): void
```

`EnvironmentModuleNode` carries `importers: Set<EnvironmentModuleNode>` and `importedModules: Set<EnvironmentModuleNode>` (`index.d.ts:976-977`), so we can walk the changed file's importer subtree and invalidate only that, keeping framework packages warm.

### Fix — two independent levers

#### B1 — Scoped invalidation (replace `invalidateAll()`)

Invalidate only the changed file and its transitive importers (so the entry chain that re-imports `bootstrap/app.ts` gets re-fetched), not the whole graph:

```ts
function invalidateFileSubtree(server: ViteDevServer, file: string): boolean {
  const mg = server.environments.ssr.moduleGraph
  const mods = mg.getModulesByFile(file)
  if (!mods || mods.size === 0) return false   // not in graph (externalized/never-imported)
  const seen = new Set<EnvironmentModuleNode>()
  for (const mod of mods) {
    mg.invalidateModule(mod, seen)
    for (const importer of collectImporters(mod, new Set())) mg.invalidateModule(importer, seen)
  }
  return true
}
```

`collectImporters` walks `mod.importers` recursively. Crucially we must ensure `+server.ts` (and thus `bootstrap/app.ts`) ends up in the invalidated set — it transitively imports `routes/`, `bootstrap/`, and most of `app/`, so a changed file under those should reach it via the importer chain. **To validate:** confirm the importer graph actually links app-source files up to `+server.ts` under Vike's SSR environment — if Vike loads `+server.ts` through a separate runner that the app-source modules don't register as importers of, the subtree walk won't reach it and we fall back to also explicitly invalidating the `+server.ts` module by id. Keep `invalidateAll()` as the fallback when `getModulesByFile` returns empty (the externalized-package case — see Phase C).

#### B2 — Tier the reload by changed-file class

Classify the changed file and do the minimum:

| Tier | Files | Action | Why it's safe |
|---|---|---|---|
| **(a) Full re-boot** | `bootstrap/**`, `config/**`, `app/Providers/**` | current behavior: clear globals + invalidate + re-boot all providers + full-reload | provider wiring / config changed; everything downstream may depend on it |
| **(b) Routes-only** | `routes/**` | `router.reset()` + re-run route loaders ONLY (skip `app.bootstrap()`); invalidate route module subtree; full-reload | providers didn't change; only the route table did |
| **(c) App-code** | `app/Http/**`, `app/Models/**`, `app/Services/**`, etc. (minus `app/Views/**`, minus `app/Providers/**`) | invalidate the changed file's subtree; re-run route loaders so handler closures re-capture fresh imports; full-reload; **skip `app.bootstrap()`** if no provider closed over the file | handlers re-capture statically-imported app modules on loader re-run (verified above); providers don't generally re-read controllers at request time |

**Is tier (b) separable from the boot flow today?** Partly. `_bootstrapProviders()` (`app-builder.ts:274-292`) couples `router.reset()` + `app.bootstrap()` + loaders into one method. To support routes-only re-registration we need a new entry point that runs *just* the dev reset + loaders without `app.bootstrap()`:

```ts
// packages/core/src/app-builder.ts — new internal method on RudderJS
/** @internal — dev HMR: re-register routes only, skipping provider re-boot. */
async _reloadRoutesOnly(): Promise<void> {
  const { router } = await import('@rudderjs/router') as { router: { reset(): void } }
  router.reset()
  resetGroupMiddleware()
  for (const loader of this._loaders) await loader()   // serial — group-tagging order, see note
  // Rebuild the HTTP handler so the fresh router state is mounted onto a new Hono app.
  this._boot = null
  this._handler = null
}
```

**But there is a hard constraint:** `appendToGroup()` middleware is installed by *providers* during `boot()` (e.g. `@rudderjs/session`, `@rudderjs/auth`). `resetGroupMiddleware()` drains that store. If tier (b) calls `resetGroupMiddleware()` without re-running provider `boot()`, the web-group middleware (session, auth, CSRF) vanishes. So tier (b) must **either** (i) not drain group middleware (only reset the router routes, leaving provider-installed group middleware intact) **or** (ii) re-run provider boot anyway. Option (i) is correct: routes-only reload should reset `router` + re-run loaders, but **leave `groupMiddlewareStore` untouched** because no provider re-ran to repopulate it. This is a subtle but critical divergence from the full-reboot path.

> **To validate:** whether any provider `boot()` registers *routes* (not just middleware) via the router. If a provider registers routes in `boot()` (pilotiq's `registerPilotiqRoutes` does exactly this), then `router.reset()` in tier (b) drops those provider routes and they are NOT re-registered (because we skipped `app.bootstrap()`). That breaks pilotiq. **Therefore tier (b)/(c) must only apply to apps whose routes are registered purely in `routes/*.ts` loaders.** Detecting this is hard; the safe default is: if any provider registered routes during the last full boot, disable tiers (b)/(c) and fall back to full re-boot. Track this with a boot-time flag (`globalThis.__rudderjs_provider_registered_routes__`) set when `router.<verb>()` is called inside `app.bootstrap()`'s window. This makes the tiering opt-out-safe rather than silently wrong.

### Hard-won constraints this phase must not break

- **Never `server.restart()`** — closes the module runner and breaks in-flight SSR requests (`CLAUDE.md` pitfall; `index.ts:206-208` comment). Stay with invalidate + re-import.
- **In-flight requests** — `invalidateModule` is safe mid-request (Vite handles it); `server.restart()` is not. Keep the same discipline for the scoped path.
- **Serial loader execution** — `for (const loader of this._loaders) await loader()` must stay serial because `runWithGroup` uses a module-level `currentGroup` slot in `@rudderjs/router` (`router index.ts:106-125`) that concurrent loaders would clobber. `_reloadRoutesOnly` preserves the serial loop. Do NOT `Promise.all` it.
- **Group-tagging order** — the `_taggedLoader` wrapper (`app-builder.ts:209-214`) must wrap loaders identically in the routes-only path; reuse `this._loaders` (already wrapped at `withRouting` time), don't re-wrap.

### Regression test

```ts
// packages/vite/src/index.test.ts (new) — unit-test the classifier + subtree walk
it('classifies routes/ edits as routes-only, bootstrap/ as full-reboot', () => {
  assert.equal(classifyChange('routes/web.ts', cwd), 'routes')
  assert.equal(classifyChange('bootstrap/providers.ts', cwd), 'full')
  assert.equal(classifyChange('config/auth.ts', cwd), 'full')
  assert.equal(classifyChange('app/Http/Controllers/Foo.ts', cwd), 'app')
  assert.equal(classifyChange('app/Providers/AppServiceProvider.ts', cwd), 'full')
  assert.equal(classifyChange('app/Views/Welcome.tsx', cwd), 'skip')
})

// packages/core/src/app-builder.test.ts — routes-only reload preserves group middleware
it('_reloadRoutesOnly re-runs loaders without draining provider group middleware', async () => {
  // boot a RudderJS with a provider that appendToGroup('web', mw) in boot()
  // then call _reloadRoutesOnly() and assert the web group still has mw
  assert.ok(getGroupHandlers('web').includes(mw))
})
```

Plus a playground E2E in the scaffolder-render harness (`project_scaffolder_render_e2e_queued`): edit a controller, assert the new response without a process restart, and assert (via the HMR trace markers from Phase A) that `app.bootstrap()` did NOT re-run for a controller-only edit.

### Kill criteria

- If Phase A shows `watcher→reimport` (Vite-owned) is >80% of the wall-clock and our boot is <10%, then tier (b)/(c) "skip re-boot" saves ~50ms of a ~1100ms problem — not worth the complexity/risk. In that case ship **only B1 (scoped invalidation)**, which directly shrinks the Vite re-fetch set, and drop the tiering.
- If the "provider registered routes" detection (the pilotiq case) turns out to be common in real apps, tiers (b)/(c) become opt-out for most apps → minimal benefit → ship B1 only.

---

## Phase C — External-package HMR (goal 3)

**Severity:** DX for downstream package authors (pilotiq today; any `@scope/*` package that registers routes/views in a provider `boot()` tomorrow).
**Effort:** ~1 day
**Bumps:** `@rudderjs/vite` minor

### The problem — two root causes

**C-cause-1: the watcher never watches external package source.** `rudderjs:routes` watches only the app's own `routes/`/`bootstrap/`/`app/` (`packages/vite/src/index.ts:181-185`). Editing `node_modules/@pilotiq/pilotiq/src/AdminPanel.ts` (or its linked source) triggers nothing.

**C-cause-2: externalized packages are Node-import-cached outside Vite's graph.** Even if we triggered an invalidation, the externalized packages in `SSR_EXTERNALS` (`packages/vite/src/index.ts:8-42`) and any other `node_modules` package load through Node's native ESM, not Vite's SSR module runner. `invalidateAll()` only dirties Vite's graph — it does not touch Node's ESM cache. So a re-boot re-reads the **same stale module** and `PilotiqRegistry.reset()` + re-register just re-stores the stale panel. This is the confirmed pilotiq staleness (`project_pilotiq_hmr_staleness.md`): `boot()` re-runs, but re-reads stale source.

> **To validate (externalization nuance):** `@pilotiq/*` is NOT in our hardcoded `SSR_EXTERNALS` list, so whether it is externalized depends on Vite's default SSR behavior. Vite externalizes `node_modules` deps in SSR by default, but a **linked / symlinked** workspace dep is typically NOT externalized (Vite follows the symlink and pulls it into the graph). So the answer differs between "pilotiq installed from npm" (externalized → cached, stale) and "pilotiq pnpm-linked into the app" (in-graph → may already HMR). The pilotiq symptom is from a published/linked install where the package landed on the externalized path. **Confirm the actual resolution mode in the failing pilotiq setup before picking C2a vs C2b below.**

### Fix

#### C1 — Opt a package into the dev watcher

Let the app declare extra dirs to watch. Convention + config:

```ts
// vite.config.ts
rudderjs({
  watch: ['@pilotiq/pilotiq'],   // package names OR absolute dirs
})
```

The plugin resolves each entry to its source dir (via `resolveOptionalPeer`-style `createRequire().resolve()` then walk up to `package.json`, preferring a `src/` dir if present) and `server.watcher.add(dir)`. For workspace/linked packages, auto-detect: any dependency whose resolved path is a symlink or lives outside the app's `node_modules` (i.e. a `workspace:` / `file:` / linked dep) is a watch candidate — but **default to opt-in via config** to avoid watching all of `node_modules`. Auto-detect of linked packages can be a follow-up once the explicit path is proven.

```ts
// packages/vite/src/index.ts — rudderjs() gains an options arg
export function rudderjs(opts: { watch?: string[] } = {}): Plugin[] {
  // ... in rudderjs:routes configureServer:
  const extraDirs = (opts.watch ?? []).map(resolvePackageSrcDir).filter(Boolean)
  for (const dir of [...watchDirs, ...extraDirs]) server.watcher.add(dir)
  // change handler: a hit in an extraDir → full re-boot (tier (a)), because
  // external packages register in provider boot() and we can't assume otherwise.
}
```

External-package edits always take **tier (a) full re-boot** — we can't assume their registration is loader-only, and (per Phase B's pilotiq note) they typically register routes/panels in provider `boot()`.

#### C2 — Bust the stale module

This is the crux and the part with a real ESM limitation. **ESM `import` cache cannot be cleared like CJS `require.cache`** — there is no public API to evict a module from Node's ESM loader registry. Two viable options:

**C2a — dev-mode `noExternal` for the watched package (preferred).** Add the opted-in package to `ssr.noExternal` *in dev only* so Vite owns it in the SSR module graph, where `invalidateModule` works:

```ts
// packages/vite/src/index.ts — config()
ssr: {
  external: SSR_EXTERNALS,
  noExternal: command === 'serve'
    ? [...SSR_NO_EXTERNALS, ...(opts.watch ?? [])]
    : SSR_NO_EXTERNALS,
}
```

Then the Phase B scoped invalidation (or `invalidateAll` fallback) re-evaluates the package because it's now a graph module, not a Node-cached external. **Risk:** pulling a server-only package into Vite's SSR transform can surface bundling issues (top-level `node:*` imports, native deps) that externalization was avoiding — which is *why* the `SSR_EXTERNALS` list exists. Mitigation: this is dev-only (`command === 'serve'`), and the package author opted in. If the package has native deps it can't be `noExternal`'d; document that constraint. **To validate:** that a `noExternal`'d `@pilotiq/pilotiq` actually transforms cleanly under Vite SSR in dev (it uses ORM/Prisma which we deliberately externalize — those stay external as transitive deps; only pilotiq's own source needs to be in-graph). This needs a real pilotiq dev run to confirm.

**C2b — query-string cache-busting on re-import (fallback if C2a can't work).** If a package genuinely cannot be `noExternal`'d (native deps), the only way to force Node to re-read it is to import it with a changing query suffix (`import('@pilotiq/pilotiq?t=' + Date.now())`) — but this requires the *re-import site* to append the suffix, which the app's `bootstrap/app.ts` static import does not do, and it leaks a new module instance per edit (memory growth across a long dev session). This is strictly worse than C2a and only a last resort. **Do not ship C2b unless C2a is proven impossible for a real package.**

#### C3 — let pilotiq drop `livePanel()`

Once C1 + C2a land, pilotiq's request-time `PilotiqRegistry.livePanel()` workaround (re-resolving the panel by name on every render-data builder, PRs #70/#71) becomes unnecessary: the provider `boot()` re-runs AND re-reads fresh source, so the registry holds the fresh panel and the closures capture it. Pilotiq removes the workaround in its own repo (cross-repo; framework just ships the capability — `feedback_rudder_repo_scope`).

### Regression test

```ts
// packages/vite/src/index.test.ts — resolver + config shaping
it('resolves a watched package name to its source dir', () => {
  const dir = resolvePackageSrcDir('@rudderjs/view')   // a real workspace pkg
  assert.ok(dir && existsSync(dir))
})
it('adds watched packages to ssr.noExternal only in serve mode', () => {
  const dev = rudderjsConfig({ watch: ['@pilotiq/pilotiq'] }, 'serve')
  assert.ok(dev.ssr.noExternal.includes('@pilotiq/pilotiq'))
  const build = rudderjsConfig({ watch: ['@pilotiq/pilotiq'] }, 'build')
  assert.ok(!build.ssr.noExternal.includes('@pilotiq/pilotiq'))
})
```

Plus the decisive **pilotiq E2E** (owned by the pilotiq agent, cross-repo): with `watch: ['@pilotiq/pilotiq']` configured, edit `AdminPanel.ts`, assert the rendered panel reflects the edit on the next request with no process restart. This is the probe from `project_pilotiq_hmr_staleness.md` ("new timestamp prints → re-evaluated") turned into a passing test.

### Kill criteria

- If C2a (dev `noExternal`) cannot transform a real external package cleanly under Vite SSR even after isolating transitive externals, and C2b's per-edit module leak is unacceptable for long dev sessions, then external-package HMR is not solvable from the framework side without a Node ESM cache-eviction API. In that case document the limitation and keep pilotiq's `livePanel()` workaround as the supported pattern — frame it as "request-time re-resolution is the recommended pattern for externalized packages that register in boot()."

---

## Open questions / to validate during implementation

1. **Does the SSR importer graph link app-source up to `+server.ts`?** (Phase B1.) If Vike's runner loads `+server.ts` through a path that doesn't register app-source modules as transitive importers, the subtree walk won't reach the entry and we must explicitly invalidate `+server.ts` by id. Verify by inspecting `getModulesByFile('+server.ts').importers` after an app-source edit.
2. **Do any installed providers register *routes* (not just middleware) in `boot()`?** (Phase B2.) This determines whether tiers (b)/(c) are safe to enable by default or must fall back to full re-boot. Pilotiq does this; the playground's installed providers may too (auth/passport/cashier register routes — but those run in `routes/web.ts` loaders, not provider boot). Audit with the boot-window route-registration flag.
3. **Is `@pilotiq/*` externalized or in-graph in the failing setup?** (Phase C.) Decides whether C2a even applies. Confirm resolution mode (npm-installed vs pnpm-linked) in the real pilotiq dev environment.
4. **Does a `noExternal`'d external package transform cleanly under Vite SSR in dev?** (Phase C2a.) Needs a real pilotiq dev run; the ORM/Prisma transitive externals must stay external while only pilotiq's own source enters the graph.
5. **What's the real wall-clock breakdown?** (Phase A output.) The ~1.1–1.5s edit-to-ready needs attribution before B's tiering is justified. If it's almost all Vite re-fetch, ship B1 only.

## Suggested PR order

1. **Phase A** — instrumentation (env-gated, zero-risk, gates the rest). Ship first, run it, decide B's shape from the numbers.
2. **Phase B1** — scoped invalidation (`invalidateAll()` → subtree walk with `invalidateAll` fallback). Lowest-risk perf win, benefits every app.
3. **Phase B2** — tiered reload (routes-only / app-code skip re-boot), gated by the provider-registered-routes safety flag. Ship only if Phase A shows boot logic is a meaningful slice.
4. **Phase C** — external-package HMR (`watch:` config + dev `noExternal`). Ship after B1 so the scoped invalidation is in place; unblocks pilotiq dropping `livePanel()`.
