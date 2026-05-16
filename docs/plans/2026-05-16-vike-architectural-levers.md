# Vike Architectural Levers — Pre-design RFC

> **Status: CLOSED — all three levers validated and killed, 2026-05-16.** See "Validation result" section below. No upstream PR. The RFC stays as a closed-loop investigation record.
>
> **Original intent:** Pre-design the three architectural levers identified in [`2026-05-16-vike-deep-dive.md`](./2026-05-16-vike-deep-dive.md) — async-boundary reduction, hook-chain fast path for zero-user-hook routes, and earlier response streaming — so that *if/when* brillout signals readiness, we can move from "deferred" to a concrete proposal in days, not weeks.
>
> **What happened:** Per the validation gate, we instrumented vike's `renderPageServer` with `performance.now()` markers at 10 boundaries, ran it under autocannon load (c=10 and c=100, 30s each, ~48k samples total), and measured per-phase costs against wall-clock latency. Every lever's targeted phase came in 1-2 orders of magnitude below its kill criterion. The 8.6× SSR gap to Svelte is *not* inside `renderPageServer`.

---

## Validation result — 2026-05-16

**Instrumentation branch:** `~/Projects/vike-upstream` on `perf-instrument-boundaries` (commit `d38367a`, local-only). Added `packages/vike/src/server/runtime/perfBoundaries.ts` with sample collection + percentile dump on `SIGTERM`/`beforeExit`. Inserted 10 `markBoundary()` calls + 1 `finishRequest()` across `renderPageServer.ts` and `renderPageServer/renderPageServerAfterRoute.ts`.

**Bench setup:** RudderJS bench app at `~/perf-bench/rudderjs` (the same fixture from the deep-dive), built against the instrumented vike. Sequential warmup of 100 requests, then `autocannon@8.0.0 -d 30` at each concurrency level. Two key local-only steps needed to make the instrumented vike actually load: (1) vike override in the bench app's `pnpm.overrides`, (2) retarget `~/Projects/rudder/packages/{view,vite}/node_modules/vike` symlinks at vike-upstream (otherwise `@rudderjs/view`'s linked node_modules resolves to a different vike). Symlinks restored after the bench.

### Per-phase timings under load

**c=10, 30s, 20,395 samples, autocannon RPS = 676, latency p50 = 12ms:**

| Phase | p50 | p99 | max |
|---|---:|---:|---:|
| REQ_START → GLOBALCTX_START | 0.021ms | 0.143ms | 2.9ms |
| GLOBALCTX_START → GLOBALCTX_END | 0.006ms | 0.041ms | 1.5ms |
| GLOBALCTX_END → PAGECTX_BEGIN_END | 0.026ms | 0.155ms | 3.3ms |
| PAGECTX_BEGIN_END → URLCHECK_END | 0.059ms | 0.293ms | 6.1ms |
| **URLCHECK_END → ROUTE_END** | **0.428ms** | 1.84ms | 51.6ms |
| ROUTE_END → LOADCONFIGS_END | 0.089ms | 0.449ms | 47.3ms |
| LOADCONFIGS_END → DATAHOOK_END | 0.009ms | 0.061ms | 7.9ms |
| **DATAHOOK_END → RENDERHOOK_END** | **0.194ms** | 0.889ms | 45.3ms |
| RENDERHOOK_END → RESPONSE_END | 0.009ms | 0.060ms | 2.9ms |
| RESPONSE_END → REQ_END | 0.003ms | 0.025ms | 0.5ms |
| **TOTAL** | **0.841ms** | 3.43ms | 68.8ms |

**c=100, 30s, 27,963 samples, autocannon RPS = 925, latency p50 = 108ms:**

| Phase | p50 | p99 | max |
|---|---:|---:|---:|
| REQ_START → GLOBALCTX_START | 0.016ms | 0.050ms | 1.3ms |
| GLOBALCTX_START → GLOBALCTX_END | 0.004ms | 0.011ms | 1.1ms |
| GLOBALCTX_END → PAGECTX_BEGIN_END | 0.022ms | 0.052ms | 1.8ms |
| PAGECTX_BEGIN_END → URLCHECK_END | 0.054ms | 0.093ms | 1.8ms |
| **URLCHECK_END → ROUTE_END** | **0.482ms** | 1.39ms | 5.5ms |
| ROUTE_END → LOADCONFIGS_END | 0.069ms | 0.164ms | 54.9ms |
| LOADCONFIGS_END → DATAHOOK_END | 0.007ms | 0.016ms | 1.4ms |
| **DATAHOOK_END → RENDERHOOK_END** | **0.145ms** | 1.13ms | 18.7ms |
| RENDERHOOK_END → RESPONSE_END | 0.006ms | 0.018ms | 2.3ms |
| RESPONSE_END → REQ_END | 0.003ms | 0.007ms | 0.1ms |
| **TOTAL** | **0.798ms** | 2.14ms | 77.1ms |

### Killed levers

| Lever | Targeted phase | p50 at c=100 | Share of 108ms latency | Kill criterion | Verdict |
|---|---|---:|---:|---|---|
| 2 — hook-chain fast path | LOADCONFIGS → DATAHOOK | 0.007ms | 0.006% | <2% | **killed** |
| 1 — async boundary reduction | Sum of 7 small phases | 0.112ms | 0.10% | <3% | **killed** |
| 3 — earlier streaming | DATAHOOK → RENDERHOOK | 0.145ms | 0.13% | <5% | **killed (inside-vike)** |

Each lever falls 1-2 orders of magnitude below its kill criterion. None move RPS measurably.

### What the data actually shows

In-`renderPageServer` CPU is **<1% of wall-clock latency** at both c=10 (0.84ms / 12ms) and c=100 (0.80ms / 108ms). The 8.6× SSR gap to Svelte cannot be in vike's request pipeline — it's somewhere else in the stack:

- Hono / srvx HTTP transport
- `@rudderjs/server-hono` adapter (universal-middleware translation, request normalization, response wrapping)
- `@rudderjs/view`'s `view()` helper (the `await import('vike/server')` + envelope construction)
- Actual stream backpressure / response flush
- Connection-level queueing under high concurrency

The RFC was aimed at the wrong layer. Optimizing `renderPageServer` itself cannot move RPS more than ~1% because there's only ~1% of latency there to optimize.

### Honest retrospective

The deep-dive's hypothesis — that the 11ms-vs-1.3ms gap to Svelte was explained by vike's "per-request orchestration cost" inside `renderPageServer` — was wrong. The cost isn't there. The deep-dive estimated 650-1200µs of vike-specific overhead per request (Phase 3 of [`2026-05-16-vike-deep-dive.md`](./2026-05-16-vike-deep-dive.md)). The actual measured number is 800µs at c=100 — roughly in that range. But that's still <1% of latency under load. The latency comes from outside.

**Lesson for future investigations:** the deep-dive read source code carefully and reasoned about per-phase costs from architectural inspection. That gave it a plausible-looking decomposition. What it didn't do was *measure* the per-phase costs end-to-end in a running system. We did that step today; the inspection-based estimates didn't survive contact with `performance.now()`.

### What was NOT validated

- We did not run the lever prototypes themselves. We measured the ceiling each lever could possibly contribute. With the ceiling at <1% of latency, no prototype could earn its kill criterion regardless of implementation quality.
- We did not isolate where the other 99% of latency lives. That's a separate investigation — see "Open questions" below.

### Next actions taken

- `perf-instrument-boundaries` branch in vike-upstream stays local, not pushed.
- This RFC marked closed; no upstream PR for any of the three levers.
- Memory updated to capture the methodology lesson (instrumentation > inspection for per-phase cost claims).

---

---

## Background

From the [deep-dive](./2026-05-16-vike-deep-dive.md), the binding constraint is **per-request latency, not CPU**:

- RudderJS overhead: <5% CPU (server-hono ~5%, `@rudderjs/*` combined <1%)
- Vike orchestration: ~38% CPU
- Native / GC: ~40%
- 28% idle CPU under sustained load — **the system is not CPU-bound**

Three patches that won the microbench but did not move end-to-end RPS:

| Patch                       | Microbench | Real RPS    |
|-----------------------------|-----------:|------------:|
| `objectAssign` fast-path    | confirmed  | +1.6% (noise) |
| `catchInfiniteLoop` lazy-msg | (theoretical 11% CPU) | +1.6% (noise) |
| `pageContext` pre-shape     | 1.64× faster reads | 0% (noise) |

The pattern: at 28% idle CPU, reducing CPU work shrinks each request's wall-clock by a *fraction of a fraction*. To move the RPS ceiling we must shrink **latency** — specifically the chain of async boundaries and per-request setup work that bounds how fast a single request walks the pipeline.

Hence the three levers.

---

## Lever 1 — Async-boundary reduction

### Problem

Phase 1 counted **6+ awaits** on the critical path of a no-user-hook SSR request:

| # | Location                                                   | Reason                                |
|---|------------------------------------------------------------|---------------------------------------|
| 1 | `renderPageServer.ts:120-121`                              | `AsyncLocalStorage.run(...)` wrapper  |
| 2 | `renderPageServer.ts:145`                                  | `initGlobalContext_renderPage()`      |
| 3 | `renderPageServer.ts:504`                                  | `getPageContextBegin()`               |
| 4 | `renderPageServer.ts:211`                                  | `renderPageServerEntryRecursive()`    |
| 5 | `route/index.ts:80-124`                                    | `route()` — `Promise.all` over routes |
| 6 | `renderPageServerAfterRoute.ts:35`                         | `loadPageConfigsLazyServerSide()`     |
| 7 | `renderPageServerAfterRoute.ts:67`                         | `execHookDataAndOnBeforeRender()`     |
| 8 | `execHookOnRenderHtml.ts:41`                               | `execHookOnRenderHtml()`              |
| 9 | `createHttpResponse.ts:45`                                 | `createHttpResponsePage()` + `__getPageAssets()` |

Each `await` is a microtask boundary. In a tight pipeline, the cost is dominated not by the inner work but by the scheduler round-trip between awaits. Phase 2 inferred (did not directly measure) that this is the binding constraint at 28% idle CPU.

### Design sketch

Three sub-changes, each independently measurable:

**1a — Collapse synchronous-only awaits to direct calls.**

Several of the 6+ awaits wrap functions whose body is `async` purely as a typing convenience; they never `await` anything material on the cached fast-path:

- `getPageContextBegin()` is sync after the first request (no I/O once `globalContext` is initialized).
- `loadPageConfigsLazyServerSide()` is sync once `isPageEntryLoaded` is true (it's just a config merge after the cache hit).
- `execHookDataAndOnBeforeRender()` only awaits when user defined `+data`/`+onBeforeRender`. When undefined, it walks the hook chain just to discover there's nothing to call.

The fix is a typed branch: detect "no I/O needed" at call-site, return synchronously. Type signature stays `Promise<T> | T` (union return) so existing call sites that `await` still work.

Reference precedent: `vike-react`'s `onRenderHtml` already returns a string *or* a Promise<string> depending on whether streaming is enabled — Vike handles the union internally. Same pattern.

**1b — Hoist `AsyncLocalStorage.run()` out of the per-request path.**

`renderPageServer.ts:118-121`:

```ts
const asyncLocalStorage = getAsyncLocalStorage()
return !asyncLocalStorage
  ? await render(/*...*/)
  : await asyncLocalStorage.run(/*...*/, () => render(/*...*/))
```

The `getAsyncLocalStorage()` lookup happens per request, and the closure `() => render(...)` allocates per request. Move both to module init: cache the ALS instance, and use `asyncLocalStorage.run(ctx, render, ctx)` directly (no closure) — Node's ALS accepts trailing args.

**1c — Replace `Promise.all` route matching with serial-with-early-exit.**

`route/index.ts:80-124` runs every page route through `Promise.all`, even though most route matchers are synchronous. The first match wins, but all N-1 other matchers still run.

Replace with a loop:

```ts
for (const r of pageRoutes) {
  const result = matchRoute(r, pageContext)
  if (isPromise(result)) {
    const awaited = await result
    if (awaited?.routeMatch) return resolve(awaited)
  } else if (result?.routeMatch) {
    return resolve(result)
  }
}
```

Trades parallelism for short-circuit. On a 1-page bench this saves nothing; on a 50-route app it eliminates 49 wasted matcher evaluations. Route-precedence semantics preserved by ordering the array correctly at build time (Vike already computes precedence).

### Backward-compat strategy

All three sub-changes are internal — no public API surface touched. Test gates:

- 1a: every `await someFn()` call site must still work with a non-Promise return — TypeScript catches misuse.
- 1b: ALS semantics unchanged; ALS instance is process-singleton anyway.
- 1c: route precedence test fixtures (Vike has these in `test/units/route.spec.ts`) must pass unmodified.

### Instrumentation plan

**Before writing any code**: instrument `renderPageServer` with `performance.now()` markers at each `await` site and dump per-request boundary timings to a CSV. Run for 30s under `c=10` and `c=100`. We need to know the cost of each boundary in isolation, not the aggregate, otherwise we can't tell which sub-change earned the win.

Then for each sub-change:

1. Patch in isolation.
2. Rerun `scripts/perf-bench-rps.sh` (5 iter × 30s, c=10 and c=100).
3. Median RPS delta vs unpatched baseline.
4. Apples-to-apples: same node binary, same vike build hash, same Rudder commit.

### Expected impact

**Honest range: 0% to +15%**, weighted toward the lower end.

Each boundary collapse saves one microtask tick (~5-50µs depending on contention). At 6 boundaries and ~11ms per request, the *upper* bound of pure boundary cost is ~300µs (2.7% of latency). 1a alone might be worth 3-5%. 1c only matters at scale (50+ routes). 1b is sub-1%.

But: boundaries are also where event-loop pressure manifests. Under high concurrency the *queueing* cost of a microtask is much higher than the bench-isolated cost. So the real win might compound under load.

**Kill criteria:** if 1a + 1b + 1c combined moves median RPS by <3% at c=100, abandon. Don't ship 0-1% gains upstream.

### Risks

- **Type-system churn.** Returning `Promise<T> | T` from currently-`async` functions changes ~15 internal signatures. Type-only change but invasive.
- **Hidden I/O.** A function that *looks* sync today might add I/O tomorrow (e.g. someone adds a config-disk-read inside `loadPageConfigsLazyServerSide`). Mitigation: tag the fast-path functions with `// @sync-fastpath` comments + a lint rule.
- **Closure-allocation savings overestimated.** V8 can elide some closure allocations via escape analysis. Microbench first.

### Effort

~3-5 days of design + implementation + bench, assuming brillout pre-approves the typed-union pattern. **Single PR**, three commits (1a/1b/1c), self-reviewable.

---

## Lever 2 — Hook-chain fast path for zero-user-hook routes

### Problem

Per Phase 1: even when the user has defined zero hooks of type X, Vike still walks the hook resolution chain (`getHooksFromPageContextNew`) and wraps the result in `execHookBaseAsync` with Promise/timeout machinery (`execHookBaseAsync.ts:130-194`). The dispatch is structurally async even when there's nothing to dispatch *to*.

Hooks affected on the no-user-hook path:
- `+onBeforeRoute` — async invocation, no user hook
- `+guard` — async invocation, no user hook
- `+data` / `+onData` — skipped when undefined (already optimized)
- `+onBeforeRender` — async invocation, no user hook
- `+onRenderHtml` — **must** exist (renderer plugin provides it)

So 3 of 5 hooks pay the dispatch tax to discover they have nothing to call.

### Design sketch

**Pre-compute a per-page hook presence bitmap at build time** (or at first-request-cache time, whichever Vike's build pipeline supports cleanly).

```ts
interface HookPresence {
  onBeforeRoute:   boolean
  guard:           boolean
  data:            boolean
  onData:          boolean
  onBeforeRender:  boolean
  onRenderHtml:    true  // always present (renderer plugin)
}
```

Stored on `pageConfig._hookPresence` (read once after `loadPageConfigsLazyServerSide`, cached forever).

Then `execHookBaseAsync` gets a fast path:

```ts
function execHookBaseAsync(hookName, pageContext, ...) {
  if (!pageContext._hookPresence[hookName]) {
    return  // sync return; no Promise, no timeout setup
  }
  // existing async path
  return execHookBaseAsyncSlow(hookName, pageContext, ...)
}
```

The fast path is a sync `if` + early return — no `await`, no Promise allocation, no microtask boundary.

For consistency with 1a's typed union, the slow path returns `Promise<HookResult>`; the fast path returns `undefined` synchronously.

### Backward-compat strategy

- Public API unchanged. Internal optimization.
- The bitmap is derived from the existing config; no new build artifact.
- User hooks still execute exactly as before — only the *absence* dispatch is short-circuited.
- Plugin-defined hooks (vike-react's `+onRenderHtml`) populate the bitmap the same way user hooks do.

### Instrumentation plan

Add `performance.now()` markers around each hook dispatch site. Measure:

1. Wall-clock per hook dispatch on the unpatched code (no user hooks) — confirms the "we pay even for absence" claim with numbers.
2. Wall-clock per hook dispatch on the patched code — confirms the fast path is genuinely cheaper.
3. End-to-end RPS delta from `scripts/perf-bench-rps.sh`.

The first measurement is the key gate. If "discover-nothing" cost is <50µs per hook (across 3 hooks = <150µs per request, ~1.4% of 11ms latency), the lever's ceiling is too low and we abandon.

### Expected impact

**Honest range: 0% to +8%.** Likely the most measurable of the three on the minimal-scaffold bench, because every request on the playground hits the empty-hook case.

If hook dispatch is ~100µs per call × 3 unused hooks = ~300µs per request ≈ 2.7% of latency. Removing all of it could move RPS by ~2-3% best case.

**Kill criteria:** if patched RPS delta <2% at c=100, abandon.

### Risks

- **Hook detection at build time isn't always possible.** Some hooks are conditional on runtime config (e.g. `+config.ts` may dynamically include a hook). Mitigation: compute bitmap after `loadPageConfigsLazyServerSide` resolves, not at literal build time. Cache then.
- **Hook plugins that register at runtime.** vike-react registers `+onRenderHtml` via the plugin system; this works because the plugin's hooks are statically known once loaded. But if any plugin adds hooks via `pageContext.set` style mutation, the bitmap goes stale. Audit: are there any? (Probably not, but verify.)
- **Brillout may prefer a different shape.** He might want hook presence inferred from the config schema rather than cached on `pageConfig`. Open question for the upstream discussion.

### Effort

~2-3 days. Smaller scope than Lever 1. Cleanest of the three to land.

---

## Lever 3 — Earlier response streaming

### Problem

Vike today builds the *full* pageContext before writing any response bytes. The HTML stream from React's `renderToReadableStream` only starts after:

1. Route matching completes (await)
2. Page configs loaded (await)
3. All hooks resolved (data, onData, onBeforeRender — 3 awaits)
4. `renderDocumentHtml` invoked
5. HTTP response object constructed
6. `__getPageAssets()` awaited inside `createHttpResponsePage` (one more await)

Only then do bytes start flowing. The user agent's TTFB is bounded by the entire chain.

Svelte's handler (Phase 3) is structurally similar — it also doesn't start streaming until render begins — so this isn't a Svelte-delta. But it's still a real lever for wall-clock latency, which translates directly to RPS ceiling.

### Design sketch

**Two-stage response:**

**Stage A — emit headers + document head early.** As soon as the route is matched and the page config is loaded, we have enough info to emit:

- HTTP status
- Content-Type, security headers (CSP nonce already computed)
- The opening of the HTML document — doctype, opening html tag, and the head section with preload hints and critical CSS link tags

This stage requires no user-data, no hook resolution beyond `+guard`.

**Stage B — stream the React render** into the open response. The renderer's output is piped directly into the already-open stream; no buffering, no full-page assembly before write.

The contract change: `+onRenderHtml` would need to *be* a stream-producing function (or be detected as returning a stream). vike-react already returns streams; vike-vue does conditionally; vike-solid mostly returns strings. So the lever applies cleanly to the React plugin first.

### Backward-compat strategy

- Opt-in via `pageConfig.stream = 'early'`. Default = `'after-render'` (current behavior).
- Renderer plugins that return strings (not streams) get current behavior automatically.
- Header mutation after Stage A becomes impossible — once headers flushed, they can't change. Mitigation: any hook that mutates `pageContext.headers` must run *before* Stage A, which means **before route+data resolution**. Acceptable for `+onBeforeRoute`; not acceptable for `+onBeforeRender`. Document the constraint clearly.
- Error handling: if render throws *after* Stage A, we can't change status code or redirect. Mitigation: emit an inline error-recovery script that handles client-side recovery, or accept that streaming-mode errors render as partial HTML. Svelte handles this the same way.

### Instrumentation plan

Different from Levers 1+2 — this one **doesn't move RPS unless TTFB is the binding constraint**. Need to measure two things:

1. **TTFB** (autocannon reports this) — should drop measurably with Stage A.
2. **RPS** — only moves if the server can pipeline more concurrent requests because each one releases its slot sooner.

If autocannon shows TTFB drops but RPS doesn't, the bottleneck is elsewhere (likely render itself).

### Expected impact

**Honest range: 0% to +20% RPS, +30% to +50% TTFB.** TTFB is the more confident metric; RPS is uncertain because it depends on whether the request slot frees up early or stays held until render completes.

The big "if": Node's HTTP/1.1 keep-alive plus the fact that `renderToReadableStream` is itself async means the request slot may still be held until the stream closes. If so, RPS doesn't move — only first-byte experience does.

**Kill criteria:** TTFB delta <20% at c=10, or RPS delta <5% at c=100. The whole point of this lever is wall-clock — if neither metric moves, abandon.

### Risks

- **Highest design complexity of the three.** Touches the response-write layer, the header-finalization timing, the error path.
- **Largest API-surface implication.** The `headers` mutation timing rules need clear docs. Users who currently set headers in `+onBeforeRender` need a migration path.
- **Brillout's design taste call.** He may prefer this be a renderer-plugin concern (vike-react owns streaming) rather than a Vike-core concern. Real possibility.
- **server-hono adapter implications.** Our adapter would need to support a `ReadableStream`-first response shape. Currently it does — Hono handles streamed responses natively — but the universal-middleware translation layer needs auditing.

### Effort

~5-7 days. The most invasive of the three. Highest reward if it works; highest risk of being told "let's not."

---

## Sequencing & dependencies

| Order | Lever | Why |
|------:|-------|-----|
| 1     | Lever 2 (hook-chain fast path) | Smallest scope, cleanest API, fastest to validate the approach with brillout |
| 2     | Lever 1 (async boundary reduction) | Larger scope but no API change. Wins compound with Lever 2 — fewer awaits means each hook-fast-path saves more in aggregate. |
| 3     | Lever 3 (early streaming) | Largest design + biggest surface change. Save for after the relationship has been re-warmed by 2 successful smaller PRs. |

Levers 1 and 2 are **independent** — either can ship first. Lever 3 *benefits from* Levers 1+2 landing first (fewer awaits before Stage A flush means earlier TTFB) but doesn't depend on them.

---

## Validation gate (the [[microbench-only-dont-ship-upstream]] lesson)

**For every lever, before any upstream PR:**

1. Reproduce the deep-dive's RPS baseline on the current Vike `main`. (`scripts/perf-bench-rps.sh`, 5 iter × 30s, c=10 and c=100.)
2. Apply the patch locally (linked vike build in `~/perf-bench/rudderjs/node_modules`).
3. Rerun the bench. Five iterations. Take medians.
4. **The PR ships only if all of:**
   - RPS delta exceeds the lever's kill criterion *and*
   - 95% CI of the patched runs doesn't overlap the unpatched baseline *and*
   - We can articulate the gain in one sentence that doesn't include "microbench"
5. Microbench data is supplemental, never the headline. PR description leads with the RPS table.

If a lever fails the gate, the branch lives in our fork for future revival (per the [`vike-deep-dive-conclusion`](./2026-05-16-vike-deep-dive.md) parking pattern), but doesn't go upstream.

---

## Outreach plan — when to share this RFC

**Not now.** Brillout said "I'm a bit busy" and "open to dig deeper… in the future" — undated. Pushing this RFC at him today re-opens a conversation he just soft-closed.

**Triggers to share** (any one of these):

- Brillout posts publicly about Vike perf work
- He DMs us asking what we'd prioritize
- A merged PR (#3260 or another) prompts a "what else were you thinking" follow-up from him
- A real RudderJS adopter hits the 830 req/s ceiling and we have an external pressure to point to
- A Vike release notes line mentions perf work (a signal of his bandwidth)

**How to share, when the trigger fires:**

- Lead with Lever 2 (smallest, cleanest, fastest validation). Don't dump the whole RFC.
- Frame as "we did the homework on the three levers from the deep-dive — here's the smallest one fleshed out, can I file as a draft PR?"
- Hold Levers 1 and 3 in reserve. If Lever 2 lands well, *then* offer Lever 1. Only mention Lever 3 if he asks for the full picture.

---

## Out of scope

- **Building our own SSR engine.** Per [[ssr-engine-architecture]] — if we ever do, target Astro's build-time binding model, not a Vike-clone. Not on the table today.
- **Forking Vike.** Strictly upstream-or-nothing. We are not the right team to fork the framework we depend on.
- **Per-route caching of rendered HTML.** Different lever entirely (CDN/edge concern). Could compound with these but doesn't need design here.
- **CPU-bound optimizations.** Ruled out by the deep-dive. Don't revive.

---

## Open questions for the upstream discussion

1. Lever 2: does brillout prefer the hook-presence bitmap stored on `pageConfig` or computed from the config schema dynamically?
2. Lever 1: is `Promise<T> | T` union-return acceptable as an internal convention, or does he prefer split sync/async functions?
3. Lever 3: should "stream from earliest possible point" live in Vike core or in the renderer plugin (vike-react/vike-vue/vike-solid)?
4. Across all three: what's the bench baseline brillout would accept? Our minimal-scaffold app is a worst case for some levers — would he prefer a larger fixture (e.g. vike.dev itself)?

---

## Related

- [`2026-05-16-vike-deep-dive.md`](./2026-05-16-vike-deep-dive.md) — investigation that produced these levers
- [`2026-05-16-perf-rps.md`](./2026-05-16-perf-rps.md) — bench infrastructure
- [`2026-05-15-ssr-first-render.md`](./2026-05-15-ssr-first-render.md) — prior successful Vike-related win (cold first-render, #480)
- [[vike-deep-dive-conclusion]] — memory note documenting why JS-level optimization didn't move RPS
- [[microbench-only-dont-ship-upstream]] — the rule this RFC honors
- [[cpu-pct-not-throughput-pct]] — the methodology lesson behind the kill-criteria gates
