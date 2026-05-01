# Horizon + Pulse — View Migration Plan

**Status:** Locked 2026-05-01, ready to execute
**Scope:** Migrate `@rudderjs/horizon` and `@rudderjs/pulse` UI to the canonical package-UI shape (`views/<framework>/` + `registerXRoutes()`), exercise both end-to-end in playground, ship `/docs/packages/{horizon,pulse}.md`.

## Why now

Both packages are 1.0-graduated but never end-to-end-tested by Suleiman, and both ship the *old* UI shape — a `src/ui/{layout,pages}.ts` pair returning raw HTML-string templates. The canonical shape (set by `@rudderjs/auth` and confirmed by the telescope refresh) is `src/views/<framework>/` + `src/routes.ts` exporting `register*Routes()`. Documenting horizon/pulse as-is would freeze the wrong shape into the docs and trap us into a v2 refresh later — exactly the trap the telescope refresh had to undo.

## Current vs. target shape

| Aspect | Current (horizon, pulse) | Target (telescope-canonical) |
|---|---|---|
| UI location | `src/ui/{layout,pages}.ts` | `src/views/vanilla/{Layout,Dashboard,…}.ts` |
| Page granularity | One `pages.ts` exporting `dashboardPage()`, `recentJobsPage()`, etc. | One file per page (`Dashboard.ts`, `RecentJobs.ts`, …) |
| HTML escaping | Raw template literals — no auto-escape | `html\`\`` tag from `@rudderjs/view` |
| Route registration | UI routes inline in `src/api/routes.ts` (mixed with API handlers) | Split: `src/routes.ts` exports `register*Routes()`; `src/api/routes.ts` keeps handler implementations only |
| Provider boot | `await registerRoutes(storage, config)` | `await registerHorizonRoutes(router, { path, auth, middleware })` |

Telescope is the working reference — clone its `views/vanilla/_html.ts` + `Layout.ts` shape verbatim.

## Decisions (locked)

1. **One PR per package, not bundled.** Horizon first, pulse second. They're similar enough that the second PR is mostly mechanical, but bundling doubles the review surface and makes bisecting a regression harder. Same precedent as the per-package 1.0 graduation cut.
2. **Strict 1:1 port, no design refresh.** Existing pages render today; the migration is structural only. Any visual refresh (richer queue timeline, real-time worker memory chart) is a *separate* PR after the port lands. This is the lesson from telescope's 3-pass cycle.
3. **Vanilla framework only.** Match telescope. Per `feedback_react_only_default_for_packages.md` and `feedback_package_ui_shape.md`, ship the framework most apps already have rendering tooling for. React/Vue/Solid only if asked.
4. **Keep Alpine.js + Tailwind CDN.** Both packages rely on `<script src="cdn.tailwindcss.com">` + `x-data` directives. Migrating to a build-time toolchain is out of scope — vanilla pages should stay zero-dep at install time.
5. **Auto-discovery stays.** Both have `rudderjs.provider` entries today; keep them. The migration is internal — `bootstrap/providers.ts` shouldn't need to change in any consuming app.
6. **Pulse: rename `aggregators/` → `recorders/`.** Laravel Pulse uses `Recorders` for the listen-and-record classes; "aggregation" is the storage strategy (pre-bucketed), not a directory name. Our current `aggregators/` is the odd one out — the classes literally listen to events and call `record()`. Single rename PR bundled into the pulse migration. Horizon keeps `collectors/` (Laravel's Horizon uses `Repositories` + Supervisor/Worker, which doesn't port cleanly to our Redis-less storage; `collectors/` matches our internal telescope convention).
7. **URL prefix: `/horizon` and `/pulse` in playground.** Match telescope's `/telescope`. Both `registerHorizonRoutes` / `registerPulseRoutes` accept a `path` option for user override (mirror `registerTelescopeRoutes({ path })`).
8. **Test fidelity: real BullMQ + `pnpm rudder queue:work` for horizon.** Sync driver would dispatch inline and the worker collector would only ever report the request process — inauthentic. Horizon's identity is the dashboard for a real worker daemon (Laravel's `php artisan horizon`); demo it that way. Document both pieces in `/test/horizon` so users see the full loop: web request dispatches → worker process picks up → workers/jobs/metrics pages populate live. Pulse is fine with sync driver since recorders fire on web requests directly.

## Phases (per package)

1. **Mirror telescope's directory shape.** Move `src/ui/layout.ts` → `src/views/vanilla/Layout.ts`; split `src/ui/pages.ts` into one file per page; copy telescope's `_html.ts` (auto-escape helper).
2. **Replace raw template literals with `html\`\`` tag.** Audit every interpolation — current code does e.g. `${title}` directly; XSS-safe only because the inputs are static. Switch to the tagged template so the package is safe even if future contributors interpolate user data.
3. **Extract `src/routes.ts`.** Pull UI route registration out of `src/api/routes.ts`; export `registerHorizonRoutes(router, opts)` mirroring `registerTelescopeRoutes()`. API handlers stay in `src/api/routes.ts`.
4. **Wire provider to new registration.** `index.ts` calls `registerHorizonRoutes(router, { path, auth, middleware })` from boot().
5. **Playground exercise.** Add a `/test/horizon` route that dispatches a few jobs across queues so all three collectors (job/metrics/worker) populate. Sync driver is fine — the worker collector reports the *current process* as a worker either way.
6. **Browser verify.** Hit `/horizon`, `/horizon/jobs/recent`, `/horizon/jobs/failed`, `/horizon/queues`, `/horizon/workers`. Trigger `/test/horizon` between checks. Confirm shapes are right and pages render.
7. **Docs.** `docs/packages/horizon.md` (mirror sanctum/socialite tone, ~150-180 lines), VitePress sidebar entry, packages/index.md bullet, sync to rudderjs-com (4-step sweep per `project_rudderjs_com_docs_sync.md`).
8. **Boost guidelines refresh.** `packages/horizon/boost/guidelines.md` already exists — update if any imports/exports shift in the migration.

Then repeat for pulse — its UI is `src/ui/{dashboard,layout}.ts` (only two files, smaller surface than horizon).

## Out of scope

- Persistent driver for pennant (separate concern — see `project_horizon_pulse_pennant_untested.md`)
- Telescope ↔ horizon overlap analysis. Telescope's job collector already records dispatch/process events. Horizon's job collector records full lifecycle for a *different* dashboard. They coexist; no consolidation in this PR.
- Multi-framework view shipping. Vanilla only.
- Design refresh — strict 1:1 port.

## Open questions

All resolved 2026-05-01 — see Decisions #6, #7, #8.

## References

- Reference shape: `packages/telescope/src/views/vanilla/`, `packages/telescope/src/routes.ts`
- Memory: `feedback_package_ui_shape.md`, `project_telescope_parity.md`, `project_horizon_pulse_pennant_untested.md`, `feedback_react_only_default_for_packages.md`
- Telescope refresh history (3 passes, all the design lessons): `reference_telescope_refresh_plan.md` in memory
- Pennant playground exercise (the immediately previous "ship + docs" cycle): playground PR #140, framework docs branch `docs/add-pennant-package`
