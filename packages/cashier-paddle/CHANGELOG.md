# @rudderjs/cashier-paddle

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
