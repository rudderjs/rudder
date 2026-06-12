# @rudderjs/cashier-paddle

## 5.1.0

### Minor Changes

- 9c61405: Harden the Paddle webhook receiver.

  - **Replay protection.** `verifyPaddleWebhook` now checks the signed `ts` against the current time and rejects a request whose timestamp is outside the tolerance window (HTTP 403). The timestamp is part of Paddle's signed payload, so a forged request can never reach this check; it rejects an authentic request that is replayed outside the window. Configurable via the new `webhookTolerance` config key (seconds, default 300 / 5 minutes; set `0` to disable for environments with large clock skew).
  - **Subscription items are now persisted.** Every `subscription.*` webhook carries the full line-item set, but the handler parsed it and never wrote it to `paddle_subscription_items`, leaving `SubscriptionResource.items()` / `.swap()` reading an empty set. The webhook handler and `cashier:sync` now reconcile the items table (upsert by `priceId`, prune removed lines) so the local rows reflect the canonical subscription.
  - **Paused/canceled events carry the persisted row.** `subscription.paused` and `subscription.canceled` stamped `pausedAt` / `endsAt` with a second write, then dispatched an in-memory-patched record. The handler now re-reads the row after that write so listeners receive the persisted state (server-set `updatedAt`, etc.) rather than a partial patch.
  - **Orphaned transactions are backfilled when a billable is linked.** A `transaction.*` webhook that lands before its billable is linked to a Paddle customer (webhook racing the local row write, or an imported dashboard customer) was recorded with an empty `billableId`, making it invisible to `transactions()`. `createAsCustomer()` now claims any transactions matching the new `paddleCustomerId`, backfilling `billableId` / `billableType`.

## 5.0.0

### Major Changes

- 36514d9: Support the native engine, and ship one model set that runs on both native and Prisma.

  The 5 models' `static table` now carry the real SQL table names (`paddle_customers`, `paddle_subscriptions`, `paddle_subscription_items`, `paddle_transactions`, `paddle_webhook_logs`) instead of the Prisma camelCase delegate names, and set `static keyType = 'ulid'` so the ORM stamps a primary key on insert (the native engine has no `@default(cuid())`). A native migration fragment (`schema/native/`) is published by `vendor:publish --tag=cashier-schema` alongside the existing Prisma fragment.

  **Breaking — Prisma apps must upgrade `@rudderjs/orm-prisma`** to a release with the SQL-table-name → delegate fallback. Without it, queries fail with `Prisma has no delegate for table "paddle_customers"`. With it, the SQL name resolves to the `paddleCustomer` delegate via the client's runtime datamodel — no schema or data change needed.

  **Behavior change — new primary keys are ulid, not cuid.** Existing cuid rows are untouched (both are opaque strings in a `String @id` column); only rows created after upgrading get ulid ids. No migration required.

### Patch Changes

- Updated dependencies [361b298]
- Updated dependencies [d6f0e79]
- Updated dependencies [c1c8b58]
- Updated dependencies [b1f748d]
- Updated dependencies [45b9cf0]
  - @rudderjs/contracts@1.14.0
  - @rudderjs/orm@1.20.0
  - @rudderjs/core@1.10.0

## 4.4.1

### Patch Changes

- aaad9ad: `vendor:publish` assets now resolve on Windows. Every provider registered its publish sources via `new URL(...).pathname`, which yields `/D:/...` on Windows (leading slash + percent-encoding) — so `vendor:publish --tag=auth-views` / `notification-schema` / `broadcast-client` / `cashier-*` / the boost guidelines all failed there with missing-source errors. Paths now convert via `fileURLToPath`. Surfaced by the new asset-on-disk test added with the sync-schema tag (#952), which went red on Windows CI.
- Updated dependencies [87783f7]
- Updated dependencies [da07742]
- Updated dependencies [be26c2b]
- Updated dependencies [bef393f]
- Updated dependencies [940406d]
- Updated dependencies [aaad9ad]
  - @rudderjs/core@1.8.0
  - @rudderjs/orm@1.17.0
  - @rudderjs/contracts@1.13.0
  - @rudderjs/auth@6.4.1

## 4.4.0

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
  - @rudderjs/auth@6.4.0
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/router@1.8.0
  - @rudderjs/view@1.3.0

## 4.3.1

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [2c9fe2b]
- Updated dependencies [161c5c4]
  - @rudderjs/auth@6.3.0
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1
  - @rudderjs/orm@1.12.10
  - @rudderjs/router@1.7.1
  - @rudderjs/view@1.2.3

## 4.3.0

### Minor Changes

- abcab7b: Support `@paddle/paddle-node-sdk` 2.x and 3.x (peer range widened to `^1.0.0 || ^2.0.0 || ^3.0.0`). The 2.x+ SDK lines drop the bundled `lodash` dependency that carries the unfixable `_.template` code-injection advisory (GHSA-r5fr-rjxr-66jc — no patched lodash exists). The SDK is loosely typed and lazy-loaded, so no code changes are required; upgrade your installed `@paddle/paddle-node-sdk` to 3.x to clear the advisory.

## 4.2.0

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

- Updated dependencies [108c7a2]
- Updated dependencies [b28e51f]
- Updated dependencies [a3a7368]
  - @rudderjs/auth@6.1.0
  - @rudderjs/console@1.1.0

## 4.1.0

### Minor Changes

- abb841d: `Billable.createAsCustomer` no longer silently swallows Paddle API errors.
  Previously the catch was unconditional and intended to handle "SDK not
  configured" (tests, mock mode) — but it also swallowed real failures like
  409 `customer_email_in_use`, causing a local `PaddleCustomer` row to be
  persisted with `paddleId = null`. The user then completed Paddle Checkout
  successfully, Paddle fired `subscription.created` against the existing
  customer id, and the consumer's webhook handler couldn't find the local
  row by `paddleId` — so the customer paid and never received their
  subscription. Surfaced 2026-05-19 by pilotiq.io's first prod checkout.

  What changes:

  - The "SDK unavailable" path stays working. `await paddle()` is now in its
    own try/catch — a throw there (no `PADDLE_API_KEY`, `@paddle/paddle-node-sdk`
    not installed) still falls through with `paddleId = null`, same as before.
  - Real Paddle API errors (`fn.call(client.customers, ...)` rejecting) are
    no longer swallowed. They throw a new `BillablePaddleError` that wraps
    the original error on `.cause` and exposes Paddle's `.code` (read from
    both `err.code` and `err.error.code`). The local row is NOT persisted
    in the broken state — callers can catch at the request boundary and
    surface a friendly message.

  New exports:

  - `BillablePaddleError` — typed error for `createAsCustomer` API failures.
  - `setPaddleClientForTesting(client)` — `@internal` test override for
    injecting a stand-in Paddle client.

  Behaviorally breaking only for consumers that relied on the silent
  `paddleId = null` fallback as their "customer creation succeeded" signal.
  Most consumers will see this as a strictly-better experience — their
  `POST /subscribe` (or equivalent) endpoint now surfaces the underlying
  error instead of letting the customer pay and not get linked.

## 4.0.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/auth@6.0.1
  - @rudderjs/contracts@1.6.1
  - @rudderjs/core@1.1.5
  - @rudderjs/orm@1.9.2
  - @rudderjs/router@1.2.1
  - @rudderjs/view@1.1.1

## 4.0.0

### Patch Changes

- @rudderjs/auth@6.0.0

## 3.0.1

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

- Updated dependencies [d0db9f0]
- Updated dependencies [b74fc57]
- Updated dependencies [937cdac]
  - @rudderjs/auth@5.1.0
  - @rudderjs/orm@1.9.1
  - @rudderjs/view@1.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [e8cee45]
- Updated dependencies [942bd78]
- Updated dependencies [015e16e]
- Updated dependencies [231d7f6]
- Updated dependencies [015e16e]
  - @rudderjs/auth@5.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/orm@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/view@1.0.0
  - @rudderjs/auth@4.0.0

## 1.0.1

### Patch Changes

- 7bf4e46: Fix `cashier:install` command — `dist/commands/install.js` referenced `@rudderjs/rudder` (renamed to `@rudderjs/console` in v0.0.4) and tried to call a non-existent `runVendorPublish` export, breaking SSR builds and leaving the `cashier:install` command broken at runtime. The dead programmatic-fallback path is gone; the command now just prints the canonical install steps for the user to run.
