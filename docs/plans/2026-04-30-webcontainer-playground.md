# Plan: WebContainer-compatible playground

> **STATUS 2026-05-01 — DONE (proof-of-concept achieved).** RudderJS works in WebContainer. Standalone `rudder-web-playground` boots clean in StackBlitz with no workarounds (`auth@4.0.1` + `session@1.0.1` from PR #131, `support@1.1.0` from PR #133). Scaffolder Phase 5 Tier 1 (WC-aware config gates in `create-rudder-app`'s `config/{cache,queue,mail,session}.ts`) shipped via PR #135 — any newly scaffolded RudderJS app now boots gracefully if dropped into a sandbox runtime, at zero cost on regular Node. **Phase 5 Tier 2 (`--preset web`) dropped** — standalone repo covers the use case, two recipes to keep in sync = pure cost. **Phase 6 (homepage button) dropped** — was never the actual goal; this was a proof-of-concept project, not a productionization push. **Phase 4 click-through** remains as optional polish (manual StackBlitz QA), not blocking anything.

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

### Phase 4 — StackBlitz validation — **BOOT PASSES (no workarounds remaining); click-through TODO**

Standalone repo (`github.com/rudderjs/rudder-web-playground`) boots clean in StackBlitz: `pnpm install && pnpm run dev` reaches `[RudderJS] ready` and serves `/` + `/login` as HTTP 200. The path there had two phases: standalone-repo fixes (still load-bearing for everything except the now-resolved appendToGroup), then upstream framework fixes that closed the remaining gaps.

**Standalone-repo fixes (still in place):**

1. **`60551d1`** — sync framework PR #128 changes (prisma-client generator, `config/database.ts` `PrismaClient` field, `.gitignore`, `orm-prisma@^1.2.0`, drop predev/postinstall retry).
2. **`985eda1`** — pre-commit `prisma/generated/` and drop the `postinstall` hook. WebContainer's pnpm refuses to run `@prisma/engines`'s install script, so when our app's postinstall calls `prisma generate` the CLI tries to download `schema-engine` from `binaries.prisma.sh` (no CORS, hangs). The new generator's output is binary-free (884K of TypeScript) and safe to commit.
3. **`283a76d`** — `:memory:` URL + on-boot SQL seed. `@libsql/client` swaps to its WASM build inside WebContainer (because WASI-Node can't load `.node` binaries), and that WASM build runs SQLite via Emscripten — whose virtual filesystem can't read host files at any path. `file:./prisma/dev.db`, absolute paths, all throw `SQLITE_CANTOPEN`. Default URL to `:memory:` when `isWebContainer()`, then a new `app/Providers/SeedDbProvider.ts` replays `prisma/dev.sql` (a `sqlite3 .dump` of `dev.db`) through Prisma's `$executeRawUnsafe` after `DatabaseProvider` boots.

**Framework fixes that closed the remaining gaps:**

4. **PR #131** (framework, released as auth@4.0.1 + session@1.0.1 via PR #132) — `appendToGroup` static-import fix. Both `AuthProvider.boot()` and `SessionProvider.boot()` were grabbing `appendToGroup` via `await import('@rudderjs/core')` inside a silent `try/catch` — even though they **already statically import** other symbols from core. WebContainer's pnpm-symlink-under-WASI module resolution made the dynamic import throw, the catch ate the error, and the auto-install never registered. Fix: drop the dynamic import, add `appendToGroup` to the existing static import, delete the catch. +2/-14 net per file. The earlier "globalThis sandboxing in Vike SSR" theory was a wrong lead — the store on `globalThis` was fine all along, we just never got to write to it. Standalone repo reverted commit `271869b`'s explicit middleware wiring in `39b54a4` once the fix shipped.

5. **PR #133** (framework, released as support@1.1.0 via PR #134) — `isWebContainer()` published on npm. Standalone repo dropped its vendored `src/runtime/webcontainer.ts` (4-line copy) and re-pointed all six callers (`SeedDbProvider` + `config/{cache,database,mail,queue,session}.ts`) at `@rudderjs/support`.

**Remaining trade-offs (these stay):**
- Schema-change workflow: `prisma db push` → `sqlite3 prisma/dev.db .dump > prisma/dev.sql` → `prisma generate` → `git add prisma/`. Drift surfaces in PR diffs.

**StackBlitz workspace caching gotcha:** StackBlitz reuses workspace IDs across visits to the same `?file=` URL. To pick up a fresh commit, close the tab fully and reopen the URL (or `git pull` inside the StackBlitz terminal). Otherwise it keeps testing the same SHA.

**Phase 4 click-through still TODO** — the boot works; the per-feature validation list below has not been exercised in StackBlitz yet. This is a manual StackBlitz pass, not a code task.

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

### Phase 5 — Distribution — **STANDALONE REPO SHIPS CLEAN; preset still TODO**

Standalone repo route fully working: `https://github.com/rudderjs/rudder-web-playground` boots clean in StackBlitz with **no workarounds remaining** (auth@4.0.1, session@1.0.1, support@1.1.0 all on npm). Local sibling at `/Users/sleman/Projects/rudder-web-playground/`.

**Refined `--preset web` design — two tiers instead of one preset:**

The blunt "WC vs regular" framing turned out to over-bundle. Most of the diff between regular scaffold and the standalone repo is zero-cost — `isWebContainer()` gates that just return `false` outside WC. Only a few items have real cost on regular Node and genuinely need to be opt-in.

**Tier 1 — bake into the regular scaffolder (no preset flag needed):**

- All four `isWebContainer()` config gates: `cache.ts` (memory), `queue.ts` (sync), `mail.ts` (log), `session.ts` (cookie). On regular Node the gate returns false and the env-driven path is preserved exactly. Cost: zero. Benefit: any RudderJS app dropped into a sandbox runtime boots gracefully without re-config.
- `@rudderjs/support` pin bumped to `^1.1.0` so the helper is available.

These should land in the next scaffolder release independent of `--preset web`.

**Tier 2 — `--preset web` for the heavy artifacts:**

These have real cost on regular dev and stay opt-in:

- Prisma generator: `prisma-client` (no engine binaries) instead of `prisma-client-js` — slightly slower than `better-sqlite3` for local dev today
- Driver: `@prisma/adapter-libsql` + `@libsql/client` instead of `better-sqlite3` (drops native binding requirement)
- `prisma/generated/` (~880K) + `prisma/dev.db` + `prisma/dev.sql` all committed to git
- `app/Providers/SeedDbProvider.ts` that replays `prisma/dev.sql` against `:memory:` when `isWebContainer()`
- No `postinstall: prisma generate` (WC pnpm refuses to run it; regular Node loses convenience)
- `DATABASE_URL` defaults to `:memory:` under `isWebContainer()`
- Excluded packages from the multiselect: broadcast, sync, queue-bullmq, better-sqlite3, y-websocket, yjs, ws (raw TCP / native bindings)

This is the recipe in `playground-web/` and `rudder-web-playground` — the preset just codifies it.

**Result: three-tier distribution**

- `pnpm create rudder-app` — regular Node, but boots cleanly if dropped into WC (Tier 1)
- `pnpm create rudder-app --preset web` — optimized to fork directly into StackBlitz (Tier 1 + Tier 2)
- `git clone github.com/rudderjs/rudder-web-playground` — canonical "Try in browser" target (the latter two overlap heavily)

### Phase 6 — Homepage integration (~1h) — **READY (pending Phase 4 manual click-through)**

- Hero button on rudderjs.com homepage: "Try in browser →" pointing at `https://stackblitz.com/github/rudderjs/rudder-web-playground`
- `/docs/installation` mentions it as the no-install path
- Optional: dedicated `/docs/try-in-browser` page covering what's included and what's omitted (broadcast/sync)

The boot works. Hold the homepage button until Phase 4 click-through confirms register/login, todo CRUD, telescope/pulse/horizon, and AI agent all work end-to-end in StackBlitz.

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

## Closing note (2026-05-01)

This project's actual goal was **proof of concept**: demonstrate that RudderJS can run in WebContainer. That proof is in — `rudder-web-playground` boots clean in StackBlitz, and the scaffolder produces apps that survive a sandbox runtime gracefully.

The original plan (Phase 6 homepage button, `--preset web`, ongoing StackBlitz QA) anticipated a productionization arc that we explicitly chose not to pursue. Reasons: (a) maintenance cost of a second scaffolder recipe in sync with the standalone repo isn't justified by the audience size, (b) "Try in browser" wasn't a positioning priority, (c) the load-bearing engineering wins (`isWebContainer()` gating discipline, `appendToGroup` static-import fix in PR #131, ESM-only peer resolution rules) all transfer to the next sandboxed-runtime story (Workers, Deno, RN) without needing the StackBlitz demo as a destination.

Reconsider only if WC compatibility becomes a marketing/positioning surface, or if a user explicitly asks for a `create-rudder-app --preset web` shortcut and the standalone repo's package selection is the wrong default for them.
