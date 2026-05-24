# React Server Components — Option B scoping (vike-server toolchain)

**Status:** plan / scoping, 2026-05-24. Not scheduled. Needs an explicit go/no-go.
**Origin:** Phase 4 of [`2026-05-23-vike-react-rsc-integration.md`](./2026-05-23-vike-react-rsc-integration.md) attempted a runnable `playground-rsc` app on the existing **Option A** integration (`+server.ts` → `app.fetch` → `@vikejs/hono`). It got the RSC request *routing* working end-to-end but hit a hard **dev/build-environment** wall. This doc scopes the **Option B** path the original doc deferred: adopting the `vike-server` / `standaloner` Vite toolchain that `vike-react-rsc` is actually designed for.

> Read the 2026-05-23 doc first — this is a continuation, not a replacement.

---

## TL;DR

- Option A's request routing is **correct and verified**: vike's `renderPageServer` reads `globalContext.config.middleware` and dispatches `vike-react-rsc`'s `/_rsc` middleware itself; `/_rsc` passes through server-hono's rewrite untouched (Phase 3, PR #638).
- Option A's **dev/build environment is insufficient**: `@vitejs/plugin-rsc`'s CJS vendor files (`react-server-dom/client.edge.js`) fail with `module is not defined` when Vite's SSR module-runner inlines them. This is **not** a version issue (ruled out: vite 7.2.2 vs 7.3.1, plugin-rsc 0.5.1 vs 0.5.26, rolldown, plugin order — all matched to the upstream example, same error).
- The working upstream example (`nitedani/vike-react-rsc/examples/full`) only works because of its **toolchain**: `standaloner` + `vike-server`/`vike-cloudflare`'s Vite-environment integration + a `server: { entry }` config. That toolchain configures `@vitejs/plugin-rsc`'s RSC/SSR environments correctly — and it *replaces* RudderJS's `@vikejs/hono` + `+server.ts` server integration.
- **Option B** = adopt that toolchain and re-thread RudderJS (routing / `view()` / middleware / error page / CORS / prewarm) through it. This is a structural change to `@rudderjs/server-hono`, the adapter **every** app depends on.

---

## B0 — Results (2026-05-24): core hypothesis VALIDATED ✅

**Open question #1 is answered YES: the environment fix is separable from the server runtime.** Option B does **not** require re-platforming `@rudderjs/server-hono` (B1). The `+server.ts` → `app.fetch` integration is kept untouched, and the RSC view server-renders end-to-end with the controller's `view()` props flowing through.

### What the CJS/ESM blocker actually was

Not a toolchain gap — a **pnpm dependency-resolution** problem. The vendored plugin's environment config (`src/plugin/plugins/config.ts`) already lists `@vitejs/plugin-rsc/vendor/react-server-dom/client.edge` (and friends) in `ssr`/`rsc`/`client` `optimizeDeps.include`. But those are deps of the **vendored `vike-react-rsc`**, not of `playground-rsc`. Under pnpm's strict `node_modules`, the app root can't resolve them, so the SSR optimizer fails to pre-bundle the CJS vendor files (dev log: `Failed to resolve dependency: …/client.edge, present in ssr 'optimizeDeps.include'`) — and the raw CJS then gets inlined by the SSR module-runner → `module is not defined`. In a flat/hoisted `node_modules` (npm/yarn — what the upstream example uses) these hoist to top-level and resolve, which is why the example "just works". `standaloner`/`vike-server` were never the load-bearing piece.

### The fix (pure deps/Vite config — no runtime change)

In `playground-rsc/package.json`: declare the previously-transitive deps directly **and align peers so pnpm dedupes to the same realpath** the vendored package uses at runtime (else a forked instance pre-bundles a different `client.edge` than the one the SSR runtime imports):

- add `@vitejs/plugin-rsc: 0.5.1` + `react-streaming: ^0.4.12` (deps)
- bump `vite: ^7.3.0` (was `7.2.2`) and `@types/node: ^24` (was `^20`) → matches the `vite@7.3.1(@types/node@24)` peer key of the single `@vitejs/plugin-rsc@0.5.1` instance.

Verified: app-root and `vike-react-rsc` runtime resolve `@vitejs/plugin-rsc` to the **identical** `.pnpm` realpath. After this, `GET /` returns 200 with full server-rendered HTML + the `__rsc_payload` flight stream + the `"use client"` island reference, and `view('home', { greeting })` props arrive via `getPageContext().viewProps`.

### Downstream bug found + fixed (scanner): `+route.ts` client exclusion

vike-react-rsc's `serverComponentExclusionPlugin` strips **every** non-`node_modules`, non-`"use client"/"use server"` project module from the client bundle, replacing it with `export default {}`. RudderJS's generated `+route.ts` (`export default '/'`) is exactly such a module, so the client router read the route as `{}` → `[Wrong Usage] route … has an invalid type 'object'`. Fixed in `@rudderjs/vite` (`views-scanner.ts`): in RSC mode the route is pinned as an inlined `route` string in the per-view `+config.ts` (vike bakes it into the route table — no client module to strip) instead of a separate `+route.ts`. Leaf-dir detection made framework-agnostic (`+Page.*` or legacy `+route.ts`). Tests updated; all 89 green.

### Then-remaining blocker for the **action round-trip** — ✅ now RESOLVED in B0.1 (below)

> This subsection records the state at the end of the first B0 pass. All of it (plus two more blockers) was resolved the same day — see **B0.1 — Results** below, where the full render+action gate passes.

Same class of conflict, but **systemic**. The RudderJS framework-hook files emitted in the app — `+onCreatePageContext.ts`, `+data.ts`, `+onError.ts` — are physical `+*.ts` pointer modules that vike loads/runs **on the client**, and the RSC exclusion strips them too. Concretely: `+onCreatePageContext.ts` → `export default {}` on the client (named export gone) → vike's `execHook('onCreatePageContext')` throws during hydration. A genuine **upstream vike bug** masks it: in `loadPageConfigsLazyClientSideAndExecHook` the `onCreatePageContext` catch block does `err = err` (should be `err = err_`), so vike surfaces a generic `[Bug] You stumbled upon a Vike bug` with `err === undefined` instead of the real error. Result: the page server-renders fine, but the client island never finishes hydrating, so the `"use server"` action click issues no RPC.

vike-react-rsc avoids this for **its own** hooks by declaring them as `import:vike-react-rsc/__internal/…` strings (resolved from `node_modules`, which the exclusion skips). The clean fix mirrors that: in RSC mode the scanner should wire `onCreatePageContext`/`onError`/`headersResponse`/`data` via vike config **`import:` strings into `@rudderjs/vite`** rather than as physical app-level `+*.ts` re-export stubs. That's a framework-hook-wiring redesign in `@rudderjs/vite` — its own phase (call it **B0.1**), not a Vite-config tweak. Also worth filing the vike `err = err` bug upstream.

### Disk state after B0 (uncommitted, on `feat/rsc-phase4-playground`)

- `playground-rsc/package.json` + `pnpm-lock.yaml` — the dependency/peer fix above.
- `playground-rsc/pages/__view/home/` — regenerated: `+config.ts` now carries `route: '/'`; `+route.ts` removed.
- `packages/vite/src/views-scanner.ts` + `views-scanner.test.ts` — RSC route-via-config branch + leaf detection.

### Updated recommendation

B1 (re-platform onto `vike-server`) is **not** needed — the environment is fixed in config. The path to a fully-working RSC dev (render **and** actions) is the small-ish **B0.1** hook-wiring change above, not a server re-platform. Reassess the go/no-go with this much-lowered cost in mind.

---

## B0.1 — Results (2026-05-24): FULL gate met ✅ (render **and** `"use server"` actions work in dev)

**B0's gate is now fully met.** `playground-rsc` dev server-renders the RSC view (HTML + `__rsc_payload`) **and** the `"use server"` action round-trips: a browser test clicks the island's button, `POST /_rsc` returns **200**, and the count increments **0 → 1 → 2** with zero page errors. No re-platform of `@rudderjs/server-hono` was needed; the `+server.ts` → `app.fetch` integration is intact, and the vike-react playgrounds are unaffected (verified). Three blockers were resolved beyond the environment fix — framework-hook exclusion, dual-vike, and re-entrant `renderPageServer`.

### Fixed: framework-hook client exclusion (the B0.1 hook-wiring change)

Same root cause as `+route.ts`. The RudderJS framework-hook files emitted in the app — `+onCreatePageContext.ts` (a **global** hook vike runs on the client too), `+onError.ts`, `+headersResponse.ts` — are physical project modules the RSC exclusion strips to `export default {}`. On the client, `execHook('onCreatePageContext')` then threw during hydration, which a **vike core bug masks**: in `loadPageConfigsLazyClientSideAndExecHook` the `onCreatePageContext` catch block does `err = err` (should be `err = err_`), surfacing a generic `[Bug] … err === undefined` instead of the real error. Fix (in `@rudderjs/vite` `views-scanner.ts`): for RSC, wire these hooks as vike `import:@rudderjs/vite/hooks/…` strings in the generated view-root `+config.ts` (resolved from `node_modules`, which the exclusion skips — same mechanism vike-react-rsc uses for its own hooks) and stop emitting the physical `pages/+<hook>.ts` stubs (removing any stale auto-generated ones). After this the island hydrates and the click dispatches the action.

### Fixed: dual vike instances (the action's server-side crash)

With hydration working, the `POST /_rsc` action hit a **server-side** `[Bug]` because **two vike instances were loaded** — `vike@0.4.257` (the patched app instance) and `vike@0.4.259`. Source: `@vikejs/hono` declares `vike` as a **peer**; `@rudderjs/server-hono` declares no vike, so the peer auto-installed to the highest in range (`0.4.259`), independent of the app's pinned `0.4.257`. The fork was widened by an `@types/node` split (20 vs 24) cascading through `vite → vike → @vitejs/plugin-rsc` and creating duplicate peer-keyed instances. Fixes (workspace-only):
- Root `pnpm.overrides`: `"vike": "0.4.257"` (collapse to the single patched version) and `"@types/node": "20.19.35"` (kill the peer-split that forked vite/vike/plugin-rsc — this also makes the original B0 `@types/node@24` bump unnecessary, so playground-rsc is back on `^20`).
- `@rudderjs/server-hono` gets `vike` as a **devDependency** so `@vikejs/hono`'s peer resolves from there instead of auto-installing `0.4.259` (devDep ⇒ no change to the published peer contract).

Verified: single `vike@0.4.257` + single `@vitejs/plugin-rsc@0.5.1` + single `@types/node`; app and `@vikejs/hono` resolve the same vike realpath; full monorepo `typecheck` green (96/96), scanner tests 89/89.

### Fixed: re-entrant `renderPageServer` → mount config middlewares as direct routes

After the single-vike fix the `POST /_rsc` action still 500'd because **`renderPageServer` ran twice for `/_rsc`**: the `@vikejs/hono` catch-all called `renderPageServer` (call A) → `renderPageServerEntryWithMiddlewares` dispatched vike-react-rsc's `rscMiddleware` → which called `renderPageServer` again (call B). vike's dev logger then asserted `requestId === requestIdFromStore` in `getTagSource` (`loggerDev.js:146`): call B's `pageContext._requestId` ≠ the AsyncLocalStorage id from call A → `[Bug]`, response aborted. (`logRuntimeInfo` is dev-only — undefined in production — so this was a dev-only crash; `GET /` was unaffected because nothing re-renders it.)

This was the Option-A routing assumption resurfacing: Phase 3 found `renderPageServer` dispatches config middlewares internally, but for `/_rsc` that internal dispatch is a **double** `renderPageServer`. The upstream example avoids it because `vike-server` `apply()`s the universal middlewares as direct routes (`/_rsc` hits `rscMiddleware` once).

**Fix (in `@rudderjs/server-hono`, safe for the default path):** `@vikejs/hono`'s `vike(app, middlewares=[])` already does `apply(app, [...middlewares, vikeMiddleware])`, applying `middlewares` as routes *ahead* of the catch-all. So `createFetchHandler` now reads vike's config middlewares from `getGlobalContext().config.middleware` (best-effort, try/catch) and passes them: `vike(app, configMiddlewares)`. `/_rsc` becomes a direct route → single `renderPageServer` → no re-entrancy → no dev-logger crash. **This is a no-op for non-RSC renderers** — they have no config middlewares, and `vike(app, [])` is byte-identical to `vike(app)` — verified: the vike-react `playground/` boots (23 providers) and renders `GET /` → 200 with zero vike `[Bug]`s; `@rudderjs/server-hono` tests 92/92. No separate adapter needed.

Two upstream vike bugs are still worth filing: the `err = err` typo in `loadPageConfigsLazyClientSideAndExecHook`, and the `getTagSource` assert under re-entrant `renderPageServer` (it shouldn't `[Bug]` even if a renderer re-enters).

### Still open: production build (B2)

Dev render + actions work. The **production build** (`vike build`) still fails at `@brillout/vite-plugin-server-entry` ("cannot find server entry") — unchanged, see B2. The dev-logger crash above was dev-only, so the action would also work in a fixed prod build.

### Disk state after B0.1 (uncommitted, on `feat/rsc-phase4-playground`)

- Root `package.json` — `pnpm.overrides` += `vike` + `@types/node`; `pnpm-lock.yaml`.
- `packages/server-hono/package.json` — `vike` devDependency; `src/index.ts` — pass `config.middleware` to `vike(app, …)`.
- `packages/vite/src/views-scanner.ts` (+test) — RSC route-via-config (B0) + RSC hook import-strings / stub removal (B0.1).
- `playground-rsc/package.json` — plugin-rsc + react-streaming deps, vite `^7.3.0`, `@types/node` back to `^20`.
- `playground-rsc/pages/__view/` — regenerated; `pages/+onCreatePageContext.ts` / `+onError.ts` / `+headersResponse.ts` removed (hooks now in `__view/+config.ts`).

**Changesets needed when this becomes a PR:** `@rudderjs/server-hono` (config-middleware mounting — minor `feat`) and `@rudderjs/vite` (RSC route + hook wiring — minor `feat`). `vike-react-rsc` is private (no changeset).

---

## What already exists (on branch `feat/rsc-phase4-playground`, uncommitted)

A future session does **not** start from zero:

| Artifact | State |
|---|---|
| `patches/vike@0.4.257.patch` | **Keep.** Fixes a real vike dev `optimizeDeps.addEntry` `[Bug]` — its over-strict `assert(isVirtualFileId \|\| isFilePathAbsoluteFilesystem)` throws on an extension `client` config that resolves to a bare specifier (vike's own code comment admits this path is unhandled). Patch makes it skip gracefully. Verified to unblock dev startup. Applied via root `pnpm.patchedDependencies`. Safe for vike-react apps (they never produce such entries). |
| `packages/vike-react-rsc/` | Vendored MIT fork of `nitedani/vike-react-rsc@094054c` (npm only has a 2024 `0.0.0` stub). Private/unpublished, `workspace:*`, builds via `tsdown`. `VENDORED.md` + `LICENSE` document provenance + local changes. |
| Root `pnpm.overrides` `tsdown>rolldown: 1.0.0-beta.8` | Needed — tsdown@0.6.10 breaks on rolldown 1.0.2. |
| `playground-rsc/` | Full minimal app: one RSC server-component view (`app/Views/Home.tsx`), one `"use server"` action (`app/Actions/counter.ts`), one client island (`app/Components/CounterClient.tsx`), controller `view('home', props)` route, `pages/+config.ts` `extends: [vikeReactRsc]`, `+server.ts`. |
| Phase 2 scanner (`@rudderjs/vite`) — PR #637 | **Verified at runtime**: detects `vike-react-rsc`, generates a server-component `+Page.tsx` using `getPageContext()` from `vike-react-rsc/pageContext`. |
| Phase 3 server-hono `/_rsc` pass-through — PR #638 | **Verified at runtime**: the controller→`view()`→`renderPageServer`→RSC-entry flow executes. |

Whether to commit or shelve these is a separate decision (see "Disposition" below).

---

## The precise blocker

Request flow that **works** today (with the vike patch):

```
GET / → server-hono app.fetch → vike(app) catch-all → renderPageServer
      → reads config.middleware (incl. vike-react-rsc /_rsc) → loads the RSC page entry
```

Then it 500s here:

```
vike-react-rsc/dist/runtime/ssr.js
  → @vitejs/plugin-rsc/dist/react/ssr.js
    → @vitejs/plugin-rsc/dist/vendor/react-server-dom/client.edge.js   ← ReferenceError: module is not defined
```

`client.edge.js` is **pure CJS** (`'use strict'; module.exports = require('./cjs/…')`). It is `noExternal`'d (so Vite processes it for RSC), and Vite's SSR `ModuleRunner.runInlinedModule` executes it as ESM, where `module` is undefined. `@vitejs/plugin-rsc` normally configures its Vite **environments** so these vendor files are handled (pre-bundled / externalized correctly) — and that configuration is what the `standaloner` + `vike-server`/`vike-cloudflare` toolchain supplies. Our `@vikejs/hono` + `@rudderjs/vite` + `+server.ts` setup does not.

Confirmed **not** the cause: `@rudderjs/vite`'s `config()` (it sets `ssr.external`/`noExternal`/`optimizeDeps.exclude=['@rudderjs/view']`, none touching plugin-rsc); plugin order; vite/plugin-rsc/rolldown versions.

---

## Option B — work breakdown

Tackle in order; **Phase B0 may make the rest unnecessary**, so do it first.

### B0 — Separate the *environment* fix from the *runtime* server (cheapest, do first)

**Hypothesis:** the CJS/ESM failure is a Vite **build/plugin-time** problem (RSC environment config), independent of the runtime server (`app.fetch`). If so, we can fix it with Vite config + the `standaloner`/environment plugin **without** re-platforming the server runtime — keeping `+server.ts` → `app.fetch`.

Tasks:
- Add `standaloner` (and whatever Vite-environment plugin `vike-server`/`vike-cloudflare` contribute) to `playground-rsc/vite.config.ts`, matching the example.
- Determine the minimal Vite **environments** config (`environments.{rsc,ssr}.optimizeDeps` / externalization) that makes `@vitejs/plugin-rsc`'s vendor CJS load. Try the official fix at https://vike.dev/broken-npm-package first.
- Keep `+server.ts` → `app.fetch` as-is.

**Gate:** `playground-rsc` dev renders the RSC view (server-rendered HTML + `__rsc_payload`) and the `"use server"` action round-trips. **If B0 passes, Option B is essentially done** and B1/B2 are unnecessary.

### B1 — Re-platform `@rudderjs/server-hono` onto `vike-server` (only if B0 fails)

Replace `@vikejs/hono`'s `vike(app)` + the custom fetch handler with `vike-server`'s `apply()` + serve, **preserving** every existing behavior:
- `view()` → `ViewResponse.toResponse()` → `renderPage`
- the `/index.pageContext.json` SPA-nav rewrite (controller-view matching)
- CORS, the Ignition dev error page, eager `vike/server` prewarm
- `req.ip` extraction, WebSocket upgrade patching, multi-value `Set-Cookie` handling
- middleware groups (web/api), exception rendering

**Strongly prefer** doing this as a **separate adapter** (e.g. `@rudderjs/server-hono`'s RSC variant or a sibling package) selected by the app, so the `@vikejs/hono` path that `playground` / `playground-web` / every shipped app uses is **untouched**. Re-platforming the shared adapter in place risks regressions across the entire framework.

**Gate:** all `@rudderjs/server-hono` tests green (94 today); `playground` + `playground-web` (vike-react) unaffected; `playground-rsc` renders + action round-trips.

### B2 — Reconcile + harden

- Decide the `view()` ↔ server-component contract (doc §4 of the 2026-05-23 plan — controller props via `getPageContext()` vs self-fetching; `"use server"` actions plain vs DI/form-request integrated). Recommend plain functions + props-through in v1.
- Version-skew strategy: `playground-rsc` currently needs vite `7.2.2` / plugin-rsc `0.5.1` pinned (vs the monorepo's `7.3.x`). Decide whether to hold the RSC app back or push the whole monorepo.
- Production build (`vike build`) — currently fails at `@brillout/vite-plugin-server-entry` ("cannot find server entry"); needs the `standaloner`/server-entry setup. Same root as B0.

---

## Risks

- **Blast radius.** `@rudderjs/server-hono` is a dependency of every app. B1 in-place is high-risk; the separate-adapter approach is strongly preferred.
- **Dependency maturity.** Adds `standaloner` (young) + `vike-server`/`vike-cloudflare` on top of the already-vendored `vike-react-rsc` (single-maintainer, unstable `__internal` seam). Multiple young deps for one experimental feature.
- **Version skew.** RSC app pinned to older vite/plugin-rsc than the rest of the monorepo; ongoing maintenance cost.
- **Patch maintenance.** `patches/vike@0.4.257.patch` must be re-validated on every vike bump (and ideally upstreamed — file a vike issue for the `addEntry` `[Bug]`).
- **Cascading coupling.** Each Phase-4 obstacle revealed another (npm-unpublished → vendoring → rolldown → deps → config import strings → vike optimizeDeps → CJS/ESM env). B0/B1 may surface more.

## Open questions

1. **Is the environment fix separable from the server runtime?** (B0.) If yes, Option B collapses to a Vite-config change — by far the best outcome.
2. Separate RSC adapter package vs modifying `@rudderjs/server-hono`?
3. Is `standaloner` needed in **dev**, or only for production bundling?
4. Should we instead wait for `vike-react-rsc` to publish a vike-0.4.257+-compatible release and drop the vendoring + vike patch entirely?

## Kill criteria

If **B0 fails** (no Vite-config-only fix) **and** there's no appetite for a separate vike-server-based adapter (B1) — stop. The cost is no longer proportionate to an opt-in, experimental renderer, and the cleaner path is to wait for upstream (`vike-react-rsc` to support current vike + publish to npm).

## Disposition of the uncommitted Phase-4 work

Decide alongside the go/no-go:
- **Shelve** (recommended interim): keep the branch; commit nothing; this doc + memory capture the state.
- **Commit `patches/vike@0.4.257.patch` only**: it's an independently-useful, low-risk fix (file the upstream vike issue alongside).
- **Commit playground-rsc + vendored package as experimental WIP**: only with a clear "dev pending Option B" label; not recommended while it can't run.

## References

- Continuation of: `docs/plans/2026-05-23-vike-react-rsc-integration.md`
- Upstream example: `nitedani/vike-react-rsc` `examples/full` (`react()`, `vike()`, `compiled()`, `standaloner()`; `extends: [vikeCloudflare, vikeReactRsc]`; `server: { entry }`).
- Error site: `@vitejs/plugin-rsc/dist/vendor/react-server-dom/client.edge.js` (CJS) via `vike-react-rsc/dist/runtime/ssr.js`.
- vike CJS/ESM guidance: https://vike.dev/broken-npm-package
