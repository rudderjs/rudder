# Cold-boot audit — where the 165 ms goes

**Status:** Phase 1 + Phase 2 done, 2026-05-17. Conclusion: nothing to ship — the lever Phase 1 picked turned out to be a no-op in prod, and Phase 2's deeper measurement showed cold-boot lives in a different code path than expected.
**Effort:** ~45 min Phase 1 measurement + ~30 min Phase 2 measurement + lever-B experiment.
**Prerequisites:** none. Stacks on `main` (current head dc764a2c).

**Goal:** Map cold-boot end-to-end against per-phase cost so any "make boot faster" lever can be picked from data, not inspection. Follow-up to the MCP runtime-subpath win (#484, ~50 ms saved) — answer whether the same pattern is worth replicating elsewhere.

**Non-goals:** Not a regression-tripwire metric. Not a fix plan in itself — fix scope is decided after the user picks which lever (if any) to ship.

---

## Methodology

Measurements run on Suleiman's laptop, Node 22.14.0, warm filesystem cache. Subject app: `/Users/sleman/perf-bench/rudderjs/` (minimal scaffold — 14 framework packages, 4 booting providers: `log`, `cache`, `hash`, `session` + `AppServiceProvider`). The playground (23 providers) was attempted but its prod bundle currently crashes on Pennant — known [[playground-pennant-boot-bug]], not in scope here.

Three benches, all 5–8 fresh `node` processes per data point:

1. `/tmp/rudder-perf/bench-cold-boot.mjs` — spawn `node dist/server/index.mjs`, wait for `[RudderJS] ready` log
2. `/tmp/rudder-perf/preload-checkpoints.cjs` (via `NODE_OPTIONS=--require`) — emits process-uptime checkpoints at `preload-start`, `preload-done`, `listening-on`, `[RudderJS] ready`
3. `/tmp/rudder-perf/bench-imports.mjs` — full process spawn per import; subtracts empty-baseline to attribute marginal cost per package

`RUDDER_PERF_TRACE=1` reused for the in-process `application.bootstrap` breakdown.

---

## Findings

### End-to-end cold-boot — 165 ms median

```
run 1: 233.9ms  (cold disk)
run 2: 167.6ms
run 3: 165.3ms
run 4: 164.5ms
run 5: 164.3ms

min:    164.3ms  median: 165.3ms  max: 233.9ms (first run, FS cache warming)
```

### Phase breakdown — provider boot is 4 % of the total

From `preload-checkpoints.cjs`:

| Phase | t (ms since node start) | Δ |
|---|---:|---:|
| `preload-start` | 9.6 | +9.6 (V8 + Node startup) |
| `preload-done` | 9.8 | +0.3 |
| `listening-on` | 172.7 | **+162.9** (module load + execute) |
| `[RudderJS] ready` | 179.3 | +6.7 (provider register + boot + loaders) |

From `RUDDER_PERF_TRACE=1`:
```
[perf] providers:register 0.1ms
[perf] providers:boot 1.8ms
[perf] application.bootstrap total 1.8ms
```

**99 % of the gap is module-load + top-level execution of the prod bundle, not framework boot logic.** Application.bootstrap is 1.8 ms even when warmed up. This matches and reaffirms [[perf-baseline-findings]] — bootstrap is not the hot spot.

### Per-import marginal cost (vs empty `node -e ''` baseline 22.5 ms)

| Import | min | median | max | Δ from baseline |
|---|---:|---:|---:|---:|
| `(baseline empty)` | 21.9 | **22.5** | 23.6 | — |
| `node:fs` | 24.4 | 25.0 | 25.3 | +2.5 |
| `node:http` | 35.9 | 36.3 | 36.6 | +13.9 |
| `node:http2` | 28.6 | 28.9 | 29.0 | +6.5 |
| `node:crypto` | 25.1 | 25.7 | 26.0 | +3.3 |
| `node:async_hooks` | 23.0 | 23.6 | 24.2 | +1.2 |
| `reflect-metadata` | 33.2 | 33.7 | 35.7 | +11.3 |
| `dotenv/config` | 30.0 | 30.8 | 33.7 | +8.4 |
| `zod` | 44.5 | 45.1 | 52.4 | **+22.7** |
| `vike/server` | 86.9 | 87.4 | 101.6 | **+65.0** |
| `@rudderjs/core` | 55.9 | 57.3 | 65.7 | +34.9 |
| `@rudderjs/server-hono` | 48.2 | 49.2 | 60.2 | +26.7 |
| `@rudderjs/vite` | 27.1 | 27.8 | 30.2 | +5.3 |
| `dist/server/entry.mjs` (full bundle) | 165.3 | 168.7 | 195.6 | +146.2 |

Notes:
- `hono`, `@hono/node-server`, `@prisma/client` failed direct resolution from a node `-e` context (workspace strict resolution). Their cost is folded into the package that imports them (`@rudderjs/server-hono`, `@rudderjs/orm-prisma`).
- Costs overlap. Importing `@rudderjs/core` already pulls `zod` + `reflect-metadata`, so the 35 ms `@rudderjs/core` Δ counts zod inside it. Naive sum overstates total.
- `vike/server` (65 ms) is the single biggest peer but is **already prewarmed** in parallel — `@rudderjs/view`'s `prewarmVikeServer()` is fire-and-forget from `@rudderjs/server-hono`'s module-load. Its cost overlaps with the rest of bootstrap and is not on the serial critical path.

### Where the 163 ms of module-load actually lives

For the minimal scaffold's prod bundle (`dist/server/entry.mjs`, 304 KB):

| Contributor | Approximate share |
|---|---:|
| Node + V8 startup floor | 22 ms |
| Parse 304 KB bundle | ~5 ms (mostly hidden under exec) |
| `reflect-metadata` + `dotenv/config` (sequential at top of bundle) | ~20 ms |
| `zod` (loaded via `@rudderjs/core`'s validation re-export) | ~20 ms |
| `hono` + `@hono/node-server` (via `@rudderjs/server-hono`) | ~25 ms |
| `node:http` / `node:http2` (server bind path) | ~15 ms |
| Framework top-level code (provider classes, route registry, DI setup) | ~25 ms |
| **`vike/server` (65 ms — parallel, overlapped)** | — (not on serial path) |
| Server-hono `serve()` bind + `Listening on` log | ~5 ms |
| Provider register + boot + loaders | 7 ms |

These numbers are approximate — they're the residuals from a parallel critical path. The single-import benchmarks set upper bounds.

---

## Levers, ranked by likely return

### A. Audit barrels for MCP-subpath splits (highest leverage)

The MCP win (#484) shaved ~50 ms by moving `@modelcontextprotocol/sdk` off `@rudderjs/mcp`'s main barrel — apps that don't construct an MCP server skipped its load. Same pattern is applicable to any package whose main barrel re-exports a class that pulls a heavy peer apps may not use.

**Best candidate: `@rudderjs/core`.** Its barrel re-exports `z`, `ValidationError`, `FormRequest`, `validate`, `validateWith` from `./validation.js`, which top-level-imports `zod`. **Every** RudderJS app pays the 23 ms zod cost even if validation isn't invoked at boot. Splitting into `@rudderjs/core/validation` subpath would shave ~10–20 ms for apps that import only `Application`, `ServiceProvider`, `app()`, etc. from core.

**Cost of the split:** breaking API change for users of `import { z, FormRequest, validate } from '@rudderjs/core'`. Mitigation: keep the existing exports working until v2 and document the subpath as the recommended path. Or: just bite the major-version bullet on `@rudderjs/core` since it already has the cycle/peer-resolution disruption history.

**Decision bar:** worth shipping only if the playground (23 providers) shows ≥30 ms cold-boot delta from this change alone. Need to either fix Pennant or rebuild a realistic test app to measure.

**Other barrel candidates worth a 5-minute audit:**

- `@rudderjs/console` — does `import { rudder }` pull in the entire CLI dispatcher even outside command execution?
- `@rudderjs/auth` — does importing `AuthManager` pull the entire password-reset / email-verification code path?
- `@rudderjs/passport` — does importing `RequireBearer` pull the full OAuth2 grant machinery?
- `@rudderjs/orm` — base Model already lazy; check if `JsonResource`, `Factory`, etc. on the barrel pull anything heavy.

Each of these is a "look at the barrel, look at what it transitively pulls, decide if the heavy bits can move to a subpath" exercise. Likely 1–2 wins of ~10–20 ms each. None individually huge; together they could meaningfully push cold-boot below 150 ms.

### B. Parallelize `defaultProviders()` peer imports

`packages/core/src/default-providers.ts:94` loops over manifest entries and `await resolveOptionalPeer()`s each one in series. Could be `Promise.all` over the entries with rebuild of the loaded[] order. **Cost: ~50 lines of code.**

**Expected win:** small in the minimal scaffold (4 providers, mostly transitively loaded already). In a realistic app with 23 providers, possibly 10–30 ms — but most providers' transitive deps overlap, so the marginal serial-vs-parallel gap is real but bounded.

**Decision bar:** safe to ship if measurement confirms ≥10 ms in a real app. No public API impact. Probably worth doing regardless if the parallel implementation stays clean.

### C. Replace `dotenv/config` with a 30-line in-house env loader

`dotenv/config` costs 8 ms at boot. The full dotenv feature surface is unnecessary — RudderJS only uses `.env` file → `process.env` assignment with comment + variable-expansion support. Could be replaced with a small loader in `@rudderjs/support`.

**Decision bar:** marginal, not recommended. 8 ms isn't worth the maintenance + edge-case risk (variable interpolation, dotenv-expand patterns users may rely on).

### D. Things NOT worth pursuing

- **Defer `reflect-metadata`** — deeply integrated with DI (`@Injectable`, `@Inject`, `@Tag`); can't move off the boot path without breaking decorators.
- **Smaller framework bundles via aggressive tree-shaking** — Vite already does this; the 304 KB entry.mjs is mostly used code.
- **Skip `vike/server`** — already lazy-loaded behind `prewarmVikeServer()`; its cost overlaps with the rest of bootstrap and is not on the serial critical path.
- **Faster provider register/boot logic** — 0.1 ms + 1.8 ms; below the noise floor.

---

## Recommended Phase 2

Two-step bar:

1. **Fix the playground Pennant bug** OR build a "realistic" test scaffold with 15+ providers installed (auth, orm-prisma, mail, queue, broadcast, telescope, pulse, horizon, etc.). Without a realistic test app, every "this would save 20 ms" estimate is extrapolation.

2. **Audit `@rudderjs/core` barrel** for the validation subpath split. If a realistic app shows ≥30 ms saved by hiding zod behind the subpath, ship it as a major bump. If not, drop it — the breaking-change cost dwarfs the win.

If the user wants a quick win that's hard to regret, **lever B (parallelize default-providers)** is the safe play — no public API impact, scales positively with provider count, drops in as a 50-line patch. Measure in a realistic app first.

---

## Phase 2 — results

### Realistic test app

Got the playground booting in prod by skipping `@rudderjs/pennant` (its [[playground-pennant-boot-bug]] is unrelated to cold-boot work) and adding a `passwords.secret` to the auth controller's `PasswordBroker` constructor. **22 framework providers booting** — auth, orm-prisma, ai, mcp, mail, queue, telescope, pulse, horizon, etc.

### Realistic baseline

```
8 runs, prod build, warm FS cache, playground:
min:    566.5ms  median: 580.4ms  mean: 595.0ms  max: 731.9ms (cold disk)
```

So a realistic 22-provider app cold-boots in **580 ms median** — 3.5× slower than the minimal scaffold's 165 ms.

### Where the 580 ms actually goes — the structural surprise

Re-running the `--require` preload checkpoints against the playground prod bundle revealed a different structure than the minimal scaffold:

```
preload-start                t=7.7ms   (+7.7ms — V8 + Node startup)
preload-done                 t=8.0ms   (+0.2ms)
listening-on                 t=26.1ms  (+18.1ms — server-hono import + serve())
rudderjs-ready               t=565.1ms (+539.0ms — first-request lazy app boot)
```

**The HTTP port opens at t=26 ms — much earlier than the minimal scaffold suggested.** The playground's prod entry (`dist/server/index.mjs`) defers ALL app construction (`bootstrap/app.ts` evaluation, provider register/boot, route-loader execution) to the first incoming request. The 539 ms gap from "Listening on" to "ready" is *first-request lazy boot*, not module load. It only runs after a request comes in to trigger it.

The minimal scaffold didn't show this because it doesn't use the deferred-app pattern — its prod entry evaluates `bootstrap/app.ts` synchronously at process start.

Breakdown of the 539 ms first-request gap:
- App entry chunk dynamic-import + parse: ~50–100 ms
- `bootstrap/app.ts` + `providers.ts` evaluation: ~50 ms
- `Application.bootstrap()`: 146–272 ms (mostly `providers:boot` — 22 framework `boot()` methods, ~13 ms average)
- 4 route-loader dynamic-imports (web/api/console/channels) + their eval: ~150 ms
- First Vike SSR render: ~40 ms

### Lever B (parallelize `defaultProviders()`) — implemented, measured, reverted

Replaced the serial `for (const entry of entries) { await resolveOptionalPeer(...) }` with `Promise.all(candidates.map(...))`, preserving order through the result array. Rebuilt @rudderjs/core, rebuilt the playground, re-measured:

```
8 runs after lever B:
min: 564ms  median: 582ms  mean: 594ms  max: 709ms

Δ from baseline: -2ms median (well within noise).
```

**No measurable gain.** Why: in a prod bundle, all framework provider modules are inlined into the entry chunk. `resolveOptionalPeer()` finds them already-loaded — the serial `await` was effectively `Promise.resolve()` per iteration. Parallelization had nothing to parallelize.

Reverted. The change might still help in dev mode where Vite loads modules on demand, but dev cold-start is a separate concern (Vite's pipeline dominates) and we weren't measuring it.

### Lever A (split `@rudderjs/core` validation barrel) — not attempted, reasoning

Same logic applies. In a bundled prod build, Vite inlines whatever's imported anywhere in the app. The playground has `FormRequest` use across multiple controllers; those controllers' chunks already pull `zod` regardless of whether `@rudderjs/core`'s main barrel re-exports it. Splitting the barrel would only help if (a) the user is careful to import from the subpath, (b) zod could be confined to a chunk that loads only on routes that validate. In practice that's a coordinated multi-package refactor for a speculative win.

Skipped without implementation. If we revisit, the bar is: prove a chunk-level reduction in a realistic app before changing public API.

---

## What we now know with confidence

- Cold-boot for a minimal RudderJS scaffold is **~165 ms** end-to-end; for a realistic 22-provider app, **~580 ms**.
- The minimal-scaffold and realistic-app prod entry shapes differ structurally. The minimal scaffold evaluates `bootstrap/app.ts` eagerly; the playground defers it to first request. Only ~26 ms is "process-start" cost in the realistic app — the rest is *first-request lazy boot*.
- **Provider boot logic IS significant at scale**: 146–272 ms in the 22-provider playground, vs 1.8 ms in the 4-provider minimal scaffold. This is the largest portion of the gap.
- **Parallelizing imports doesn't help in prod bundles** — the bundling step has already resolved everything; `await import()` is a microtask.
- **The MCP subpath pattern (~50 ms win) worked because** it removed code from the *bundle*, not because it parallelized loading. Replicating it requires identifying packages whose heavy transitive deps are reachable only through paths apps frequently don't take — which is unusual in framework code.

### Real levers for the realistic-app 580 ms (not pursued — each is a meaningful change)

1. **Reduce per-provider `boot()` cost** — 22 providers × ~10 ms each. Audit each provider's `boot()` for unnecessary eager work (DB connection probes, config validation that could be lazy, etc.). Could shave 30–80 ms with a few targeted fixes. Per-provider, not a single change.

2. **Pre-evaluate the app at server start, not first request** — currently the playground's first request pays the full 539 ms latency hit. Eagerly evaluating `bootstrap/app.ts` at process start would shift this cost from "first user request" to "process startup", making first-request latency competitive without changing total work done. Better UX for scale-to-zero deploys (Fly.io, Cloud Run). Architectural change in how `dist/server/index.mjs` is generated by `@rudderjs/vite`.

3. **Parallel route loaders** — `RudderJS._bootstrapProviders()` runs the 4 loaders serially because of [[router-runWithGroup]] state. The serial cost is real (~150 ms). Could be parallel if router was redesigned to take group as an argument rather than a module-level variable.

4. **Smaller per-route chunks** — the 735 KB `chunk-BK3v1-3A.js` is parsed on first SSR. Splitting it per-route would lazy-load only the requested view's chunk. Significant DX/build change.

5. **Defer route-loader evaluation past `[RudderJS] ready`** — register routes on first request to each path instead of all-at-boot. Conflicts with how the current router mounts routes during phase 2 setup.

Each of these is a multi-day effort with real architectural impact. None are "quick wins."

## Conclusion — nothing to ship from this audit

The minimal scaffold's 165 ms cold-boot was already near the floor. The realistic playground's 580 ms has different bottlenecks than the minimal-scaffold data predicted, and none of the levers we identified in Phase 1 actually move the realistic number:

- Lever B: confirmed no-op in prod, reverted.
- Lever A: would require a multi-package refactor for a speculative win; structurally wouldn't change the bundled-prod path.
- Subpath-pattern audit (other barrels): same chunk-level reasoning — apps that actually use a feature pay the import cost regardless of barrel shape.

If the user wants to come back to this with a concrete cold-boot pain point (e.g. Cloud product scale-to-zero where 580 ms is a UX problem), the highest-leverage levers are #1 (per-provider `boot()` audit) and #2 (eager app construction at process start). Both need their own plan docs and were not within today's measurement scope.

## Reusable artifacts

Bench scripts live in `/tmp/rudder-perf/` (not committed — scratch). The reusable template is documented in [[perf-investigation-runbook]]; the new wrinkle this round is the `--require` preload checkpoint pattern for phase-level breakdown. Worth committing to the runbook template that **prod-bundle behavior diverges from per-import benchmarks** — bundling collapses serial-import cost into a single parse step.
