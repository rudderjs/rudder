# Middleware chain perf — Phase 1 audit (no-go)

**Status:** Phase 1 done, 2026-05-17. Negative finding — middleware chain is at floor in prod; no shippable lever from this round.
**Effort:** ~30 min measurement + audit + write-up.

**Goal:** Map per-middleware overhead in a realistic app to find shippable optimizations. Targeted RateLimit, CSRF, Session, Auth — the four middlewares that run on every web request.

---

## Methodology

Subject: playground prod build (22 providers, pennant skipped + auth-secret local patch — same as the cold-boot bench). Temporary per-middleware timing patch in `server-hono`'s middleware loop, gated behind `RUDDER_PERF_TRACE=1`. Hit `/` 10 times sequentially via curl, capture per-middleware pre-handler time.

Bench in two modes for comparison: `pnpm dev` (Vite dev server) and `node dist/server/index.mjs` (prod).

---

## Findings

### Prod (the number that matters)

Steady-state per-middleware pre-handler time:

| Middleware | Median |
|---|---:|
| SessionMiddleware | 0.02 ms |
| AuthMiddleware | 0.01 ms |
| RateLimit | 0.004 ms |
| CsrfMiddleware | 0.05 ms (with token-generation; ~0.03 ms with existing cookie) |
| **Total `req middleware`** | **~0.1 ms** |

The whole chain runs in ~100 µs. No middleware is heavy enough to justify optimization work.

### Dev (where the original concern came from)

Same 10 hits via `pnpm dev`:

| Middleware | Median |
|---|---:|
| SessionMiddleware | 0.04 ms |
| AuthMiddleware | 0.02 ms |
| **RateLimit** | **1.4 ms** (peaks at 2.7 ms) |
| CsrfMiddleware | 0.07 ms |

**RateLimit looked 10× heavier than every other middleware in dev — but the prod number is 350× smaller (4 µs vs 1.4 ms).** The dev "RateLimit cost" was Vite SSR pipeline overhead per `await`, not middleware work.

### Structural insight

Dev-mode `await` cost is ~200–500 µs higher than prod because Vite's SSR runtime yields between async operations to its own task queue. Middlewares with **multiple `await`s** (like RateLimit, which awaits cache.get + cache.set) accumulate this overhead. Single-await middlewares (Session's `driver.load`, Auth's `req.user` resolution) appear cheap because they only pay it once.

**This is Vite's pipeline design, not RudderJS overhead.** It does not affect prod throughput. It does mean dev-mode latency is structurally higher than prod — relevant for DX expectations but not actionable from our side.

---

## Why this audit is a no-go

- **Prod chain total is ~0.1 ms.** Below the noise floor of any meaningful workload. Even if we cut middleware time by 50%, the user-visible win is 50 µs per request.
- **Each individual middleware is already lean.** Re-reading the source: RateLimit does 2 awaits + 3 header writes; CsrfMiddleware does 1 cookie parse + maybe 1 token generation; Session does 1 driver.load + ALS wrap; Auth does 1 user resolution. None is doing wasted work in the steady state.
- **The biggest single contributor (CsrfMiddleware at 50 µs) is doing real work** — parsing cookies + generating a token on cookieless requests. Caching that or eliding it would change behavior, not just perf.

---

## What to take away for future perf audits

1. **Always benchmark in prod mode.** Dev numbers can be off by 10–350× because of Vite SSR pipeline overhead. The earlier playground cold-boot work hit the same trap before we switched to `node dist/server/index.mjs`.
2. **`await` cost is not free in dev.** Multi-await async code in middleware/providers may show large dev-mode timing variance that isn't representative. This is a measurement-methodology rule, not a code-design rule.
3. **The middleware layer is fine.** Future perf questions should look elsewhere — view rendering (`renderPage` is 1.1–2.5 ms in this bench), provider boot (~140 ms, already audited), bundle parse (~50 ms, mostly external dependencies).

## Reusable artifacts

The per-middleware timing patch in `packages/server-hono/src/index.ts` is reverted but trivial to reapply if a real lead appears. The patch wraps the existing `next()` recursion with a `lastT` timestamp + a `mwTimings` array, printed alongside the aggregate `[perf] req middleware` line. ~15 lines.
