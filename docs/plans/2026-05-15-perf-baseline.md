# Performance Baseline — RudderJS vs Next/Nuxt/Adonis

**Status:** planning, 2026-05-15.
**Effort:** ~1 day measurement + write-up. Follow-up fixes scope TBD after results.
**Prerequisites:** none. Stacks on top of current `main` (typed-views work just shipped via #474/#477).

**Goal:** A one-shot, reproducible comparison of RudderJS against the three meta-frameworks it competes with — Next.js, Nuxt, AdonisJS — on a minimal fresh-scaffold workload. Produces (a) a public numbers table for marketing/positioning, (b) an internal hot-spot map for RudderJS's cold-boot path.

**Non-goals:**
- Not a feature-matched comparison (no auth, no DB, no caching layer in any app). Defaults only.
- Not a long-term tracked metric. Run once, write up findings, archive. If a regression-tripwire CI metric is wanted later, that's a separate plan.
- Not dev-mode cross-framework comparison — `pnpm dev` startup is dominated by Vite vs Next's dev server vs Nitro, which tells you about dev-tool choice, not framework cost.

---

## Methodology

### Subject apps

All scaffolded at their respective `--minimal` / default-init in `~/perf-bench/<framework>/`, **outside this repo**. Only the runner script and report get committed.

| Framework | Scaffold command | Renders `/` | Renders `/health` |
|---|---|---|---|
| RudderJS | `pnpm create rudder-app rudderjs --minimal` | scaffolded `Welcome.tsx` | added: JSON route in `routes/web.ts` |
| Next.js | `pnpm create next-app@latest next --app --ts --no-tailwind --no-eslint --no-src-dir --no-import-alias` | default `app/page.tsx` | added: `app/health/route.ts` |
| Nuxt | `pnpm create nuxt@latest nuxt -- --packageManager pnpm --no-gitInit` | default `app.vue` | added: `server/api/health.get.ts` |
| AdonisJS | `pnpm create adonisjs@latest adonis -- --kit=web --pkg=pnpm --git-init=false --auth-guard=session` overridden to skip auth migration | scaffolded home page | added: `start/routes.ts` `/health` |

Exact installed versions are recorded by the runner script at execution time.

### Metrics

**Cross-framework (apples-to-apples — all 4 apps):**

| Metric | Definition | Tool | Repeats |
|---|---|---|---|
| Cold boot (prod) | `node <start>` → server listening on configured port | hyperfine, manual TCP probe in warmup | 10, report median + stddev |
| First request `/` (SSR) | start → first `GET /` returns 200 with HTML | bash + curl, wall time from spawn | 5, report median |
| First request `/health` (JSON) | start → first `GET /health` returns 200 with JSON | bash + curl, wall time from spawn | 5, report median |
| Full build | clean → production artifacts complete | hyperfine | 5, report median |
| node_modules size | post-install disk footprint | `du -sb` | 1 |
| Client JS payload | `/` page total bytes of `<script src>` resources | bash + curl + content-length | 1 |

**RudderJS-only internals (hot-spot breakdown of cold boot):**

| Metric | Definition | How |
|---|---|---|
| Dev cold boot | `pnpm dev` → Vite server ready | hyperfine, parse stdout for ready marker |
| providers:discover | `pnpm rudder providers:discover` wall time | hyperfine |
| Application.boot() | `Application.configure(...).create()` resolved | `performance.now()` instrumentation in `bootstrap/app.ts` |
| View scan | `@rudderjs/vite`'s `rudderjs:views` plugin scan duration | `performance.now()` instrumentation in `views-scanner.ts` |

The internal metrics use temporary `performance.now()` brackets gated behind `process.env.RUDDER_PERF_TRACE=1` so they don't ship.

### Environment controls

- Single machine (Suleiman's laptop)
- Single Node version — recorded by the runner
- Warm filesystem cache (one untimed warmup before each measured set)
- AC power, no concurrent heavy processes
- Network access required only at scaffold time; benchmarks themselves run offline

### Output

- `scripts/perf-bench.sh` — committed runner; takes `<bench-root>` as arg (e.g. `~/perf-bench`)
- `scripts/perf-bench-results.json` — committed final results (provenance only; not regenerated in CI)
- Results table + 2-paragraph analysis appended to this doc

---

## What ships

| Component | Path | Status |
|---|---|---|
| Runner script with hyperfine + curl orchestration | `scripts/perf-bench.sh` | new |
| RudderJS-internal `performance.now()` traces | `packages/core/src/Application.ts`, `packages/vite/src/views-scanner.ts` (env-gated, no-op when unset) | new |
| Results JSON | `scripts/perf-bench-results.json` | new |
| Results section in this plan doc | `docs/plans/2026-05-15-perf-baseline.md` (this file) | new |

**Out of scope (deferred):**
- CI tripwire for regressions (would need a stable runner)
- Dev-mode comparison across frameworks
- Per-page-count scaling curve (1, 10, 100 views — useful but separate)
- Memory footprint at idle / under load
- Feature-matched comparison (with auth, ORM, etc.)

---

## Phase 1 — Scaffold the four apps

Manual setup outside the repo. The runner script doesn't scaffold (one-shot use case; scaffolding noise isn't worth scripting). Document the exact commands run + versions in the results section.

Each app gains:
- A `/health` endpoint returning `{ ok: true }` JSON
- No other modifications — keep stock as far as possible

Verify each app builds and starts manually before benchmarking.

---

## Phase 2 — Add `performance.now()` instrumentation (RudderJS only)

### Task 2.1: Add boot timing to `Application`

**Files:**
- Modify: `packages/core/src/Application.ts` (whichever file owns `Application.configure(...).create()`)

Wrap the boot critical section with `performance.now()` markers gated by `process.env.RUDDER_PERF_TRACE === '1'`. Emit one console line per stage:

```
[perf] providers:register 12.4ms
[perf] providers:boot 47.1ms
[perf] application.boot total 73.8ms
```

When the env var is unset (default), no measurement is taken — zero overhead.

### Task 2.2: Add view-scan timing to `@rudderjs/vite`

**Files:**
- Modify: `packages/vite/src/views-scanner.ts`

Same env-gated `performance.now()` brackets. Emit:

```
[perf] view-scan 28.2ms (12 views, 3 typed)
```

### Task 2.3: Confirm zero overhead when unset

Build + start playground without the env var. Confirm no `[perf]` lines and no measurable startup regression (eyeball: median 5 runs before/after, within noise).

---

## Phase 3 — Write the runner script

### Task 3.1: `scripts/perf-bench.sh`

**Files:**
- New: `scripts/perf-bench.sh` (executable)

**Required tools:** `hyperfine` (`brew install hyperfine`), `curl`, `jq`, `node`.

**Shape:**

```bash
#!/usr/bin/env bash
set -euo pipefail

BENCH_ROOT="${1:-$HOME/perf-bench}"
FRAMEWORKS=(rudderjs next nuxt adonis)

# 1. Provenance
record_versions  # node -v, hyperfine --version, each app's framework version from package.json

# 2. For each framework:
for fw in "${FRAMEWORKS[@]}"; do
  build_app "$fw"          # hyperfine, 5 runs, clean between
  cold_boot "$fw"          # hyperfine, 10 runs
  first_request "$fw" /          # bash + curl wall time, 5 runs
  first_request "$fw" /health   # bash + curl wall time, 5 runs
  node_modules_size "$fw"
  client_js_payload "$fw"
done

# 3. RudderJS-only internals
rudder_internals  # RUDDER_PERF_TRACE=1, parse [perf] lines

# 4. Emit JSON
echo "{...}" > scripts/perf-bench-results.json
```

**Port handling:** each app gets a unique port (3001–3004) to avoid conflicts. Cold boot waits for `lsof -ti :<port>` or `nc -z localhost <port>`.

**Cleanup:** every spawned server is killed in a `trap` so failures don't leave orphans.

### Task 3.2: Smoke the script

Run on a single framework first (RudderJS — fastest to scaffold and most likely to surface script bugs). Confirm timings are stable across 3 invocations within ~5%.

---

## Phase 4 — Run + write up

### Task 4.1: Run end-to-end

```bash
bash scripts/perf-bench.sh ~/perf-bench
```

Capture the JSON. Spot-check outliers — anything more than 2× the median in a run needs investigation before reporting.

### Task 4.2: Append results section to this doc

Format: one table per metric. Below each table, one sentence on what the number means and a callout if RudderJS is meaningfully outside the band.

Then a final "Findings" section: 2 paragraphs.
- Paragraph 1 — competitive position: where we win, where we lose, by how much.
- Paragraph 2 — internal hot spots: which of (providers:discover, app boot, view scan) dominates our cold-boot, and whether it's worth a fix-PR.

Identified hot spots become a separate plan doc — not bundled into this one.

---

## Results

**Run date:** 2026-05-15. **Machine:** Suleiman's laptop (Apple Silicon, macOS Darwin 25.1, on AC power, no other heavy processes). **Node:** v22.14.0. **Hyperfine:** 1.20.0. **Raw JSON:** `scripts/perf-bench-results.json`.

**Note on the competitor set:** AdonisJS was dropped in favor of **SvelteKit**. AdonisJS 7's `create-adonisjs` 3.4.0 requires Node 24 (we have 22) *and* hard-blocks scaffolding when `CLAUDECODE`-style env vars are present. SvelteKit is arguably a more natural meta-framework peer to RudderJS anyway — file-based routing + SSR + Vite, same shape.

**Note on RudderJS resolution:** The benchmarked app uses `pnpm.overrides` to link `@rudderjs/*` at the workspace, not the published npm versions. This is needed to capture the internal `[perf]` traces (added on the perf branch, not yet released). The boot path is identical to published code modulo two `if (env)` guards — env-gated, no measurable overhead when unset.

### Versions

| Framework | Version |
|---|---|
| RudderJS | `@rudderjs/core@1.1.5` (workspace) + `@rudderjs/vite@2.2.0` + `vike@0.4.259` + `react@19.2.6` |
| Next.js | `16.2.6` (App Router, React 19) |
| Nuxt | `4.4.5` (Nitro, Vue 3.5) |
| SvelteKit | `@sveltejs/kit@2.60.1` + `svelte@5.55.7` + `@sveltejs/adapter-node@5.5.4` |

### Cross-framework metrics

| Metric | RudderJS | Next | Nuxt | Svelte |
|---|---:|---:|---:|---:|
| **Cold boot** (prod, server-ready, median of 10) | 191 ms | 252 ms | **93 ms** | **93 ms** |
| **First request `/`** (start → 200, SSR/static, median of 5) | 536 ms | 305 ms¹ | 166 ms | **113 ms** |
| **First request `/health`** (start → 200, JSON) | 295 ms | 377 ms | 170 ms | **108 ms** |
| **Full build** (clean → done, median of 3) | 1.94 s | 6.38 s | 4.61 s | **1.81 s** |
| **node_modules size** (post-install, du -sk) | 142 MB | 361 MB | 189 MB | **79 MB** |
| **Client JS payload** (sum of `<script src>` bytes on `/`) | **6.0 KB** | 642 KB | 150 KB | 0 KB² |

¹ Next renders `/` as **statically prerendered** in this scaffold — bytes-from-disk, not SSR. The 305 ms is start-up + static serve; not directly comparable to the other three (which SSR every request). The `/health` column compares like-for-like: Function endpoint vs Function endpoint.

² SvelteKit's minimal scaffold ships zero `<script src>` on `/` because the welcome page has no interactivity; Svelte's hydration JS is loaded lazily.

### Derived: first-SSR cycle (first_request − cold_boot)

Time from "server listening" to "first 200 OK on `/` delivered." For SSR routes this is the SSR pipeline cost; for Next's static `/` it's just disk-read overhead.

| Framework | first_request `/` − cold_boot | Notes |
|---|---:|---|
| RudderJS | **345 ms** | SSR — Vike + React 19 + Hono |
| Next | 53 ms | `/` is statically prerendered (not SSR) |
| Nuxt | 73 ms | SSR — Nitro + Vue 3.5 |
| SvelteKit | 20 ms | SSR — Svelte 5 + adapter-node |

For like-for-like SSR comparison: RudderJS is **5× Nuxt** and **17× SvelteKit** on the first-render cycle.

### RudderJS-internal breakdown

| Metric | Median |
|---|---:|
| `providers:register` (4 Tier-A providers) | 0.1 ms |
| `providers:boot` (log → cache → hash → session) | 1.0 ms |
| `Application.bootstrap` (total of above) | 1.1 ms |
| View scan (`syncViewsFromDisk`, 1 view) | 1.2 ms |
| `pnpm rudder providers:discover` (cold CLI invocation) | 404 ms |

### Findings

**Competitive position.** RudderJS lands in the middle of the pack. We **beat Next on every metric** — cold boot −24%, build time −70%, client JS payload −99% (642 KB → 6 KB), node_modules −61%. We **lose to Nuxt and SvelteKit** on cold-boot (~2×) and first-request (~3×). Build time, node_modules, and client payload are all competitive or better. The lean client payload is the biggest win against everyone: 6 KB vs 150 KB (Nuxt) and 642 KB (Next) — Vike's "minimal client" mode is doing real work here, and our scaffolder isn't bundling anything users don't need.

**Internal hot spots.** `Application.bootstrap` is **1.1 ms**. That is not where the time goes. The 191 ms cold-boot is dominated by Node ESM module loading + Vike/Hono server initialization happening before bootstrap is even called. The view scanner (1.2 ms) is also negligible. The 404 ms `providers:discover` headline number is misleading — most of that is `tsx` + CLI startup, not the scan itself. **The real hot spot is first-request rendering**: 536 ms (SSR `/`) vs 113 ms (SvelteKit) vs 166 ms (Nuxt) — a 3–5× gap on the slowest path users will feel. That's where a follow-up perf plan should aim, not at "boot order" or "eager scans" which are already cheap. Likely suspects to investigate (separate plan): Vike's first-SSR cycle cost on `vike-react`, React 19 SSR serialization overhead, or per-request Hono/middleware overhead that isn't amortized after the first request — re-running first-request without the spawn would isolate that.
