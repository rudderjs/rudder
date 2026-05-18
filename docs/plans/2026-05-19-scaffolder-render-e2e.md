# Scaffolder render E2E — Playwright across framework + profile matrix

**Status:** plan, 2026-05-19. Pickup task for a fresh session.
**Origin:** Suleiman's ask: "make sure a created Rudder app works, no matter react/vue/solid, no matter which packages were installed."
**Builds on:** [2026-05-18-ci-portability-matrix.md](2026-05-18-ci-portability-matrix.md) — Phases 1 (#530) + 2 (#531) shipped. This is the conceptual successor to that plan's Phase 3.

---

## Why this exists

Phase 2 (#531) ships an SSR-level smoke: `pnpm create rudder-app` → install → build → `node dist/server/index.mjs` → curl `/` → assert 200 + welcome marker. That catches scaffolder template drift, missing `exports`, and provider-boot regressions on the **default React profile** — but leaves three gaps:

1. **Framework drift.** vue/solid scaffold templates exist (`welcomeViewVue`, `welcomeViewSolid`, `+config.vue.ts`, etc.) but have never been booted in CI. They probably worked when they were written but may have rotted — vike-vue or vike-solid renderer integration, lazy peer resolution, framework-specific scanner output.
2. **Hydration.** SSR-200 says the server rendered HTML. It does not say the browser successfully executed the client bundle, hydrated the markup, and reached interactive state without throwing. A real user gets a broken page if hydration throws even if SSR is 200.
3. **Package-induced page surface.** Selecting `auth` adds `/login` `/register` `/forgot-password` to the scaffolded app. Selecting demos adds `/demos/contact` etc. Selecting `telescope`/`pulse`/`horizon` adds admin UIs. The current smoke only hits `/`. Routes added by selected packages have zero CI coverage.

## Goals

- **Framework coverage.** Boot the scaffolded app on react / vue / solid; assert each renders + hydrates `/` without errors.
- **Hydration coverage.** Headless browser (Playwright) loads each route, waits for `networkidle`, fails on any uncaught error or red console message.
- **Profile-derived test list.** The smoke knows what packages were selected; it auto-generates the route list to hit. No hand-maintained URL table per framework — one URL contributor per package.
- **Keep CI wall-clock reasonable.** 9 cells in parallel (3 frameworks × 3 profiles), each ~90s, total ~12-15 min.

## Non-goals

- **Not** every package combination. 25 optional packages = 33M permutations. We pick 3 representative profiles; full cross-product is mathematically infeasible.
- **Not** Playwright assertions for business logic (form validation, complex flows). v1 is "page renders + hydrates without errors." Adding flow assertions per route is a follow-up if the cheap version proves valuable.
- **Not** Windows scaffolder coverage. That's the previous plan doc's Phase 3 and stays deferred.
- **Not** mobile / multi-viewport / accessibility scans. Single chromium, default viewport, dom-loaded + networkidle, page errors + console errors. Anything more is scope.
- **Not** visual regression / screenshot diffing. Too noisy across framework variants; not the bug class we're chasing.

## Phases

### Phase 0 — Verify vue/solid scaffolds boot at all

Before writing matrix infrastructure, prove vue and solid scaffolds produce a bootable app today. Extend the existing `create-rudder-app/scripts/smoke.ts` to take a `--framework=vue|solid|react` flag (or env var) and run each one through the existing curl-based smoke path.

**Expected outcome:** at least one of vue/solid will fail. Fix the bugs as they surface (vike renderer install order, scanner output mismatch, view-template export shape). This phase ends when all three frameworks pass the existing curl smoke.

**Bug classes to expect, based on the architecture:**

- `@rudderjs/vite`'s view scanner is per-framework — auto-detects the installed `vike-*` renderer via lazy probe. If the probe regressed, vue/solid scaffolds may not generate `pages/__view/` correctly.
- Each framework template ships its own `welcomeView*()` output, `+config.<fw>.ts`, and `app/Views/Welcome.<ext>`. Drift between template + framework adapter can leave routes with no handler.
- `@rudderjs/auth` ships `views/react/` and `views/vue/` (no solid yet — see [feedback_react_only_default_for_packages](memory)). If auth is selected on a solid scaffold, the scaffolder may either fail or generate a broken `app/Views/Auth/` — establish today's behavior and document.

**Do NOT skip ahead** to Playwright until Phase 0 is green for all three frameworks. Adding browser coverage on top of a broken SSR pipeline produces noise, not signal.

### Phase 1 — Per-profile route manifest

Introduce a `getProfileRoutes(ctx: TemplateContext): RouteSpec[]` helper that, given a scaffolder profile, returns the URLs the smoke should hit. Each `RouteSpec` carries:

```ts
interface RouteSpec {
  path:         string                                // '/login'
  contributedBy: string                              // 'auth'  — for error messages
  ssrMarker?:   string                              // substring to assert in HTML
  requiresJs?:  boolean                              // skip Playwright if app is purely SSR
}
```

The contributor table lives next to the package's scaffolder fragment (or in a single registry in `create-rudder-app/src/templates/routes-manifest.ts` — the latter is simpler in v1). Example entries:

| Package selected | Routes contributed |
|---|---|
| (always) | `/` (Welcome) |
| `auth` | `/login`, `/register`, `/forgot-password` |
| `demos: ['contact']` | `/demos/contact` |
| `demos: ['todos']` | `/demos/todos` |
| `telescope` | `/telescope` (admin) |
| `pulse` | `/pulse` (admin) |
| `horizon` | `/horizon` (admin) |

**Open questions to settle in implementation:**

- Telescope/pulse/horizon admin pages may require auth. Are they accessible from an unauthenticated session in the scaffolded config defaults? If yes, hit them. If no, either (a) skip them in v1, or (b) seed an admin user before browsing.
- For the `demos-all` profile, the demos list is enumerated at scaffold time. The route manifest can read `ctx.demos` directly — no per-demo hand-coding.

### Phase 2 — Playwright wired into the smoke

Add `@playwright/test` as a `devDependency` of `create-rudder-app` (or a separate script package — see below). On the smoke's HTTP-boot step:

1. Boot `node ./dist/server/index.mjs` (existing).
2. Use the Playwright Node API directly — NOT the test runner. Just `chromium.launch()` → `browser.newPage()`.
3. For each route in `getProfileRoutes(ctx)`:
   - `page.goto(baseUrl + route.path, { waitUntil: 'networkidle' })`
   - Assert response status === 200 (or document expected 401/403 for protected routes).
   - If `route.ssrMarker`, assert it's in the HTML.
   - Fail on any `page.on('pageerror')` or `page.on('console', m => m.type() === 'error')` captured during the navigation.
4. Close browser, kill server, return aggregate result.

**Where the Playwright code lives:**

- **Option A — inside `create-rudder-app/scripts/smoke.ts`** (current location). Simple. But `smoke.ts` was already 350+ lines after Phase 2; adding Playwright pushes it past readability.
- **Option B — extract `scripts/render-check.ts`** alongside `smoke.ts`, called from the same `smoke` command. Cleaner separation, same lifecycle.

Recommendation: **Option B**. Smoke stays focused on "does it install + boot + serve"; render-check focuses on "do routes render + hydrate". Failure mode is distinguishable in CI logs.

**Browser install in CI:** add `npx playwright install --with-deps chromium` to the CI job. Adds ~30s + ~150MB per cell. Cache the browser binary across runs via `actions/cache` keyed on the Playwright version.

### Phase 3 — CI matrix (3 frameworks × 3 profiles = 9 cells)

Update `.github/workflows/ci.yml` `scaffolder-e2e` job from single-shot to a 9-cell matrix:

```yaml
scaffolder-e2e:
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false
    matrix:
      framework: [react, vue, solid]
      profile:   [minimal, default, heavy]
  # ... existing steps + Playwright install + smoke --framework=<f> --profile=<p>
```

`heavy` is the existing `demos-all` profile (with framework varied). `default` is the existing default. `minimal` is the existing minimal.

**Cost.** 9 cells in parallel. With the existing smoke timing (~20s default, ~12s minimal) + Playwright overhead (~3-5s setup + ~2s per route × ~5 routes default profile = ~15s) + browser-cache miss on first run (~30s install): expect ~60-90s per cell. ~12-15 min total wall-clock (parallel). Within the plan-doc-overall budget of ~10 min for CI; over-budget here is acceptable for the breadth gained.

**Caching note.** Each matrix cell does its own `pnpm install` in the temp dir. The Playwright browser cache should be hoisted to the runner (via `actions/cache`) keyed on Playwright version, not on the smoke-app's hash.

### Phase 4 — (deferred) Auth flow E2E

After Phase 3 stabilizes, add one flow-level test on the default profile only:

1. Browse to `/register`, fill form, submit.
2. Assert redirected to `/` (or `/dashboard` if scaffolder gains one).
3. Assert page shows the signed-in user (per Welcome.tsx auth-aware branch).
4. Browse to `/sign-out`, assert redirected to `/login`.

This catches form posting / session round-trip / CSRF cookie / Auth.user() integration — bugs invisible to the "page renders" check.

Don't ship Phase 4 in the same PR as Phase 3. It's a different bug class and adds flake surface (form network requests, redirects, timing).

## Risks

- **Vue/solid scaffolds are stale.** Likely real bugs surface in Phase 0. Treat them as in-scope for the Phase 0 PR; don't merge with red cells. May need 1–2 small framework-side fixes (changeset each).
- **Playwright flake.** `networkidle` is stricter than `domcontentloaded`; long-running websockets or HMR connections in dev mode can hold it open. We boot in prod mode (`NODE_ENV=production`, `node dist/server/index.mjs`) so HMR is gone — but watch for `/telescope` (which uses SSE) or any other long-poll endpoint blocking `networkidle`. If it's a problem, drop to `domcontentloaded` + an explicit `await page.waitForFunction(...)` per page.
- **Browser-install size.** Playwright chromium is ~150MB. With caching, only first run pays; subsequent runs hit cache. Worth flagging in PR body.
- **Hydration false positives.** Some packages may legitimately log dev warnings via `console.warn` that look like errors. We filter on `m.type() === 'error'` only, not warnings. Verify this once with `telescope`/`horizon` admin pages which may have noisy boot logs.
- **vue/solid view scanner gaps.** `@rudderjs/vite` auto-detects the renderer. If vue/solid integration was never tested end-to-end through the scaffolder + view scanner pipeline, expect bugs at scaffold-time, not just runtime.

## Success criteria

- All 9 matrix cells green on a PR.
- A regression that breaks the `vike-vue` integration fails the vue cells, not silently merges.
- A regression that breaks `/login` (auth views renaming a component, scaffolder import path drifting) fails the default cells across all frameworks.
- A scaffolded app's `/telescope` page renders without console errors when telescope is selected.
- Wall-clock for the `scaffolder-e2e` matrix job stays under ~15 min on a green PR.

## Sequencing

- **PR 1 — Phase 0:** vue/solid scaffolds boot under existing curl smoke. May ship 1–2 framework-side fixes alongside. Keep the matrix single-cell until this is green for all three frameworks.
- **PR 2 — Phases 1 + 2:** profile route manifest + Playwright integration. Still single-cell (default React) in CI until proven stable.
- **PR 3 — Phase 3:** flip on the 3×3 matrix. Should be the smallest of the three PRs once the prior work landed.
- **PR 4 (later) — Phase 4:** auth flow E2E. Separate session.

Sequencing reason: Phase 0 surfaces real bugs that need their own changesets. Bundling them with the Playwright work makes the diff unreviewable.

## Out-of-scope (do not bundle in this plan)

- Windows scaffolder coverage (previous plan doc's Phase 3).
- macOS runners.
- Mobile / multi-viewport / accessibility scans.
- Visual regression / screenshot diffing.
- Per-package isolation tests (one cell per package with everything else off). Too many cells; minimal/default/heavy already approximate the boundaries.
- Replacing the existing curl-based smoke with Playwright-only. Curl catches a different bug class (SSR-only) and is fast; keep both.
- Drizzle ORM variant. Current scaffolder profiles default to Prisma; add Drizzle to the matrix only after the Prisma matrix is stable.
