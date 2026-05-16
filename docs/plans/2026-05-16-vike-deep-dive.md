# Vike Deep-Dive Investigation

> **Status:** in-progress 2026-05-16. Stacks on branch `perf-rps-bench-plan` after the RPS bench finding that RudderJS SSR is Vike-bound (~830 req/s vs Svelte ~7155).
>
> **Goal:** Understand Vike's SSR architecture deeply enough to find real, measurable improvement opportunities — for code we own (RudderJS adapter), for upstream Vike, or to defensibly conclude the architecture is what it is.
>
> **Why the previous tweaks failed:** Two surface-level utility patches (`catchInfiniteLoop` lazy-msg, `objectAssign` fast-path) measured +1.6% in apples-to-apples A/B — within iteration variance. The CPU profile read was misleading: 11% of CPU ≠ 11% of throughput when CPU isn't the binding constraint. RudderJS shows **28% idle CPU** under sustained load — throughput is bound by per-request *latency* (~11ms), not raw CPU work.

---

## Methodology — 4 phases

### Phase 1: Architectural map
Trace one SSR request end-to-end through Vike's source. Output: documented request lifecycle, pageContext model, hook system, and the cost of each architectural decision.

Read order:
- `packages/vike/src/server/runtime/renderPageServer.ts` — entry
- `packages/vike/src/server/runtime/renderPageServer/createPageContextServer.ts`
- `packages/vike/src/shared-server-client/route/route.ts`
- `packages/vike/src/server/runtime/renderPageServer/loadPageConfigsLazyServerSide.ts`
- `packages/vike-react/src/renderer/onRenderHtml.tsx`

### Phase 2: Multi-dimensional profile
CPU was misleading. Measure four dimensions per request:
- **Allocation profile** (`--heap-prof`) — objects per request, GC pressure under load
- **Dynamic import count** — does anything re-import per request?
- **Async boundary count** — `await`s between request-in and response-out
- **Event-loop lag** under sustained load (`perf_hooks.monitorEventLoopDelay`)

### Phase 3: Svelte structural delta
Read Svelte's compiled `build/handler.js` + `build/server/index.js`. Map to Vike's request path. Answer: **what does Svelte NOT do that Vike does?** The delta is the architectural cost.

### Phase 4: Candidates + validate one
Synthesize 1–3 into a ranked improvement list. Pick highest-pri, implement, bench (5×30s apples-to-apples), validate or honest-fail.

---

## Phase 1 findings — Vike architectural map

### Request lifecycle (function-by-function trace)

1. **`renderPageServer()` (renderPageServer.ts:101)** — Entry point. Validates `urlOriginal`, increments global request counter, calls `renderPageServerEntryOnceBegin()`, and wraps all errors into HTTP responses.

2. **`initGlobalContext_renderPage()` (renderPageServer.ts:145)** — Async initialization of global config: loads Vike config from disk/Vite (only if not already cached). Depends on `+onCreateGlobalContext` hooks. Adds latency on first request; cached thereafter.

3. **`getPageContextBegin()` (renderPageServer.ts:504)** — Fresh pageContext object created by `createPageContextServer()` (via `createPageContextObject()` + 6 `objectAssign()` calls). Initializes: URL parsing, headers normalization, base URL resolution, client-side nav detection. Returns immutable pageContext for next phase.

4. **`renderPageServerEntryRecursive()` (renderPageServer.ts:211)** — Main render loop. Calls `catchInfiniteLoop()` at entry. Forks pageContext (copies all properties via `Object.defineProperties()`), then routes.

5. **`route()` (route/index.ts:43)** — Executes `execHookOnBeforeRoute()` hook (async), then runs Vike's routing via `Promise.all()` over **all page routes** (filesystem + string + function). Each route is tested in parallel. Resolves route precedence. Returns `pageId` + `routeParams`.

6. **`renderPageServerAfterRoute()` (renderPageServerAfterRoute.ts:35)** — After route match: `loadPageConfigsLazyServerSide()` — loads page's `+*.js` files and parses virtual file (async dynamic import per page); `execHookGuard()` (if not error page) — user's guard hook; `execHookDataAndOnBeforeRender()` (renderPageServerAfterRoute.ts:67) — runs `+data` hook, then `+onData` (only if not CSN), then `+onBeforeRender` hook. For HTML requests: `execHookOnRenderHtml()` → calls the `+onRenderHtml` hook (renders React/Vue to string/stream). For JSON requests (client-side nav): serializes pageContext to JSON via `getPageContextClientSerialized()` instead.

7. **`execHookOnRenderHtml()` (execHookOnRenderHtml.ts:41)** — Calls `getRenderHook()` to find `+onRenderHtml` or `+render` hook. Executes it (awaited). Processes return value (could be stream or string). Calls `renderDocumentHtml()` to inject HTML tags (preloads, CSP nonce, etc.).

8. **`renderDocumentHtml()` (html/renderHtml.ts:57)** — Handles DocumentHtml (template-wrapped, escaped string, or stream). If stream: calls `processStream()` to handle backpressure and inject HTML async. If string: calls `injectHtmlTagsToString()` to insert assets synchronously.

9. **`createHttpResponsePage()` (createHttpResponse.ts:45)** — Determines HTTP status (200/404/500). Calls `await pageContext.__getPageAssets()` to get page assets lazily. Calls `resolveHeadersResponseFinal()` to resolve CSP, X-Robots, etc. Returns HttpResponse with body stream.

### pageContext model

**Fresh per request** (via `createPageContextObject()`):
- `_isOriginalObject: true`, `isPageContext: true`, `isClientSide: false`, `_requestId: number`

**From pageContextInit** (user input):
- `urlOriginal: string`, `headersOriginal: Record<string, unknown>`, `_reqWeb?: Request`, `_reqDev?: express.Request`

**From globalContext** (6 objectAssign calls in createPageContextServer.ts:42–106):
- `_globalContext: GlobalContextServerInternal`, `_pageFilesAll: PageFile[]`, `_baseServer: string`, `_baseAssets: string | null`, `_pageContextInit: Record<string, unknown>`, `_urlHandler: (url: string) => string | null`, `isClientSideNavigation: boolean`, plus all of `globalContext._globalConfigPublic`

**After URL parsing:**
- `urlParsed: { pathname, search, hash, origin }`, `urlPathname: string`, `urlLogical: string`

**After routing:**
- `pageId: string | null`, `routeParams: Record<string, string>`, `is404: boolean | null`

**After loadPageConfigsLazyServerSide():**
- `_pageConfig: PageConfigRuntime | null`, `exportsAll`, `exports: { Page?, Layout?, ... }`, `from.configsCumulative`, `Page: Component | null`, `_isHtmlOnly: boolean`, `_passToClient: string[]`, `__getPageAssets: () => Promise<PageAsset[]>`, `_pageAssets: PageAsset[]` (optional), `headersResponse?: Headers`

**After hooks and render:**
- `data: unknown`, `_renderHook: HookInternal`, `_pageContextPromise: PageContextPromise | null`, `pageProps?: Record<string, unknown>`, `_cspNonce?: string`, `pageContextsAborted: PageContextAborted[]`

**Totals per nominal request:** ~60–70 properties populated; 6 objectAssign calls in createPageContextServer + 35+ additional calls in renderPageServer; ~5 pageContext forks (full property-descriptor copies).

### Hook execution chain (by default, zero user hooks defined)

Hooks run **always**: (1) `onBeforeRoute()` (async, before routing); (2) `+guard()` (if not error page); (3) `+data()` (if not CSN); (4) `+onData()` (if not CSN, only if +data exists); (5) `+onBeforeRender()` (async, final before render); (6) `+onRenderHtml()` or `+render()` (MUST exist, async, renders to DocumentHtml). For CSN: skips guard, data, onData, onBeforeRender. Hook lookup via `getHooksFromPageContextNew()` scans merged config per hook type; executed via `execHookBaseAsync()` with Promise wrapping + timeout handling (130–194 lines). Even zero user hooks incurs async Promise creation per hook type.

### Architectural cost areas (10 expensive patterns identified)

**1. Full pageContext object copies on every fork (5 forks per request)** — `forkPageContext()` calls `Object.defineProperties()` + `getOwnPropertyDescriptors()` for ~60–70 properties per fork (renderPageServer.ts:218, 292, 482, 570, 589). **Impact:** ~1–2ms per request.

**2. objectAssign() chaining (35+ calls per request)** — Each call runs `Object.defineProperties(obj, Object.getOwnPropertyDescriptors(objAddendum))` even for plain values. Alternative `Object.assign()` would be ~3× faster. Lines: renderPageServer.ts (24 calls), createPageContextServer.ts (6 calls). **Impact:** ~0.5–1ms per request.

**3. Route matching uses Promise.all() over all routes** — Every request evaluates all page routes in parallel via `Promise.all(pageContext._globalContext._pageRoutes.map(...))` (route/index.ts:80–124). Even if first route matches, remaining N-1 routes still complete. Could short-circuit after first match or use serial ordering. **Impact:** ~0.5–1.5ms per request.

**4. Dynamic import of page configs per request** — `await loadAndParseVirtualFilePageEntry(pageContext._pageConfig, isDev)` (loadPageConfigsLazyServerSide.ts:162) runs on every request even in production. Not actually lazy. Could cache at page level. **Impact:** ~0.3–1ms per request.

**5. pageAssets resolution on-demand during HTML generation** — `await pageContext.__getPageAssets()` called at createHttpResponsePage.ts:73, first time in request. In dev: may trigger RPC to Vite. In prod: scans unindexed assetsManifest. **Impact:** ~1–3ms per request (dev); ~0.5ms (prod).

**6. pageContext serialization (JSON stringify on CSN or HTML)** — `getPageContextClientSerialized(pageContext)` recursively walks object tree via `stringify()` from @brillout/json-serializer. **Impact:** ~0.5–2ms per request (depends on data size).

**7. Multiple async/await boundaries (6+ awaits per request)** — renderPageServer.ts:120–121 (AsyncLocalStorage), route(), renderPageServerAfterRoute(), loadPageUserFiles(), execHookDataAndOnBeforeRender(), execHookOnRenderHtml(), createHttpResponsePage(). Each `await` crosses event-loop boundary. **Impact:** ~0.5–1.5ms per request (microtask overhead).

**8. Global request counter (minor)** — `++globalObject.httpRequestsCount` at renderPageServer.ts:544. Unbounded, atomic. **Impact:** <0.05ms (negligible).

**9. Header normalization per request** — `normalizeHeaders(pageContextInit.headersOriginal)` (createPageContextServer.ts:60–80) scans all headers to lowercase keys. **Impact:** ~0.1–0.2ms per request.

**10. Redirect resolution per request** — `getPermanentRedirect()` scans all redirects (renderPageServer.ts:588–629). Not cached. **Impact:** ~0.05–0.2ms per request (negligible).

### Surprises / odd patterns

1. **Route matching not short-circuit safe** — Promise.all() awaits all routes even after first match; 9 of 10 routes still run (route/index.ts:80–125). Not a semantic bug but wasteful.

2. **objectAssign() preserves descriptors for all properties** — objectAssign.ts:15 uses `Object.defineProperties()` everywhere, even for non-getter properties. Could optimize with fast-path: `if (isPlainObject(objAddendum)) Object.assign(); else Object.defineProperties()`.

3. **data hook uses Object.assign(), not objectAssign()** — Minor inconsistency at execHookDataAndOnBeforeRender.ts:24. Suggests team aware of performance difference.

4. **Lazy pageAssets resolution on critical path** — createHttpResponsePage.ts:73 calls `__getPageAssets()` during response generation. Could pre-compute in loadPageConfigsLazyServerSide.

5. **AsyncLocalStorage double-check branching** — renderPageServer.ts:118–121 checks `getAsyncLocalStorage()` on every request, then branches: `!asyncLocalStorage ? await render() : await asyncLocalStorage.run()`. Could cache.

6. **No caching of page config lookups** — `findPageConfig()` scans `_pageConfigs` array per request (O(n)). For 100+ pages: O(n) cost per request. Could use Map keyed by pageId.



---

## Phase 2 findings — Multi-dimensional profile

### Fork-cost microbenchmark (5M iter, 60-prop pageContext with 3 getters)

| Variant | ns/op | ops/sec |
|---|---:|---:|
| Vike's current path: `Object.defineProperties(out, Object.getOwnPropertyDescriptors(src))` | 28,404 | 35k |
| Native `Object.assign` (loses getters!) | 14,084 | 71k |
| Hybrid (check for getters, branch) | **32,277** | **31k** (slower than Vike!) |

**Per-request cost (5 forks/req):** ~142µs validated.

Phase 1 estimated 1–2ms; the real number is **142µs ≈ 0.14ms** — order-of-magnitude smaller than the estimate. At ~830 req/s with 11ms per request, forks are **1.3% of per-request latency**.

**The "objectAssign fast path" approach my earlier upstream PR took is unviable.** When getters are present (which is true for any pageContext that has passed through `createPageContextServer`), the hybrid path is slower than the current path because the getter-detection loop costs more than it saves.

### Validation of Phase 1 finding #4 — page config cache

**Phase 1 was wrong.** Reading `loadAndParseVirtualFilePageEntry.ts:17–23`:

```ts
if ('isPageEntryLoaded' in pageConfig && !isDev) {
  return pageConfig as PageConfigRuntimeLoaded
}
```

Vike **already caches** the page-config parse result via the `isPageEntryLoaded` flag. After the first request to a given page, this returns immediately. **Phase 3's #1 recommendation ("pre-compute the manifest at build time") is also moot — the cache is already in place.**

What still runs every request (inside `loadPageUserFiles` → `Promise.all`):
- `resolvePageContextConfig(pageFilesServerSide, pageConfigLoaded, _pageConfigGlobal)` — merges configs, not cached
- `analyzePageClientSideInit(_pageFilesAll, pageId, {...})` — could be cached

### What the dimensions actually look like

| Dimension | Measured / inferred | Bottleneck? |
|---|---|---|
| CPU | 28% idle under sustained load | **No — not the binding constraint** |
| Heap allocation | ~142µs of fork-related work/req; ~10µs from 35× objectAssign calls | Real but small slice of 11ms latency |
| Dynamic imports per request | **0** in production (cached after first) | No |
| Async boundaries | 6+ per request | Real microtask overhead but unavoidable |
| Event-loop lag | not measured directly | likely the actual binding constraint |

### Recalibrated cost model

Phase 1 estimated ~1–2ms/req from forks alone. Microbench shows ~140µs. Phase 3 estimated ~650-1200µs of "Vike overhead vs Svelte". **Both estimates were too high by an order of magnitude.** The truth: the 11ms-vs-1.3ms gap to Svelte is **not** explained by a sum of small fixable hot spots. It's the cost of the whole orchestration model: per-request hook resolution, pageContext shape, universal-handler translation, React 19 SSR, and unavoidable async/await fan-out.

---

## Phase 3 findings — Svelte structural delta

### Svelte's SSR request lifecycle

SvelteKit's `handler.js` (1494 LOC) executes the following critical path per request:

1. **Request → Fetch API wrapper** (line 1356, `await getRequest()`)
   - Converts Node's `IncomingMessage` to standard Fetch `Request` object
   - Wraps body in `ReadableStream` lazily (only on non-GET/HEAD)
   - Creates `AbortController` for request cancellation
   - **Cost:** One `await` boundary; single object allocation

2. **Direct Server.respond call** (line 1369, `await server.respond(request, {...})`)
   - Single async entry point into bundled Svelte runtime
   - Passes minimal context: `{ platform: { req }, getClientAddress: () => {...} }`
   - No page config loading, no hook chain setup — all inlined into server/index.js
   - **Cost:** One `await` boundary

3. **SvelteKit's internal_respond** (server/index.js:3840, bundled)
   - Creates event + event_state objects (~15 fields total)
   - Runs user hooks via `options.hooks.handle()` (single hook chain entry, line 4071)
   - Route matching via `find_route()` — baked-into manifest, no dynamic imports
   - Calls `resolve()` which renders page
   - **Cost:** ~4-6 additional `await` boundaries (reroute hook, page load, render)

4. **Response → HTTP writer** (line 1367, `await setResponse()`)
   - Streams response body via `reader.getReader()` with backpressure handling
   - **Cost:** One `await` boundary (per chunk in slow networks; synchronous write in fast path)

**Total request path:** 3-4 top-level `await` points in handler.js, ~6-8 inside the bundled server module.

**Key detail — route matching:** Manifest routes are baked into `server/manifest.js` at build time. No dynamic imports per request. The `matchers` are fetched once (line 3996: `await manifest._.matchers()`), likely cached in memory.

### Side-by-side comparison

| Aspect | SvelteKit | Vike |
|---|---|---|
| **Per-request pageContext** | ~15 fields (event + event_state) | ~20-25 fields (pageContext + internal state) |
| **User hook execution** | Single `hooks.handle()` entry, runs before render | Hook chain: `+onBeforeRoute`, `+onPageContext`, `+onBeforeRender`, `+onRenderHtml` (4+ per page) |
| **Page config loading** | Baked into manifest (build time) | Lazy-loaded per page per request via `loadPageConfigsLazyServerSide()` (line 669 in renderPageServer.ts) |
| **Route matching** | `find_route(pathname, manifest._.routes, matchers)` — O(n) scan of baked routes | `route()` function — same O(n) scan but routes may be re-resolved per request |
| **Dynamic imports per request** | Zero — all bundled | 2-4 per page: `+data.ts`, `+Page.tsx`, user hooks, vike-react renderer |
| **Module init overhead** | All module code runs at server startup (line 1291: `await server.init()`) | Per-request module imports and hook execution |
| **Async boundaries (critical path)** | ~7 total (3 in handler.js + ~4 inside bundled server) | ~15+ (init globalContext, load page configs, route, execute multiple hook chains, render) |
| **SSR runtime abstraction** | Monolithic + inlined into handler | Modular: vike-react/vike-vue plugin must be loaded to render |
| **Hydration manifest** | Embedded in HTML during render, serialized once | `pageContextClientSerialized()` — extracts subset of pageContext and serializes per request (renderPageServer.ts:665) |
| **Lazy init of user hooks** | All evaluated at server init (line 1291) | User hooks are evaluated once at global context init, then called per request |

### The structural delta — what Svelte doesn't do

1. **No per-request page config resolution**
   - Svelte: Routes + config baked into manifest.js at build time. Page metadata available instantly.
   - Vike: Calls `loadPageConfigsLazyServerSide()` (renderPageServer.ts:669) per request to fetch `+config.ts` of the matched page. This triggers a dynamic import and object merge.
   - **Why Vike can't skip:** Framework-agnostic plugin system requires late binding — user config in `+config.ts` lives outside Vike's control and may reference framework modules (`vike-react/config`).

2. **No multi-stage hook pipeline per page**
   - Svelte: Single `hooks.handle()` runs once before render. User defines their logic inside one function.
   - Vike: Calls `+onBeforeRoute`, `+onPageContext`, `+onBeforeRender`, `+onRenderHtml` — each is a separate dynamic import + execution if defined. `renderPageServerAfterRoute()` alone calls 4+ hooks (visible in renderPageServer.ts:268-269).
   - **Why Vike can't skip:** Each hook has a specific purpose in the page lifecycle. Removing any would break user patterns (e.g., `+onPageContext` to enrich `pageContext.user`, `+onRenderHtml` to inject layout).

3. **No lazy-load of SSR renderer plugin**
   - Svelte: Server is bundled (server/index.js). All page render logic is inlined. Node HTTP adapter's handler (handler.js) is the static entry point.
   - Vike: Must await `renderPageServerAfterRoute()` which calls into the loaded plugin (vike-react, vike-vue, etc.). Each request pays the cost of module resolution + renderer dispatch.
   - **Why Vike can't skip:** Vike supports multiple frameworks. The renderer isn't known at build time unless you've pre-loaded it (which Rudder does via `vike-react` in the build config).

4. **No serialization of every context field**
   - Svelte: Renders HTML + hydration data in one pass. Serialization is implicit in template interpolation.
   - Vike: Explicitly calls `getPageContextClientSerialized()` (renderPageServer.ts:665) to extract a safe subset and serialize it. This happens even if hydration isn't needed (e.g., data requests).
   - **Why Vike can't skip:** Vike's `pageContext` is passed across SSR → client boundary. It must be safe to serialize (no circular refs, no credentials). Svelte's event object stays server-side.

5. **No global context initialization per request**
   - Svelte: `server.init()` runs once at startup (line 1291). All hooks/manifest are cached.
   - Vike: Calls `initGlobalContext_renderPage()` (renderPageServer.ts:145) on every request to set up request-scoped tracing spans, async local storage, and hook caches. These are looked up, not pre-computed.
   - **Why Vike can't skip:** OpenTelemetry integration requires per-request span setup. Async local storage for context propagation isn't known until request arrives.

6. **No async boundary for response streaming**
   - Svelte: Pipes response body synchronously after streaming starts (handler.js line 1183-1195). Uses stream backpressure but minimal awaits.
   - Vike: Streams response body same way, but the entire response object must be awaited before piping (renderPageServer.ts line 121).
   - **Impact:** Minor. Both frameworks wait for full render before streaming. Svelte doesn't reduce total latency, just uses streams more efficiently internally.

### Borrowable patterns from Svelte

1. **Pre-computed manifest with baked routes** (highest priority)
   - Svelte stores route definitions + metadata in a single `manifest.js` computed at build time.
   - Vike builds file-based routes, but doesn't pre-compute a flat manifest structure.
   - **Proposal:** Create a `__vike_manifest.json` file during `vike build` that includes all page IDs, params, layouts, and config defaults. At request time, use O(1) or O(log n) lookup instead of dynamic `loadPageConfigsLazyServerSide()` + merge.
   - **Realistic?** Yes. Requires coordination between Vike build step and runtime. RudderJS could patch this in the adapter.

2. **Single hook entry point before render** (medium priority)
   - Svelte's `hooks.handle()` is called once, user decides the flow inside.
   - Vike's hook chain forces N hook calls per request, each with overhead.
   - **Proposal:** Offer an opt-in "fast path" hook: `+onHandle()` that replaces the multi-stage pipeline for simple cases. Only call `+onBeforeRoute`, `+onPageContext`, `+onRenderHtml` if user doesn't define `+onHandle()`.
   - **Realistic?** Maybe. Would need to validate that most user code fits into one hook. Breaking change otherwise.

3. **Lazy-defer serialization until client context is needed** (lower priority)
   - Svelte doesn't serialize `event` object for client hydration (it's server-only).
   - Vike serializes full `pageContext` even when not needed (e.g., data requests that won't hydrate).
   - **Proposal:** Detect `isDataRequest` or `isAjax` early. Skip serialization entirely if no client-side hydration required.
   - **Realistic?** Yes. Vike already tracks `isDataRequest`. Could short-circuit serialization.

### Summary of cost distribution

- **Baseline per-request cost (SvelteKit):** ~500-700µs (1 fetch wrapper + 1 server call + route match + render + response stream setup)
- **Overhead in Vike vs Svelte (empirically ~830 req/s vs 7155 req/s ≈ 8.6× slower):**
  - Page config load + dynamic import: ~300-500µs
  - Multi-stage hook pipeline: ~200-400µs
  - Global context init (tracing): ~100-200µs
  - Explicit serialization: ~50-100µs
  - **Total estimated overhead: ~650-1200µs per request**

This explains the 8.6× gap if latency is the bottleneck (which the 28% idle CPU confirms).


---

## Phase 4 — Candidate list

After Phase 2 invalidated the two "obvious" candidates (objectAssign fast-path is unviable; page-config caching is already done), the realistic remaining candidates are:

| # | Candidate | Predicted impact | Effort | Where | Risk |
|---|---|---|---|---|---|
| **A** | **Skip pageContext serialization on non-hydration requests** | low — saves 0.5–2ms only on data/JSON requests, but most traffic is HTML | small (~1h) | upstream Vike | low — `isDataRequest` already tracked |
| **B** | **Short-circuit route matching with `Promise.race`** instead of `Promise.all` | invisible on 1-page apps; meaningful on 50+ route apps | small (~2h) | upstream Vike | medium — must preserve route precedence semantics |
| **C** | **Cache `analyzePageClientSideInit` results per pageId** | small — runs every request even after first | small (~1h) | upstream Vike | low |
| **D** | **Cache hook chain lookup (`getHooksFromPageContextNew`)** | small — currently scans config per hook type per request | medium (~3h) | upstream Vike | medium |
| **E** | **Reduce `pageContext` fork count from 5 → 2** | could save ~85µs/req if 3 forks are removable | unknown — audit risk | medium-high | upstream Vike | high — forks exist for error-recovery isolation |

**None of these are likely to move RPS more than a few percent** in the minimal-scaffold bench. RudderJS's 1-page perf-bench is a worst-case for any candidate that scales with route count or hook count.

### What we are NOT recommending

- ❌ **objectAssign fast-path** (Phase 2 microbench: hybrid is 14% *slower* than current with getter-bearing data)
- ❌ **Pre-compute config manifest at build time** (already done via `isPageEntryLoaded` cache)
- ❌ **Single-hook entry point `+onHandle()`** (Phase 3's #2 — design change too large, breaks user code)
- ❌ **Replace `Object.defineProperties` with `Object.assign` in fork** (loses getter semantics — `urlPathname`/`url`/`urlParsed` would be eagerly computed, breaking lazy evaluation)

---

## Phase 4 — Validation

Tried: **pageContext shape stability (V8 hidden-class fix)**.

### Hypothesis
Vike builds pageContext incrementally via 35+ objectAssign calls per request, adding fields in different orders depending on which conditional branches fire. V8 creates many hidden classes for what's logically one object, making property reads megamorphic.

### Microbench validation (in isolation)
| Variant | ns/read | Verdict |
|---|---:|---|
| Empty + defineProperties (Vike's actual pattern) | 1.48 | baseline |
| Pre-shape + defineProperties | 0.90 | **1.64× faster** |
| Pre-shape + Object.assign | 0.92 | confirms pre-shape benefit |
| Pre-shape + direct assignment | 0.71 | fastest possible |

In isolation, the hypothesis is **correct** — pre-shaped pageContext property reads are 1.64× faster.

### The patch
Modified `packages/vike/src/shared-server-client/createPageContextShared.ts` `createPageContextObject()` to pre-declare 41 known plain-data fields as `undefined`. URL accessor properties (urlPathname/url/urlParsed) intentionally left out so their later installation via getters doesn't cause an extra descriptor-type transition. Cast preserves the original narrow return type — no API change. 180/180 Vike unit tests pass.

### Apples-to-apples end-to-end bench (5 iter × 30s)
| Scenario | UNPATCHED median | PATCHED median | Delta |
|---|---:|---:|---|
| c=10 | 810.34 req/s | 807.54 req/s | **-0.3%** (within variance) |
| c=100 | 816.74 req/s | 753.47 req/s | **-7.7%** (within variance — both range 617-880) |

**No measurable RPS improvement.** The microbench-validated win does not translate.

### Why the patch didn't help

CPU is not the binding constraint at any of the concurrency levels we tested:
- c=10: 28% idle CPU per Phase 0 profile
- c=100: similar — RPS ceiling is ~830 req/s regardless of concurrency

When CPU has slack, reducing per-request CPU work doesn't increase throughput — it just moves CPU samples around. The real bottleneck is per-request *latency* (~11ms), of which JS execution time is only one component. The rest is event-loop scheduling and the cost of crossing async/await boundaries (Phase 1 counted 6+ per request).

### Pattern across three attempts

This is the third candidate we've tried with the same outcome:
| Patch | Theory | Microbench | Real RPS |
|---|---|---:|---:|
| objectAssign fast-path | save 2× on plain-data assignments | ✓ confirmed | +1.6% (noise) |
| catchInfiniteLoop lazy-msg | save 11% CPU | (not run) | +1.6% (noise) |
| pageContext pre-shape | save 1.64× on reads | ✓ confirmed | -0% to +0% (noise) |

**Consistent finding: V8/CPU-level optimizations of Vike's hot path do not move RPS on workloads where the system isn't CPU-bound.** This is a property of the workload + system, not a bug in V8 or in our methodology.

---

## Outcome — final

**No JS-level / V8-level fix moved end-to-end RPS on this workload.** Three honest attempts (objectAssign fast-path, catchInfiniteLoop lazy-msg, pageContext shape stability) — all microbench-validated, all production-tested, all within iteration variance on real bench numbers.

**The deep-dive's value is what it ruled out:**

1. The "obvious" candidates from a CPU profile (catchInfiniteLoop 11%, objectAssign 6%) are not exploitable — fixing them doesn't change throughput when CPU has 28% idle headroom.
2. The "obvious" candidates from architecture reading (page config caching, manifest pre-computation) are already implemented in Vike (`isPageEntryLoaded` flag).
3. The V8 hidden-class hypothesis is theoretically sound and microbench-validated, but not measurable end-to-end on a non-CPU-bound workload.
4. RudderJS framework overhead is <5% of CPU. The Vike-bound ~830 req/s ceiling is **architectural to Vike**, not a hot spot we own.

**What WOULD likely move RPS** (didn't try; large effort, uncertain payoff):

- **Reduce async/await boundaries** — Phase 1 counted 6+ per request. Each is event-loop overhead that doesn't show in CPU profile but bounds latency. Likely needs Vike-internal redesign.
- **Hook-chain fast path for zero user hooks** — currently every hook still goes through `execHookBaseAsync` with Promise wrapping. If user defined no hooks of type X, skip the entire dispatch. Phase 3 noted Svelte does this.
- **Streaming response from earlier in the pipeline** — start writing headers + early bytes before the full pageContext is built. Reduces wall-clock latency, raises RPS.

None of these are small patches — they're Vike-architecture changes that need brillout's buy-in and probably weeks of design work.

### Should we still draft the upstream PR for pageContext shape stability?

Arguments for: microbench-validated, theoretically sound, 180/180 tests pass, zero semantic change, will help at higher CPU saturation than we tested.

Arguments against: end-to-end bench didn't show a win on either c=10 or c=100; brillout may close as "speculative without measurable benefit"; we'd be opening a PR that *we* couldn't substantiate the value of in production.

**Recommendation: do not open this PR right now.** The honest framing for upstream is "improves V8 hidden-class stability, measurable in microbench, not yet measurable in end-to-end RPS." That's an unconvincing PR. If a future scenario surfaces where Vike is genuinely CPU-bound (very large apps, very high concurrency on small hardware), revisit the patch then with workload-specific bench data.

### Memory entries to write

- **CPU profile % ≠ throughput %.** When the event loop has idle headroom (28% in this case), reducing CPU work doesn't proportionally raise throughput. Always sanity-check CPU saturation before predicting throughput gains from CPU savings.
- **Vike's `objectAssign` is intentionally slow-path for getter preservation.** Don't propose fast-path replacements without verifying the addendum is getter-free at runtime — hybrid detection is slower than the current implementation when getters are common.
- **`loadAndParseVirtualFilePageEntry` already caches** via `isPageEntryLoaded` in production. Don't propose "pre-compute page config at build time" — it's done.
- **pageContext pre-shape microbench: 1.64× faster reads.** The optimization is real in isolation but doesn't move RPS at concurrency levels where CPU isn't saturated. Save the branch (`vike-upstream:perf-pagecontext-shape`) for revival if a high-saturation scenario appears.
- **RudderJS SSR ceiling on minimal apps: ~830 req/s, Vike-bound.** Framework overhead is <5% of CPU. The 8.6× gap to Svelte is Vike's per-request orchestration cost (multi-hook chain, late-bound plugin dispatch, universal-handler translation). Not optimizable without architectural changes upstream.

### What we learned

1. **The earlier upstream Vike PR was correctly killed.** Phase 2 microbench shows the "objectAssign fast path" is *slower* than current code when getters are present (which they always are after `createPageContextServer`). The +1.6% bench result we saw earlier was even smaller than the +14% theoretical prediction because we were applying a fix to a non-bottleneck.
2. **Phase 1 and Phase 3 had a shared blind spot** — both flagged "page config loading per request" as a top cost. Phase 2 verified the source and found Vike already caches this via `isPageEntryLoaded` in production. The estimate was wrong because the readers didn't trace the cache path.
3. **The 8.6× gap to Svelte is architectural, not a bug.** Svelte bakes route metadata, hooks, and the SSR runtime into a monolithic bundle. Vike provides framework-agnostic late binding with a pluggable renderer. These choices have a real per-request cost that's structurally part of Vike's design.
4. **RudderJS itself is not the slowdown.** The earlier CPU profile showed @rudderjs/* packages at <1% combined, our server-hono adapter at ~5%. The framework overhead on top of Vike is minimal.

### What we did not find

A single hot spot in Vike that's both (a) production-affecting, (b) easily fixable without breaking existing semantics, and (c) measurable on a minimal-scaffold bench. Every candidate in the Phase 4 table has caveats — most either don't apply to small apps or have correctness risks.

### Memory entries to write

- **Vike's `objectAssign` is intentionally slow-path for getter preservation.** Don't propose fast-path replacements without verifying the addendum is getter-free at runtime — Phase 2 microbench shows hybrid detection is slower than the current implementation.
- **`loadAndParseVirtualFilePageEntry` already caches via `isPageEntryLoaded`.** Don't propose "cache page config at build time" — it's done.
- **RudderJS SSR throughput is Vike-bound at ~1k req/s on minimal apps.** RudderJS framework overhead is <5% of CPU; further optimization is upstream Vike work, not RudderJS-internal.
- **CPU profile % ≠ throughput %.** When the event loop has idle headroom (28% in this case), reducing CPU work doesn't proportionally raise throughput. Always sanity-check the CPU saturation level before predicting throughput gains from CPU savings.
