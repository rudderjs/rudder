# Plan: WebContainer-compatible playground

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

### Phase 2 — `playground-web/` scaffold (~3h)

Copy `playground/` to `playground-web/`, then modify:

- `prisma/schema.prisma` — set `engineType = "client"` and `previewFeatures = ["driverAdapters", "queryCompiler"]` (see Phase 0 results — both are required)
- `bootstrap/db.ts` — instantiate `PrismaLibSQL` factory with libsql config:
  ```ts
  const adapter = new PrismaLibSQL({ url: 'file:./prisma/dev.db' })
  const prisma = new PrismaClient({ adapter })
  ```
- `config/cache.ts`, `queue.ts`, `mail.ts`, `session.ts` — default to `memory` / `log` / `cookie` (with `isWebContainer()` gate)
- Drop `@rudderjs/broadcast`, `@rudderjs/sync` from `package.json`
- Remove their demo views from `app/Views/Demos/`
- Trim `routes/web.ts` to the WebContainer-safe demo subset

### Phase 3 — DB bootstrap without migration engine — **DONE 2026-05-01**

Shipped option (a): a pre-pushed `playground-web/prisma/dev.db` (200 KB, empty rows, all 6 schema files merged) committed to the repo. `playground-web/.gitignore` keeps the global `dev.db` ignore but adds `!prisma/dev.db` so only the canonical one tracks. README updated to drop the manual `prisma db push` step from the boot recipe — fresh clones run `pnpm dev` directly and the schema is already there.

Schema-change workflow documented in the README: re-run `prisma generate` + `prisma db push` locally + `git add prisma/dev.db`. Drift surfaces in PR diffs.

Option (b) (raw DDL on first boot) deferred until drift becomes painful — premature for the MVP.

Seeders run via `pnpm rudder db:seed` as today.

### Phase 4 — StackBlitz validation (~3-4h)

Push to a fresh repo, open via `stackblitz.com/github/<repo>`. Click through:

- Register / login / logout
- Todo CRUD (or whatever module exercises the ORM end-to-end)
- Telescope dashboard — request, query, exception entries
- Pulse dashboard
- Horizon dashboard
- AI agent chat (with API key set as env var in StackBlitz)

Fix what breaks. Likely surprises: `optimizeDeps` for the Vite scanner, peer resolution paths, anything implicitly assuming raw TCP, memory pressure during install.

### Phase 5 — Distribution

Two options, not mutually exclusive:

- **Repo `rudderjs/rudder-web-playground`** — opens via `stackblitz.com/github/rudderjs/rudder-web-playground`. Best fit for the homepage "Try in browser" button. Single artifact to maintain.
- **`create-rudder-app --preset web`** — for users who want to fork a WebContainer-friendly template locally.

Recommend starting with the repo (faster to ship). Add the preset later if there's demand.

### Phase 6 — Homepage integration (~1h)

- Hero button on rudderjs.com homepage: "Try in browser →"
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
