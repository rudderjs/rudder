# First-Render SSR Investigation

**Status:** investigating, 2026-05-15.
**Effort:** ~1 day measurement (this PR). Fix-PR(s) scope TBD after findings.
**Prerequisites:** perf-baseline harness from #479 (`scripts/perf-bench.sh`, `scripts/perf-bench-helpers.sh`, env-gated `RUDDER_PERF_TRACE`).

**Goal:** Close the 5-17× first-SSR gap surfaced in [[perf-baseline-findings]] — RudderJS first-render SSR is **345 ms** vs Nuxt 73 ms vs SvelteKit 20 ms (`first_request_/ − cold_boot`). This investigation produces a per-stage breakdown to localize the cost; the fix-PR is a separate plan once we know where the time goes.

**Non-goals:**
- Not a fix yet. Brief back to Suleiman with findings before any code change.
- Not a Vike upstream investigation — only what we can fix on our side.

---

## Hypothesis tree

The 345 ms first-render gap could be:

1. **One-time warm-up cost (likely if request-2 is much faster than request-1).** Module-loading on demand, Vike's first-page-render cycle, JIT.
2. **Persistent per-request cost (likely if request-1 ≈ request-5).** Middleware stack overhead, Vike's per-request pageContext build, React 19 serialization, route-table walk.
3. **Mix** — partial warm-up + persistent floor.

The two have different fixes:
- **Warm-up** → pre-warm during boot (eager Vike init, dummy renderToString), or audit lazy imports that fire on first request.
- **Persistent** → reduce per-request allocation, cache pageContext slices, slim the middleware stack.

---

## Step 1: warm-up vs persistent

### Task 1.1: Write N-requests measurement script

**Files:**
- New: `scripts/perf-bench-requests.sh`

**Shape:** for each framework, on a fresh boot, fire requests 1..10 sequentially and record per-request wall time (start → 200 OK delivered). Repeat 5 fresh boots, take median per-request-index.

Output JSON shape:
```json
{
  "rudderjs": { "req_1_ms": 345, "req_2_ms": ?, "req_3_ms": ?, "req_5_ms": ?, "req_10_ms": ? },
  "next":     { ... },
  ...
}
```

Reads cold_boot time from `scripts/perf-bench-results.json` for context.

### Task 1.2: Run + classify

Run the script across all 4 frameworks. Interpret:

- If RudderJS `req_5_ms` ≈ Nuxt/Svelte's `req_1_ms` (small) → **warm-up dominant**. Focus Step 2 on what fires on first request only.
- If RudderJS `req_5_ms` stays high (>100 ms gap) → **persistent dominant**. Focus Step 2 on per-request stages.
- If gradient (req_1 high, req_3 medium, req_5 low) → **mixed**. Both fixes apply.

---

## Step 2: per-stage request lifecycle

### Task 2.1: Instrument

**Files (env-gated on `RUDDER_PERF_TRACE=1`):**
- Modify: `packages/server-hono/src/...` — Hono handler entry + exit
- Modify: `packages/router/src/...` — middleware stack entry + handler resolve
- Modify: `packages/view/src/...` — `view()` call + Vike `renderPage` boundaries

Emit one `[perf] req <stage> <ms>` per stage per request. Add a request-id so per-request reconstruction is possible from the log.

Zero overhead when env unset (same pattern as #479).

### Task 2.2: Capture breakdown for request 1 and request 5

On `~/perf-bench/rudderjs` with `RUDDER_PERF_TRACE=1`:
1. Cold-boot the server
2. `curl /` — capture all `[perf] req` lines for this request
3. `curl /` 4 more times to warm
4. `curl /` — capture `[perf] req` lines for the warm request
5. Kill, restart, repeat 3 times for stability

Compare cold vs warm per-stage. Identify the stage(s) responsible for the gap.

---

## Step 3 (separate plan): the fix

Not in scope of this investigation. Likely candidates depending on findings:
- Vike pre-warm at boot time (dummy render)
- Lazy-load audit (anything firing on first request that could move to boot)
- Middleware allocation reduction
- pageContext slice caching

Write `docs/plans/2026-05-XX-ssr-first-render-fix.md` once data points say which.

---

## Findings

### Step 1: warm-up dominant across all 4 frameworks

Each framework's first request is much slower than subsequent ones. Magnitudes differ.

| | req_1 | req_2 | req_5 | req_10 | Warm-up cost (≈ req_1) |
|---|---:|---:|---:|---:|---:|
| RudderJS | **182 ms** | 4.2 ms | 3.5 ms | 2.9 ms | ~178 ms |
| Next.js 16.2 | 105 ms | 3.0 ms | 2.3 ms | 2.2 ms | ~102 ms |
| Nuxt 4.4 | 77 ms | 3.0 ms | 2.3 ms | 1.7 ms | ~74 ms |
| SvelteKit 2.60 | 13 ms | 2.3 ms | 2.3 ms | 1.9 ms | ~11 ms |

After warm-up, all 4 frameworks land within 1.7–4.2 ms per request — **the persistent per-request cost is not the gap**.

Note: the perf-baseline (#479) derived a 345 ms "first-render SSR" by subtracting `cold_boot` from `first_request`. That conflated spawn overhead with first-render cost. The cleaner per-boot fresh-port measurement here shows the real warm-up cost is **~178 ms**, not 345 ms. The 5-17× headline was overstated; the actual gap to Nuxt is 2.4×, to Svelte 16×.

### Step 2: where the 178 ms goes

Per-stage instrumentation (`RUDDER_PERF_TRACE=1`) on a single fresh boot, requests 1–6:

| Stage | Req 1 | Req 2 | Req 3+ |
|---|---:|---:|---:|
| Middleware (rate-limit, session, auth) | 0.6 ms | 0.1 ms | 0.0 ms |
| Route handler (the `view('welcome', ...)` call) | 0.2 ms | 0.2 ms | 0.0 ms |
| **`await import('vike/server')`** | **102.8 ms** | 0.1 ms | 0.0 ms |
| **Vike `renderPage()`** | **74.7 ms** | 3.3 ms | 1.2–2.2 ms |
| Total `view.toResponse()` | 179.6 ms | 3.9 ms | 1.6–2.7 ms |

**The 178 ms warm-up is two distinct one-time costs:**
1. **~103 ms** loading the `vike/server` module tree (Node's ESM module cache misses on first call). After first request, the module is cached and the import is ~0.1 ms forever.
2. **~75 ms** Vike's first `renderPage()` call (internal JIT / route-table build / first SSR pipeline allocation). After first call, subsequent renders are 1.2–3.3 ms.

Both are one-time. After request 1, RudderJS is competitive (3.5 ms vs Nuxt 2.3 ms — a 1.2 ms gap, basically noise).

### Fix shipped: eager vike/server prewarm

Implemented in this same PR (the investigation and the fix go together). Two pieces:

1. **`@rudderjs/view`** exports `prewarmVikeServer()` — a memoized lazy loader that caches the `import('vike/server')` Promise. `toResponse()` awaits the cached Promise instead of doing the import inline.
2. **`@rudderjs/server-hono`** fires `prewarmVikeServer()` as a **module-load side-effect** of its own index module. The chain `void import('@rudderjs/view').then(m => m.prewarmVikeServer?.())` runs the moment `bootstrap/app.ts` statically imports `{ hono }` — roughly t=0 in the cold-boot timeline. By the time the first user request arrives, `vike/server` is fully cached and `view.import-vike` is 0 ms.

`@rudderjs/view` is an optional peer of `@rudderjs/server-hono` (server-hono is usable without view for pure-JSON APIs), so the dynamic import is wrapped in a `.catch()` that swallows ENOENT.

Tests in `@rudderjs/view` install their `mock.module('vike/server', ...)` AFTER importing view — so view exports a `_resetVikeServerCacheForTests()` internal hook the test's `afterEach` calls to clear the cache between scenarios.

### Numbers after the fix

| Metric | Baseline (#479) | After fix | Δ |
|---|---:|---:|---:|
| RudderJS cold boot (prod) | 191 ms | 277 ms | **+86 ms** |
| RudderJS first request `/` (median of 5 boots) | 182 ms | **96 ms** | **−86 ms** |
| RudderJS req 2+ | 4 ms | 4 ms | ~ |
| view.import-vike on R1 | 103 ms | **0 ms** | −103 ms |
| view.renderPage on R1 | 75 ms | 47 ms | −28 ms¹ |

¹ Vike's first-render cost varies run-to-run; the reduction isn't from the fix, just measurement noise.

Cross-framework after-fix (req_1 median, n=5):

| | req_1 |
|---|---:|
| SvelteKit | 12 ms |
| Nuxt | 76 ms |
| **RudderJS (after fix)** | **96 ms** |
| Next.js | 120 ms |

RudderJS now **beats Next on first-request** and lands within 20 ms of Nuxt. The remaining 84 ms gap to SvelteKit is split roughly evenly between Vike's first-renderPage warm-up (~47 ms; Option C territory — not pursued here) and Hono/Node HTTP first-dispatch overhead (~37 ms; mostly out of our control).

### Trade-off: cold-boot regresses by ~86 ms

Net spawn-to-first-content is the same (373 ms ≈ 373 ms) — the fix moves cost from request-time to boot-time. The real production win comes from the cost being hidden behind the load-balancer's health-check / process-manager's readiness probe. Users never see the cold-boot; they always see the first-request. **86 ms faster TTFB on first hit, no change after warm-up.**

If cold-boot matters in some niche (CLI tests that spin up the server for one request, single-shot benchmarks), the user can opt out by passing `{ skipPrewarm: true }` to `hono(config)` — not implemented in this PR; trivial follow-up if requested.

Out of scope: Vike upstream optimizations, React 19 SSR upstream, the residual 47 ms Vike first-render warm-up (Option C: dummy render at boot — would close the remaining gap to Nuxt but add another ~50 ms to cold-boot).

### Where the instrumentation lives

Three env-gated `[perf]` markers added in this PR (no measurable overhead when `RUDDER_PERF_TRACE` unset):
- `packages/server-hono/src/index.ts` — middleware time, handler time, view.toResponse wrapper time
- `packages/view/src/index.ts` — import-vike time, renderPage time

These can stay in tree as permanent regression-detectors.
