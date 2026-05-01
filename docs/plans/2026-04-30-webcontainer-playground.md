# Plan: WebContainer-compatible playground

> **STATUS 2026-05-01:** Phases 0–3 + framework-side Phase 4 unblock shipped on `main`. Issue [#127](https://github.com/rudderjs/rudder/issues/127) closed by [#128](https://github.com/rudderjs/rudder/pull/128); `@rudderjs/orm-prisma@1.2.0` published via [#129](https://github.com/rudderjs/rudder/pull/129). **Standalone `rudder-web-playground` BOOTS in StackBlitz** — `pnpm install && pnpm run dev` reaches `[RudderJS] ready` and serves `/` + `/login` as 200. Got there via four follow-up fixes after the orm-prisma migration: pre-commit `prisma/generated/` (schema-engine still pulls at `prisma generate` time); switch URL to `:memory:` + on-boot SQL seed (libsql swaps to a WASM build whose Emscripten FS can't see host files); explicitly wire `SessionMiddleware` + `AuthMiddleware` on the web group (the providers' `appendToGroup()` auto-install path doesn't fire in WebContainer — root cause unknown, framework follow-up filed in `project_webcontainer_playground.md`). **Next:** Phase 4 click-through validation (login flow, todo CRUD, telescope/pulse/horizon, AI agent), then Phase 5 (`create-rudder-app --preset web`) + Phase 6 (homepage button).

## Context

[WebContainers](https://webcontainers.io/) (StackBlitz) run a full Node.js environment in the browser via WebAssembly — `pnpm install`, child processes, filesystem, the lot. Bolt.new and StackBlitz IDEs are built on it.

A WebContainer-bootable RudderJS demo gives us a "click → running RudderJS in your browser" link from rudderjs.com. That's a marketing surface Laravel doesn't have and Next.js leans on heavily.

The current `playground/` will not boot in WebContainer as-is, primarily because of Prisma's native query engine and a handful of drivers that assume raw TCP. The plan below adds a sibling `playground-web/` variant that swaps the incompatible parts.

---

## What works in WebContainer

- pnpm workspaces + Turborepo
- Vite + Vike SSR (StackBlitz pioneered this)
- TypeScript, decorators, `reflect-metadata`
- `@rudderjs/server-hono`, session, view, router, middleware, validation
- Local filesystem storage
- Outbound HTTPS via `fetch` (so AI provider calls, S3 over HTTP, Upstash-style Redis, libSQL HTTP all work)

## What does not work in any browser sandbox

- Raw TCP listening sockets — kills `@rudderjs/broadcast`, `@rudderjs/sync` real-time WS servers
- Raw TCP outbound — kills SMTP mail, native Redis (`@rudderjs/cache`/`queue` redis driver), AMQP, raw Postgres/MySQL connections
- Native `.node` binaries — kills standard Prisma (Rust query engine), `bcrypt`, `better-sqlite3`, `sharp`. (Note: `@rudderjs/auth` already uses `bcryptjs`, so it's fine.)

## What is conditional

- **Prisma** — works *only* with `previewFeatures = ["driverAdapters"]` + a JS driver adapter (e.g. `@prisma/adapter-libsql`). The Rust engine is bypassed entirely; SQL execution happens in the JS driver.
- **Prisma migrations** — `migrate dev` uses a separate native binary and won't run. Workaround: ship a pre-pushed SQLite file or do DDL via raw SQL on first boot.
- **`prisma generate`** — use `--no-engine` and commit the generated client.

---

## Architecture: stack swaps

| Layer | `playground/` (current) | `playground-web/` (new) |
|---|---|---|
| Database | Prisma + SQLite (Rust engine) | Prisma + `driverAdapters` + `@prisma/adapter-libsql` + `@libsql/client` (`file:` URL) |
| Cache | configurable | `memory` driver |
| Queue | configurable | `memory` or `database` driver |
| Mail | SMTP | `log` driver |
| Session | configurable | `cookie` driver |
| Storage | configurable | `local` driver |
| Broadcast / sync | WS server | omitted from the demo |

Detection helper: `isWebContainer()` (sniffs `process.versions.webcontainer`) lives in `@rudderjs/support`. Config files use it to flip defaults so the same code path works in both environments.

---

## Phases

### Phase 0 — De-risk Prisma (BLOCKING, ~2h) — **PASS 2026-04-30**

Local spike at `experiments/webcontainer-spike/` (in worktree branch `worktree-agent-a8c9a27ef7a971ac8`) confirmed Prisma + libSQL runs end-to-end with **zero native binaries** at runtime. Verified by deleting `node_modules/@prisma/engines/` and re-running create + findMany + delete cleanly.

**Versions validated:** prisma 6.19.3 · @prisma/client 6.19.3 · @prisma/adapter-libsql 6.19.3 · @libsql/client 0.14.0 · tsx 4.20.6 · Node 20+.

**Three plan corrections — Prisma 6.x changed the API since the original recipe:**

1. **Schema needs BOTH `engineType = "client"` AND the right preview features.** With only `previewFeatures = ["driverAdapters"]`, `prisma generate` still emits `libquery_engine-*.dylib.node` and the runtime loads it (adapter goes through the engine, doesn't bypass it). Required schema:
   ```prisma
   generator client {
     provider        = "prisma-client-js"
     previewFeatures = ["driverAdapters", "queryCompiler"]
     engineType      = "client"
   }
   ```
   Emits only `query_compiler_bg.wasm` (1.8 MB). Both preview features print "deprecated, now stable" warnings but are still required to flip the codepaths in 6.19.

2. **Drop `--no-engine` from the recipe.** It's incompatible with `{ adapter }` in Prisma 6.x and throws `PrismaClientValidationError`. The flag was for Accelerate, not driver adapters. `engineType = "client"` is what avoids the native binary.

3. **`PrismaLibSQL` is now a factory taking libsql `Config` directly:**
   ```ts
   import { PrismaLibSQL } from '@prisma/adapter-libsql'
   import { PrismaClient } from '@prisma/client'

   const adapter = new PrismaLibSQL({ url: 'file:./prisma/dev.db' })
   const prisma = new PrismaClient({ adapter })
   ```
   No more `createClient()` + wrap.

**Footprint note:** Prisma CLI still bundles `@prisma/engines` (~200 MB with native + schema-engine binary) as a transitive dep. Fine in WebContainer because we never invoke the CLI for `db push` at runtime — Phase 3 ships the schema pre-pushed (option a) or applies raw DDL via `libsql.execute()` (option b).

#### Prisma 7 update (2026-04-30, during Phase 2)

The current playground (and `playground-web/`) is on **Prisma 7.x**, not the 6.x the Phase 0 spike used. The 6.x recipe still works, but several of the Phase 0 corrections are now optional/relaxed:

1. **`engineType = "client"` is no longer required.** In Prisma 7, the WASM query compiler (`query_compiler_fast_bg.wasm`) is the default — `prisma generate` does **not** emit any `*.dylib.node` / `*.so` / `*.dll` files at all, even with no preview features and no `engineType` flag. Verified locally on `@prisma/client@7.8.0`. Setting `engineType = "client"` is harmless (no error, no warning) and we keep it in `playground-web/` for explicit documentation, but a stock Prisma 7 schema is already WebContainer-runtime-safe.

2. **`previewFeatures = ["driverAdapters", "queryCompiler"]` are now stable in Prisma 7.** Listing them prints `warn Preview feature "X" is deprecated. The functionality can be used without specifying it as a preview feature.` but does not break anything. Keep them only for clarity; new schemas can omit them.

3. **`PrismaLibSQL` is renamed to `PrismaLibSql` in Prisma 7.** The Phase 0 spike on Prisma 6 used `PrismaLibSQL` (uppercase SQL). In `@prisma/adapter-libsql@7.x` the class is `PrismaLibSqlAdapterFactory as PrismaLibSql` (camelCase Sql). `@rudderjs/orm-prisma`'s libsql branch already uses the correct Prisma 7 spelling, so swapping `connection.driver` from `'sqlite'` (better-sqlite3) to `'libsql'` is enough — no code changes in the adapter.

4. **`url` is no longer allowed in `datasource db { ... }`** in Prisma 7. The CLI now requires the URL to live in `prisma.config.ts` (passed to the `PrismaClient` constructor via the adapter). The current playground schema already complies (`provider = "sqlite"`, no `url`), and `playground-web/` keeps the same structure.

5. **`@prisma/adapter-libsql@7.8.0` peer requires `@libsql/client@^0.17.0`** — bumped from `^0.14.0` in the 6.x spike. The 7.x adapter has a stricter peer range; pin to `^0.17.0` in `package.json`.

6. **`@prisma/engines` still ships a native `schema-engine-darwin-arm64` (~24 MB)** for migration commands (`migrate dev`, `db push`). These never run inside WebContainer — Phase 3 still applies (pre-push the dev.db host-side or run raw DDL on first boot). Runtime is binary-free.

**Net effect for `playground-web/`:** the schema still uses the 6.x corrections (the deprecation warnings are harmless), `@rudderjs/orm-prisma` already wires the correct `PrismaLibSql` factory, and the only `package.json` change vs the 6.x recipe is `@libsql/client@^0.17.0`.

### Phase 1 — Detection helper (~30min) — **DONE 2026-04-30**

Shipped `isWebContainer()` in `packages/support/src/runtime.ts`, re-exported from `@rudderjs/support`. Returns `true` when `process.versions.webcontainer` is set. Two tests in `packages/support/src/index.test.ts` cover both states (set / not set). Build + typecheck clean, 82/82 tests passing. Uncommitted on `main`.

### Phase 2 — `playground-web/` scaffold — **DONE 2026-04-30 (PR #125)**

Shipped:
- `prisma/schema.prisma` — `engineType = "client"` + `previewFeatures = ["driverAdapters", "queryCompiler"]`
- `bootstrap/db.ts` instantiates `PrismaLibSQL` factory with libsql config
- `config/cache.ts`, `queue.ts`, `mail.ts`, `session.ts` default to `memory` / `sync` / `log` / `cookie` (gated by `isWebContainer()`)
- Dropped: `@rudderjs/broadcast`, `@rudderjs/sync`, `@rudderjs/queue-bullmq`, `better-sqlite3`, `y-websocket`, `yjs`, `ws`, `@types/ws`, `@prisma/adapter-better-sqlite3`
- Their demo views + routes + prisma sync schema fragments are gone

Verified locally: `pnpm build` clean, `pnpm dev` boots all 19 providers to `[RudderJS] ready`.

> **Note for #127 work:** the `engineType = "client"` and `previewFeatures` lines become irrelevant once `@rudderjs/orm-prisma` migrates to the new `prisma-client` generator. Strip them at that point.

### Phase 3 — DB bootstrap without migration engine — **DONE 2026-05-01**

Shipped option (a): a pre-pushed `playground-web/prisma/dev.db` (200 KB, empty rows, all 6 schema files merged) committed to the repo. `playground-web/.gitignore` keeps the global `dev.db` ignore but adds `!prisma/dev.db` so only the canonical one tracks. README updated to drop the manual `prisma db push` step from the boot recipe — fresh clones run `pnpm dev` directly and the schema is already there.

Schema-change workflow documented in the README: re-run `prisma generate` + `prisma db push` locally + `git add prisma/dev.db`. Drift surfaces in PR diffs.

Option (b) (raw DDL on first boot) deferred until drift becomes painful — premature for the MVP.

Seeders run via `pnpm rudder db:seed` as today.

### Phase 4 — StackBlitz validation — **BOOT PASSES 2026-05-01; click-through TODO**

Standalone repo (`github.com/rudderjs/rudder-web-playground`) now boots clean in StackBlitz: `pnpm install && pnpm run dev` reaches `[RudderJS] ready` and serves `/` + `/login` as HTTP 200. Got there via four sequential fixes on top of the framework-side `orm-prisma@1.2.0` release:

1. **`60551d1`** — sync the framework's PR #128 changes (prisma-client generator, `config/database.ts` `PrismaClient` field, `.gitignore`, `orm-prisma@^1.2.0`, drop predev/postinstall retry).
2. **`985eda1`** — pre-commit `prisma/generated/` and drop the `postinstall` hook. WebContainer's pnpm refuses to run `@prisma/engines`'s install script, so when our app's postinstall calls `prisma generate` the CLI tries to download `schema-engine` from `binaries.prisma.sh` (no CORS, hangs). The new generator's output is binary-free (884K of TypeScript) and safe to commit.
3. **`283a76d`** — `:memory:` URL + on-boot SQL seed. `@libsql/client` swaps to its WASM build inside WebContainer (because WASI-Node can't load `.node` binaries), and that WASM build runs SQLite via Emscripten — whose virtual filesystem can't read host files at any path. `file:./prisma/dev.db`, absolute paths, all throw `SQLITE_CANTOPEN`. Default URL to `:memory:` when `isWebContainer()`, then a new `app/Providers/SeedDbProvider.ts` replays `prisma/dev.sql` (a `sqlite3 .dump` of `dev.db`) through Prisma's `$executeRawUnsafe` after `DatabaseProvider` boots. Same shared `PrismaClient` instance, so the in-memory DB sees the schema before the first request.
4. **`271869b`** — explicitly wire `SessionMiddleware` + `AuthMiddleware` on the `web` group in `bootstrap/app.ts`. `@rudderjs/auth` and `@rudderjs/session` install their middleware via `appendToGroup('web', ...)` from `@rudderjs/core` (a `globalThis`-keyed store). In WebContainer that path stops firing — the chain ends up `RateLimit → CsrfMiddleware → handler` with no Session/Auth context, so `auth().user()` throws "No auth context" on `/`. Root cause not pinned (the store IS already on `globalThis`, designed to survive dual-instance loads, so the obvious theory doesn't fully explain it). **Framework follow-up:** `appendToGroup` should be made WebContainer-safe so `playground-web/` and downstream apps don't each need this workaround.

**Trade-offs accepted:**
- Schema-change workflow now: `prisma db push` → `sqlite3 prisma/dev.db .dump > prisma/dev.sql` → `prisma generate` → `git add prisma/`. Drift surfaces in PR diffs.
- The vendored `src/runtime/webcontainer.ts` stays until `@rudderjs/support` publishes a release containing `isWebContainer()` (still pinned at `1.0.0` on npm; PR #121 not yet released).
- Explicit middleware wiring in `bootstrap/app.ts` is a workaround until the framework auto-install bug is fixed.

**StackBlitz workspace caching gotcha:** StackBlitz reuses workspace IDs across visits to the same `?file=` URL. To pick up a fresh commit, close the tab fully and reopen the URL (or `git pull` inside the StackBlitz terminal). Otherwise it keeps testing the same SHA.

**Phase 4 click-through still TODO** — the boot works; the per-feature validation list below has not been exercised in StackBlitz yet.

---

### Phase 4 — StackBlitz validation (~3-4h)

Push to a fresh repo, open via `stackblitz.com/github/<repo>`. Click through:

- Register / login / logout
- Todo CRUD (or whatever module exercises the ORM end-to-end)
- Telescope dashboard — request, query, exception entries
- Pulse dashboard
- Horizon dashboard
- AI agent chat (with API key set as env var in StackBlitz)

Fix what breaks. Likely surprises: `optimizeDeps` for the Vite scanner, peer resolution paths, anything implicitly assuming raw TCP, memory pressure during install.

### Phase 5 — Distribution — **PARTIAL (BLOCKED on #127)**

Standalone repo route shipped: `https://github.com/rudderjs/rudder-web-playground` exists with a WebContainer-targeted variant of `playground-web/` (workspace:* deps replaced with npm versions, `isWebContainer()` inlined locally because `@rudderjs/support@1.0.0` on npm doesn't yet have the helper). Local sibling at `/Users/sleman/Projects/rudder-web-playground/`. **Doesn't boot in StackBlitz** for the same reason as Phase 4 — Prisma binary download.

Still TODO:
- `create-rudder-app --preset web` — defer until #127 + StackBlitz validation lands

### Phase 6 — Homepage integration (~1h) — **BLOCKED**

- Hero button on rudderjs.com homepage: "Try in browser →" — DO NOT SHIP until #127 fixes the StackBlitz boot
- `/docs/installation` mentions it as the no-install path
- Optional: dedicated `/docs/try-in-browser` page covering what's included and what's omitted (broadcast/sync)

---

## Risks (ranked)

1. **Prisma driver adapter compatibility** — Phase 0 de-risks; everything else is mechanical. If this fails, revisit ORM strategy or scope down to non-DB demos.
2. **StackBlitz memory ceiling on install** — full `@rudderjs/*` set + Vite + Prisma is not light. Mitigate by trimming optional packages from `playground-web/`'s deps.
3. **Pre-pushed SQLite drift** — solvable by Phase 3 option (b).
4. **Vike SSR + WebContainer module-runner edge cases** — well-trodden by StackBlitz, low risk.

## Effort estimate

~1–2 days of focused work, gated on Phase 0.

| Phase | Estimate |
|---|---|
| 0. Spike | 2h |
| 1. Detection helper | 30min |
| 2. `playground-web/` scaffold | 3h |
| 3. DB bootstrap | 2h |
| 4. StackBlitz validation | 3-4h |
| 5. Distribution | included in 4 |
| 6. Homepage integration | 1h |

## Out of scope

- Full feature parity with `playground/` — broadcast and sync are intentionally omitted; they need a deployed demo (Fly/Railway) elsewhere.
- Making the existing `playground/` itself WebContainer-bootable — keeping them as separate variants is simpler and avoids polluting the canonical demo with detection logic.
- Replacing Prisma in the framework — driver adapters are a Prisma-supported path; we don't need to abandon Prisma for this.

## Marketing framing

The pitch is **"click → running RudderJS in your browser, no install."** That is a 30-second proof-of-concept for skeptics, not a feature-complete demo. The two visible omissions (real-time broadcast, collaborative sync) are linked from a deployed demo that handles them properly. Two demos, each doing what it's good at.
