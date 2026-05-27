# @rudderjs/queue-inngest

## 1.3.0

### Minor Changes

- 1554c6d: Require `inngest` `^3.54.0` (was `^3.0.0`) to clear a high-severity advisory in the inngest 3.5x line and to pick up its updated OpenTelemetry dependency ranges. Re-resolving the transitive `@opentelemetry/*` tree and `protobufjs` clears the critical `protobufjs` advisory and the high `@opentelemetry/auto-instrumentations-node` / `sdk-node` / `exporter-prometheus` advisories. No source changes — the `Inngest` API used (`new Inngest`, `createFunction`, `send`) is unchanged within the 3.x line.

## 1.2.0

### Minor Changes

- 652c858: Inngest context propagation + BullMQ lifecycle hygiene + queue CLI lazy adapter (Phase 4 of the 2026-05-22 eventing/realtime plan):

  **`@rudderjs/queue-inngest`**

  - **P0 — `__context` now round-trips through the Inngest transport.** `dispatch()` embeds the serialized `DispatchOptions.__context` on `event.data`; the function body extracts it and forwards to `executeJob({ __context })`. Apps using `@rudderjs/context` (tenant / user / locale ALS) that switched driver from BullMQ → Inngest were silently dropping context on every job, opening a wrong-tenant-DB-write risk. The wire format now matches BullMQ, so cross-driver migrations are safe.
  - **P1 — `Job.retries` validated and clamped to `[0, 20]` with a `console.warn`.** Inngest accepts only integers in that range. The previous `as 0|1|…|20` cast accepted any number at compile-time and crashed at registration with a confusing error. Out-of-range values now warn at boot and clamp to the nearest valid value — surfacing the misuse instead of breaking the boot.
  - Minor bump because `__context` now propagates where it previously did not — apps relying on the broken state would observe a _correct_ tenant being attached to jobs after upgrade.

  **`@rudderjs/queue-bullmq`**

  - **P1 — Worker shutdown is now properly awaited.** `disconnect()` closes workers (via `Promise.allSettled`) **before** queues, then closes queues, logging any rejections without swallowing them. Previously `Promise.all([...queues].map(q => q.close()))` ignored workers entirely — workers kept polling BRPOP through the SIGTERM grace period and k8s rolling restart pods outlived their window. Closing workers before queues also avoids a "Connection is closed" race during worker BRPOP-in-flight.
  - **P1 — `SIGTERM` / `SIGINT` listeners no longer leak.** They're registered once per adapter (on the first `work()` call) and removed in `disconnect()`. Multi-tenant boot or test re-runs no longer accumulate handlers; `process.off` matches the listener because the closure is bound on the adapter instance.
  - **P1 — BullMQ no longer double-fires `instance.failed()` per attempt.** The worker `'failed'` event listener previously called `await instance.failed?.(error)` separately, on top of `executeJob`'s `failed()` invocation (Phase 1). The duplicate call is removed; the listener now owns observer emission + the console log only. The unhandled-rejection risk from the async listener body is gone for the same reason — there's no longer an awaited hook in the listener that could throw into an EventEmitter.
  - `work()` now exposes the underlying `workers: Worker[]` on the adapter (read-only by convention) so callers and tests can introspect lifecycle state.

  **`@rudderjs/queue`**

  - **P1 — `QueueServiceProvider`'s 5 CLI commands (`queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry`) now resolve the adapter via `QueueRegistry.get()` at invocation time** instead of closing over the value captured at boot. Under Vite SSR re-eval (the documented `bootstrap/` / `app/` reload path) the `rudder.command()` dedup replaces the stale closure with a fresh one — and now the fresh closure always acts on the latest registered adapter. Tests that swap the adapter via `QueueRegistry.set(...)` between bootings work end-to-end with no boot re-run.

  No public API additions in this PR; all changes are bug fixes + internal lifecycle hardening.

- 4254abe: Drivers must enforce middleware + `failed()` + `ShouldBeUnique` (Phase 1 of the 2026-05-22 eventing/realtime plan):

  Until now, `@rudderjs/queue` exported `runJobMiddleware`, `acquireUniqueLock`, and the `failed()` hook contract — but **none of the shipped drivers invoked them**. A user who shipped `middleware() { return [new RateLimited(...)] }` got zero rate-limiting in prod; a user with `implements ShouldBeUnique` dispatched duplicates on every concurrent call; an Inngest job that threw never saw its `failed()` hook fire. This phase centralises execution so every driver routes through the same pipeline.

  - **New `executeJob(instance, ctx)` helper.** Single source of truth for "run a built job through the full pipeline" — context hydration (`@rudderjs/context`) → middleware → `handle()` → `failed()` hook on terminal failure → release of the `ShouldBeUnique` dispatch lock. Exported from `@rudderjs/queue`.
  - **`runJobMiddleware` gains an optional `handler` argument.** Backwards-compatible (defaults to `() => job.handle()`); `executeJob` uses it to catch from inside the pipeline so `failed()` fires even when middleware throws.
  - **`DispatchBuilder.send()` now acquires the `ShouldBeUnique` lock at dispatch time.** Mirrors Laravel: if `acquireUniqueLock` returns `false` (another dispatcher already won the atomic claim from Phase 3), the dispatch is silently skipped. `executeJob` releases the lock when the worker side finishes — or right before `handle()` runs for `ShouldBeUniqueUntilProcessing`.
  - **`SyncAdapter` routes through `executeJob`** — passes the original instance directly so closure-style jobs (`dispatch(fn)`, `Chain`, batch wrappers) keep their `handle` closure intact (it would not survive a JSON round-trip on async drivers; that's a separate Phase 2 fix).
  - **`queue-bullmq` processor routes through `executeJob`** — reconstructs the instance with `decodePayload` + `Object.assign`, then `executeJob(instance, { __context })`. Drops the inline context-hydration block; `executeJob` handles it.
  - **`queue-inngest` function body routes through `executeJob`** — Inngest gains the `failed()` hook, middleware, and unique-lock release it has never had.

  **Behaviour change to call out:** on `queue-bullmq` and `queue-inngest`, `failed()` now fires on every catch from the worker side, not only on terminal retry exhaustion. Closer to the Laravel semantic but worth noting for apps whose `failed()` does irreversible cleanup. Retry-aware `failed()` is a follow-up.

### Patch Changes

- b774f0f: Atomic unique-lock + typed payload serializer (Phase 3 of the 2026-05-22 eventing/realtime plan):

  - **`@rudderjs/cache` adds `add(key, value, ttl)`** — atomic claim (SETNX semantics). Redis: `SET NX EX`; in-memory: synchronous check-and-set. Returns `true` if THIS caller wrote, `false` if a concurrent caller got there first. Implemented on `MemoryAdapter`, `RedisAdapter`, and `FakeCacheAdapter` (also surfaces a new `'add'` entry in `CacheOperation`). Same `Cache.add(...)` shape on the static facade.
  - **`acquireUniqueLock` now uses `cache.add()`** — the prior `cache.get` + `cache.set` pattern allowed two concurrent dispatchers to both read `null`, both write, and both think they acquired the lock; the duplicate `ShouldBeUnique` jobs would then run side-by-side. The new path closes the race on every driver `@rudderjs/cache` ships. The in-memory fallback (no cache provider registered) is already safe because the check-and-set runs synchronously in one event-loop tick.
  - **Typed payload serializer (`encodePayload` / `decodePayload`)** — every driver previously did `JSON.parse(JSON.stringify(job))` on dispatch. `Date` round-tripped as ISO string (handlers typed `Date` saw `string`), `BigInt` threw, `Buffer` collapsed to `{type,data}`, `Map`/`Set` collapsed to `{}`/`[]`. The new serializer tags non-JSON-safe types with `{ __rj: '<tag>', value: ... }` so they survive the wire and rehydrate in the worker. Wired into `SyncAdapter`, `@rudderjs/queue-bullmq`, and `@rudderjs/queue-inngest` on both the dispatch and worker sides.
  - **`safePayload` no longer hides serialisation failures** — was `try { JSON.parse(JSON.stringify(job)) } catch { return {} }`, silently dropping the entire payload (and the observer signal that something was wrong). Now propagates the error.
  - **`Queue.fake()` no longer reaches for ESM `require()`** — replaced the `require('./fake.js')` workaround with a static import. The previous landmine matches [[esm-only-peer-require-bug]] — pure-ESM bundles would crash on `require` not being defined.

  The serializer behavior change is a true bug fix — apps whose handlers received `string` for a `Date` field were broken; they now receive a `Date`. Apps that explicitly worked around the bug (manual `new Date(payload.field)` in the handler) keep working because the tagged shape is opaque to user code.

- 2b1819a: Closure / chain / batch dispatchers now declare driver capability (Phase 2 of the 2026-05-22 eventing/realtime plan):

  Until now, `dispatch(fn)`, `Chain.of([...])`, and `Bus.batch([...])` silently no-op'd on async drivers. Each helper builds a wrapper `{ handle: fn }` plain object that holds the user's logic as a closure — under `JSON.stringify`, the function silently becomes `undefined`. The wrapped job got enqueued, but the worker side reconstructed it with `constructor.name === 'Object'`, no `handle` method, and no error path. Apps shipped "works locally" + "nothing runs in prod".

  - **`QueueAdapter` gains three optional `readonly` flags** — `supportsClosures`, `supportsChain`, `supportsBatch`. Drivers that can run wrapped closures (Sync, Fake) declare `true`; drivers that serialise jobs over the wire (BullMQ, Inngest) declare `false`. The flags are additive — existing third-party adapters that don't declare them keep working through the legacy `dispatchBatch` / `dispatchChain` shape checks.
  - **`dispatch(fn)`, `Chain.of([...]).dispatch()`, `Bus.batch([...]).dispatch()` throw clear errors** when the registered driver opts out. Each message names the driver and suggests either switching to the sync driver for that code path or rewriting to concrete `Job` classes.
  - **Native overrides win.** A driver that ships its own `dispatchChain` / `dispatchBatch` keeps working regardless of the flags — the capability check runs only after the native fast-path doesn't match.
  - **`batch.catch()` fires exactly once per batch.** Was called inside each per-job wrapper's catch, so a 3-failure batch fired `catch` three times. Now fires once after `Promise.allSettled`, passing the first rejection reason (or a synthesised error when failures were swallowed inside `allowFailures()` wrappers). Matches Laravel.

  7 new tests across `closure.test.ts`, `chain.test.ts`, `batch.test.ts` cover capability throws on a fake async-only adapter + `catch()` firing exactly once on multi-failure batches.

- Updated dependencies [b774f0f]
- Updated dependencies [2b1819a]
- Updated dependencies [652c858]
- Updated dependencies [4254abe]
  - @rudderjs/queue@4.2.0

## 1.1.0

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

## 1.0.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/queue@4.1.3

## 1.0.2

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

## 1.0.1

### Patch Changes

- 4d4991c: fix(orm,queue-bullmq,queue-inngest): Tier 3 quality sweep — JSON parse guards, BullMQ double-execution fix, dispatch serialization errors

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

### Patch Changes

- @rudderjs/queue@4.0.0

## 0.0.12

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/queue@3.0.2

## 0.0.11

### Patch Changes

- @rudderjs/queue@3.0.1

## 0.0.10

### Patch Changes

- @rudderjs/queue@3.0.0

## 0.0.9

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/queue@2.0.1

## 0.0.8

### Patch Changes

- @rudderjs/queue@2.0.0

## 0.0.7

### Patch Changes

- @rudderjs/queue@1.0.0

## 0.0.6

### Patch Changes

- Updated dependencies [e1189e9]
  - @rudderjs/queue@0.0.6

## 0.0.5

### Patch Changes

- @rudderjs/queue@0.0.4

## 0.0.4

### Patch Changes

- @rudderjs/queue@0.0.3

## 0.0.3

### Patch Changes

- @rudderjs/queue@0.0.2
