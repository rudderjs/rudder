# @rudderjs/pulse

## 6.3.2

### Patch Changes

- b043a12: Fix an infinite recursion in `ExceptionRecorder` that crashed the process on the first reported exception. The recorder captured `report` as the "previous" reporter, but `report` always dispatches to the current reporter (the recorder's own wrapper), so forwarding re-entered itself until the stack overflowed. It now chains to the reporter returned by `setExceptionReporter`, and the record step is wrapped so a storage error never breaks the reporter chain.
- Updated dependencies [b043a12]
  - @rudderjs/core@1.13.0

## 6.3.1

### Patch Changes

- aaad9ad: `vendor:publish` assets now resolve on Windows. Every provider registered its publish sources via `new URL(...).pathname`, which yields `/D:/...` on Windows (leading slash + percent-encoding) — so `vendor:publish --tag=auth-views` / `notification-schema` / `broadcast-client` / `cashier-*` / the boost guidelines all failed there with missing-source errors. Paths now convert via `fileURLToPath`. Surfaced by the new asset-on-disk test added with the sync-schema tag (#952), which went red on Windows CI.
- Updated dependencies [87783f7]
- Updated dependencies [da07742]
- Updated dependencies [be26c2b]
- Updated dependencies [437a4a2]
- Updated dependencies [bef393f]
- Updated dependencies [940406d]
  - @rudderjs/core@1.8.0
  - @rudderjs/orm@1.17.0
  - @rudderjs/contracts@1.13.0
  - @rudderjs/middleware@1.2.1

## 6.3.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [e199f5e]
- Updated dependencies [0e7db2c]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [0109afb]
- Updated dependencies [0dcecaf]
- Updated dependencies [363d942]
- Updated dependencies [12b4a55]
- Updated dependencies [4085846]
- Updated dependencies [6f8760d]
- Updated dependencies [083672b]
- Updated dependencies [8ba6e7d]
- Updated dependencies [b31d1be]
- Updated dependencies [0d6c280]
- Updated dependencies [3b995b7]
- Updated dependencies [5eb4dd8]
- Updated dependencies [536b64d]
- Updated dependencies [ea9b982]
- Updated dependencies [ad17e79]
- Updated dependencies [f6afdf8]
- Updated dependencies [e25472c]
- Updated dependencies [ca644ad]
- Updated dependencies [bf1cca0]
- Updated dependencies [bc76570]
- Updated dependencies [acc2245]
- Updated dependencies [0b085a6]
- Updated dependencies [468dcd4]
- Updated dependencies [ffbb7f7]
- Updated dependencies [b897950]
- Updated dependencies [caff11d]
- Updated dependencies [26b7acf]
- Updated dependencies [ea510e0]
- Updated dependencies [b08aa1d]
- Updated dependencies [6bd32b0]
- Updated dependencies [370d2ec]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [6e83e26]
- Updated dependencies [5617ec2]
- Updated dependencies [bb07d54]
- Updated dependencies [7b5d000]
- Updated dependencies [f1db9d9]
- Updated dependencies [a93455e]
- Updated dependencies [e9a3319]
- Updated dependencies [534bd8d]
  - @rudderjs/contracts@1.10.0
  - @rudderjs/orm@1.14.0
  - @rudderjs/cache@1.4.0
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/log@1.1.0
  - @rudderjs/middleware@1.2.0
  - @rudderjs/queue@4.3.0
  - @rudderjs/router@1.8.0

## 6.2.2

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1
  - @rudderjs/orm@1.12.10
  - @rudderjs/queue@4.2.2
  - @rudderjs/router@1.7.1

## 6.2.1

### Patch Changes

- 71997fa: Dev HMR: stop leaking storage connections, timers, and collector subscriptions on every re-bootstrap.

  The `telescope`, `pulse`, and `horizon` providers built their storage, prune/metrics timers, and collectors directly in `boot()` — which re-runs on every dev re-boot. Nothing tore down the previous set, so each `app/` edit leaked a storage connection (a new SQLite handle, or a new Redis connection on `horizon.storage: 'redis'` → `maxclients` exhaustion), a prune timer, the frequent collector/recorder stats timers (firing every 15–60s against stale storage), and re-subscribed every collector to its peer observer registry — accumulating duplicate dashboard entries per edit. Measured: telescope + pulse SQLite connections climbed monotonically `8 → 44` across 8 edits (the leaked storage is pinned by its still-running timers, so it never gets GC-reclaimed); with the fix it stays flat at one set.

  Each provider now builds its storage + timers + collectors **once per process**, cached on `globalThis`, and reuses them across re-boots. Routes and request/user middleware are still re-registered every boot (because `router.reset()` wipes them). No-op in production (single boot). Same root cause as the orm-prisma connection leak fixed in `@rudderjs/orm-prisma@2.0.1`.

- Updated dependencies [5852649]
  - @rudderjs/orm@1.12.1

## 6.2.0

### Minor Changes

- a3a7368: Phase 3 of `rudder doctor` — first wave of package-contributed checks.

  Thirteen framework packages now ship a `<package>/doctor` subpath whose
  side-effect import registers domain-specific health checks on the shared
  doctor registry. The CLI's lazy loader auto-imports them when
  `rudder doctor` runs.

  New checks (14 total, grouped by category):

  - **auth** — `auth:secret` (AUTH_SECRET set + length sane), `auth:views-vendored`
    (vendored when a frontend renderer is installed).
  - **auth** (cont.) — `session:secret` (SESSION_SECRET length when set), `hash:driver`
    (config string ∈ {bcrypt, argon2}; flags missing `argon2` peer).
  - **orm** — `orm-prisma:schema` (schema files present), `orm-prisma:client-generated`
    (mtime check vs schema), `orm-prisma:database-url`, `orm-drizzle:schema`,
    `orm-drizzle:database-url`.
  - **billing** — `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`
    (both conditional on a cashier route being mounted).
  - **queue** — `queue-bullmq:redis-url`, `queue-inngest:event-key`,
    `queue-inngest:signing-key`.
  - **ai** — `ai:provider-keys` (greps `config/ai.ts` for declared driver
    literals, then checks each cloud provider's API key env var).
  - **mcp** — `mcp:route-mounted` (if `app/Mcp/` has tools, mcp route is
    registered).
  - **monitoring** — `telescope:dashboard`, `pulse:dashboard`,
    `horizon:dashboard` (dashboard route reachable from `routes/web.ts`).

  Adding a new contributing package: ship a `<package>/doctor` subpath with
  side-effect `registerDoctorCheck` calls and append the package name to
  `PACKAGES_WITH_CHECKS` in `@rudderjs/cli/src/doctor/load-package-checks.ts`.

  Implementation notes:

  - The CLI's loader resolves doctor subpaths via direct path
    (`<cwd>/node_modules/<pkg>/dist/doctor.js`), not `createRequire.resolve`,
    because the `./doctor` exports condition is `import`-only (no `require`)
    and the strict-mode pnpm node_modules don't expose user-installed
    packages from the CLI's location. Documented as the ESM-only-peer
    resolution workaround.
  - `deps:auth-views` was removed from the CLI's built-in checks — the
    identical concern now lives at `auth:views-vendored` in
    `@rudderjs/auth/doctor`, where it belongs. Net check count for a user
    with `@rudderjs/auth` installed: same (one each); for a user without
    auth, doctor stays silent on the topic instead of saying "auth not
    installed — skip".

  No tests added in this phase — each check is small enough to be tested
  implicitly via integration smoke (the existing temp-dir test suite in
  `@rudderjs/cli`, plus a manual smoke against `playground/`). Per-package
  test suites for these checks may land in a follow-up.

  Phase 4 (`--deep`) and Phase 5 (`--fix`) follow in subsequent releases.

### Patch Changes

- Updated dependencies [b28e51f]
  - @rudderjs/console@1.1.0

## 6.1.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/cache@1.1.4
  - @rudderjs/contracts@1.6.1
  - @rudderjs/core@1.1.5
  - @rudderjs/log@1.0.3
  - @rudderjs/middleware@1.1.1
  - @rudderjs/orm@1.9.2
  - @rudderjs/queue@4.1.3
  - @rudderjs/router@1.2.1

## 6.1.2

### Patch Changes

- 4c24021: Guard JSON.parse on Redis/SQLite data and event serialization
- Updated dependencies [8e682a6]
  - @rudderjs/contracts@1.5.0

## 6.1.1

### Patch Changes

- f4863b4: Fix `SqliteStorage` cross-process loading — load `better-sqlite3` via `createRequire(import.meta.url)` (with the `globalThis.__betterSqlite3` escape hatch as a fallback) and enable WAL journal mode, mirroring `@rudderjs/telescope`.

  Surfaced by browser-verifying the queue-observer migration: with BullMQ + `storage: 'sqlite'`, the worker process and the dashboard process need to read/write the same `.pulse.db` concurrently for queue metrics to populate. Without WAL, the second process hits "database is locked"; without `createRequire`, the SQLite driver wouldn't load at all unless the host app pre-stashed `better-sqlite3` on `globalThis` — Pulse demanded `pnpm add better-sqlite3` even when it was already installed.

  After this fix, switching the playground (or any consuming app) to `storage: 'sqlite'` is enough to get cross-process Pulse metrics under BullMQ. `storage: 'memory'` remains process-local — fine for the sync queue driver, won't see worker events for BullMQ.

## 6.1.0

### Minor Changes

- 8634415: Migrate Telescope `JobCollector` and Pulse `QueueRecorder` from the legacy `dispatch()` monkey-patch to `queueObservers.subscribe()` (the cross-process event surface shipped in `@rudderjs/queue@4.1.0` for Horizon).

  **Why it matters under BullMQ:** the old wrapper only ran in the dispatching process, so worker-side `completed` and `failed` events were invisible. Telescope showed jobs as `dispatched` with no follow-up; Pulse `queue_throughput` undercounted and `queue_wait_time` actually measured enqueue duration, not the queue-to-active wait.

  **Behavior changes:**

  - **Telescope** — now records one entry per terminal lifecycle state (`dispatched` from the dispatcher process, `completed`/`failed` from the worker process). Each entry carries `jobId`, so dispatcher and worker rows for the same job correlate by id. Sync driver still records the same data, just routed through the observer instead of a wrapped method.
  - **Pulse** — `queue_wait_time` now records `startedAt - dispatchedAt` on `job.active` (true wait time). `queue_throughput` increments on terminal states (`completed` / `failed`), not on enqueue, so the metric is jobs-per-minute _processed_. `failed_job` entries gain `queue`, `jobId`, and `attempts` fields.

  No config changes required — both collectors auto-register as before. For BullMQ users, this is the visibility fix you'd expect to hit when first wiring up Pulse/Telescope against a real worker.

## 6.0.0

### Major Changes

- e344d67: **Breaking:** rename `*Aggregator` classes to `*Recorder` to align with Laravel Pulse's vocabulary — recorders listen to events and call `Pulse::record()`; "aggregation" is the storage-side bucketing strategy, not a class-naming concept. The runtime behavior is unchanged.

  Renames:

  - `RequestAggregator` → `RequestRecorder`
  - `QueueAggregator` → `QueueRecorder`
  - `CacheAggregator` → `CacheRecorder`
  - `ExceptionAggregator` → `ExceptionRecorder`
  - `UserAggregator` → `UserRecorder`
  - `QueryAggregator` → `QueryRecorder`
  - `ServerAggregator` → `ServerRecorder`
  - `Aggregator` interface → `Recorder`
  - `src/aggregators/` directory → `src/recorders/`

  Bundled with this rename: migrate the UI to the canonical package-UI shape (`views/vanilla/` + `registerPulseRoutes()`), matching `@rudderjs/auth`, `@rudderjs/telescope`, and `@rudderjs/horizon`. The Dashboard moves from `src/ui/{dashboard,layout}.ts` to `src/views/vanilla/{Dashboard,Layout}.ts`, with the `html\`\``auto-escape helper available in`\_html.ts`. Route registration is centralised in a new `src/routes.ts`exporting`registerPulseRoutes(storage, opts)`; the API handler functions stay in `api/routes.ts` as pure functions. Public functional API (`PulseProvider`, `Pulse` facade, configuration) is unchanged apart from the class renames above.

  **Migration:** find / replace `*Aggregator` → `*Recorder` and `import type { Aggregator }` → `import type { Recorder }` in any code that imports recorder classes by name from `@rudderjs/pulse`. Most apps don't reference these directly — the provider instantiates them — so the change is invisible. Apps that imported from the deep `@rudderjs/pulse/aggregators/*` paths will need to update those (the `aggregators/` directory no longer exists).

## 5.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/cache@1.0.0
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/log@1.0.0
  - @rudderjs/middleware@1.0.0
  - @rudderjs/orm@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/queue@4.0.0

## 4.0.3

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/orm@0.1.2
  - @rudderjs/middleware@0.0.14
  - @rudderjs/router@0.3.1

## 4.0.2

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/queue@3.0.2

## 4.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1
  - @rudderjs/cache@0.0.12
  - @rudderjs/log@0.0.7
  - @rudderjs/queue@3.0.1
  - @rudderjs/middleware@0.0.13

## 4.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/middleware@0.0.12
  - @rudderjs/orm@0.1.1
  - @rudderjs/queue@3.0.0
  - @rudderjs/cache@0.0.11
  - @rudderjs/log@0.0.6

## 3.0.0

### Patch Changes

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/queue@2.0.1
  - @rudderjs/core@0.0.12
  - @rudderjs/cache@0.0.10
  - @rudderjs/log@0.0.5
  - @rudderjs/middleware@0.0.11

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/queue@2.0.0
  - @rudderjs/cache@0.0.9
  - @rudderjs/log@0.0.4
  - @rudderjs/middleware@0.0.10

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/queue@1.0.0
  - @rudderjs/cache@0.0.8
  - @rudderjs/log@0.0.3
  - @rudderjs/middleware@0.0.9

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/cache@0.0.7
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/log@0.0.2
  - @rudderjs/middleware@0.0.8
  - @rudderjs/orm@0.0.7
  - @rudderjs/queue@0.0.6
  - @rudderjs/router@0.0.4
