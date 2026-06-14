# @rudderjs/mail

## 1.4.1

### Patch Changes

- d6bf472: Make the mail fake intercept queued mail. `Mail.to(...).queue()` / `.later()` route through `dispatchMailJob`, which never checked for an active fake despite `FakeMailAdapter.recordQueued`'s own contract documenting that it should. Under `Mail.fake()`, queueing a mailable therefore tried to resolve `@rudderjs/queue` and threw (or, when queue was installed, enqueued a real job that the fake never saw), so `fake.assertQueued()` / `assertNothingQueued()` could never pass for code that queues mail. `dispatchMailJob` now records to the active fake (duck-typed on `recordQueued`) before resolving the queue, so faked tests observe queued mail and do not need the queue package installed.

## 1.4.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0

## 1.3.1

### Patch Changes

- 6f06c8c: fix: bump vulnerable dependency ranges flagged by Dependabot

  - **`@rudderjs/server-hono`** — raise `@hono/node-server` from `^1.19.10` to
    `^1.19.14`, clearing two advisories on the older line (the previous range
    could still resolve a vulnerable patch).
  - **`@rudderjs/mail`** — narrow the optional `nodemailer` range from
    `^7.0.11 || ^8.0.0` to `^8.0.5`. The advisory affects `<= 8.0.4` and there
    is no patched 7.x release, so nodemailer 7 support is dropped — installs now
    require the patched 8.x line.

  Transitive advisories (postcss, defu, lodash, effect, diff) are pinned to
  patched versions via root `pnpm.overrides`; turbo is bumped in devDependencies.
  Those don't affect any published package's surface and so aren't versioned here.

## 1.3.0

### Minor Changes

- 255ca27: Expand `FakeMailAdapter` with combined sent + queued assertions and exact-count variants.

  **Combined (sent OR queued):**

  - `assertOutgoing(mailableClass, predicate?)` — match either channel; useful when the code under test might dispatch synchronously or via the queue.
  - `assertOutgoingCount(n)` — total across both channels; failure message breaks down sent vs queued.
  - `assertNothingOutgoing()` — neither sent nor queued.
  - `outgoing(mailableClass?)` — access every entry across both channels (sent + queued).

  **Exact-count per channel:**

  - `assertSentTimes(mailableClass, count)` — exact sent count for the class.
  - `assertQueuedTimes(mailableClass, count)` — exact queued count for the class.

  The new combined helpers let tests assert that mail went out without coupling to the dispatch channel — useful for feature-flagged paths and retry policies where the implementation may switch between sync send and queue.

  Found by the Phase 3 testing-ergonomics audit (cluster 7).

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1

## 1.2.1

### Patch Changes

- 14a50d9: Second round of CodeQL source hardening.

  - `@rudderjs/orm` (**security**) — `make:migration <name>` ran through `spawn(..., { shell: true })` (load-bearing on Windows, where the `pnpm` shim is `pnpm.cmd`), so a crafted name (`pnpm rudder make:migration "x; rm -rf ."`) was a shell-injection vector. The migration name — the only caller-influenced token in the command — is now validated against a strict identifier allowlist (`assertSafeName`) at both the Prisma and Drizzle sink sites; everything else in the command is a hardcoded literal.
  - `@rudderjs/ai` — the `web_fetch` tool's HTML→text extraction now removes `<script>`/`<style>` blocks with a tag-filter-safe regex (tolerates `</script >`) and strips remaining tags iteratively to a fixed point. Output is fed to the model as text, never rendered as HTML — this improves extraction robustness, not a security boundary. New `htmlToText` export.
  - `@rudderjs/mail` — extracted a shared `stripHtmlTags` helper (loop-to-stable tag removal) used by the Markdown text-alternative and the LogAdapter preview, replacing two single-pass strips.
  - `@rudderjs/support` — `ConfigRepository.set()` now guards prototype-polluting keys (`__proto__`/`constructor`/`prototype`) with a literal comparison directly at each assignment site instead of an upfront set-membership check; behavior is unchanged.

## 1.2.0

### Minor Changes

- db8510a: Require `nodemailer` `^7.0.11 || ^8.0.0` (was `^6.9.0`) to clear a high-severity advisory in the 6.x line. The SMTP adapter types nodemailer structurally and lazy-loads it via `resolveOptionalPeer`, so no source changes are needed — but apps using the SMTP driver should upgrade their installed `nodemailer` to 7.0.11+ / 8.x.

## 1.1.0

### Minor Changes

- aecb6a9: Phase 4 of `rudder doctor` — `--deep` runtime mode.

  `rudder doctor --deep` now boots the app (catching boot errors as a check
  result, never crashing doctor itself) and runs 6 new runtime checks
  that interrogate the live DI graph and external services.

  What's new:

  - **`runtime:app-boot`** (cli) — wraps `bootApp()` in try/catch. Boot
    success/failure becomes a check result with the error message + stack
    trace under `--verbose`. The fix line points at the most likely causes
    (missing env vars, unreachable services, missing provider deps).

  - **`runtime:port-free`** (cli) — `net.createServer().listen(PORT)` then
    immediately close. On `EADDRINUSE` it shells out to `lsof -ti :PORT`
    (macOS/Linux) to report the holding PID with a paste-able `kill <pid>`
    fix. Windows skips the PID lookup since `lsof` isn't standard there.

  - **`orm-prisma:db-connect`** — spawns a fresh PrismaClient via the
    user's resolved `@prisma/client`, runs `$connect()` + `$queryRaw\`SELECT
    1\``, disconnects. DSN passwords are redacted in error messages.

  - **`orm-prisma:migration-drift`** — runs `pnpm exec prisma migrate
status`; warns on pending migrations or drift, points at
    `pnpm rudder migrate`.

  - **`queue-bullmq:redis-ping`** — opens an ioredis connection with
    `lazyConnect: true`, `maxRetriesPerRequest: 0`, sends `PING`, closes.
    Fails fast (no retry storm), redacts the URL in the error.

  - **`mail:smtp-connect`** — raw TCP connect (no SMTP handshake, no
    credentials sent) to MAIL_HOST:MAIL_PORT or the host inferred from
    `config/mail.ts`. Times out after 2s.

  Implementation notes:

  - Boot status flows from the doctor command to runtime checks via a
    `globalThis['__rudderjs_doctor_boot_status__']` slot (the same pattern
    cli/router/orm use for cross-module singletons that survive Vite SSR
    re-eval).

  - The doctor command stays in `NO_BOOT_EXACT`. With `--deep`, the
    handler calls `bootApp()` itself inside try/catch, AFTER the
    built-in/package checks have registered. This means a boot crash
    doesn't take out the orchestrator — every runtime check still gets
    to render.

  - `--only <substring>` now matches both check id AND category. `--only
orm` catches `orm-prisma:*` + `orm-drizzle:*`; `--only runtime`
    catches every `category: 'runtime'` check regardless of package
    prefix.

  - Each runtime check that depends on an env var (DATABASE_URL,
    REDIS_URL, MAIL_HOST) skips with a clean "covered by <fast-path
    check>" message when the var is unset, instead of failing loudly.
    The fast-path check has already flagged the issue.

  End-to-end smoke against the playground: 28 checks across 10
  categories with `--deep`, every runtime check loads via the lazy
  loader and surfaces actionable findings or appropriate skips.

  Phase 5 (`--fix` idempotent auto-recovery) and Phases 6-7 (docs +
  ship) follow in subsequent PRs.

### Patch Changes

- Updated dependencies [b28e51f]
  - @rudderjs/console@1.1.0

## 1.0.4

### Patch Changes

- 985db16: Route `MailRegistry`'s adapter + default-from state through `globalThis` so the registry survives the case where `@rudderjs/mail` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/mail` inline (`Mail.to(...).send()` reads `MailRegistry`), but `MailProvider.boot()` and driver packages (`nodemailer`-backed adapters and future SMTP/SES drivers) are externalized via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Mail.*` reads from inside the bundle, producing a misleading `[RudderJS Mail] No mail adapter registered` error on every send in prod.

  No public API change — same `set` / `get` / `setFrom` / `getFrom` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), PR #501 (`@rudderjs/cache`), and PR #502 (`@rudderjs/queue`).

## 1.0.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 1.0.2

### Patch Changes

- 6614596: Fix ESM-only peer loading in three runtime sites that used synchronous `require()` against `@rudderjs/queue` and `@rudderjs/broadcast`. Because those peers' `exports` field has no `require` condition, `Mail.to(...).queue(...)`, queued notifications via `Notifier.send(...)`, and `BroadcastChannel.send` all threw "No exports main defined" — masked as the generic peer-missing error — even when the peer was installed.

  Switched all three sites to `await import(...)` (shipped in #448, changeset added retroactively).

## 1.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

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

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0

## 0.0.11

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.10

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

## 0.0.9

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.8

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.7

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.6

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/core@0.0.9

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.5

## 0.0.2

### Patch Changes

- @rudderjs/core@0.0.4
