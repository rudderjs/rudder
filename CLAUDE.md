# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

**Extended docs** (read on-demand when relevant):
- `claude-notes/packages.md` — Full monorepo layout + package status table
- `claude-notes/create-app.md` — create-rudder scaffolder details
- `claude-notes/ai-sdk-comparison.md` — RudderJS vs Laravel AI vs Vercel AI SDK vs TanStack — feature matrix and design positioning
- `claude-notes/db-orm-comparison.md` — RudderJS data layer vs Prisma/Drizzle/TypeORM/Kysely/MikroORM — feature matrices, positioning (§13), prioritized gap work-queue (§14)
- `Architecture.md` — High-level package map + dependency flow (read for orientation; not exhaustive)
- `ROADMAP.md` — Plans 1–10 all ✅ DONE (Nightwatch dropped 2026-06-06 — standalone product, not framework work)

---

## Project Overview

**RudderJS** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It brings Laravel's developer experience (DI container, Eloquent-style ORM, Rudder CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@rudderjs/*`
- **GitHub**: https://github.com/rudderjs/rudder
- **Status**: 1.0 graduated 2026-05-02 (every `@rudderjs/*` package on npm is 1.0.0+; zero packages on 0.x).

---

## Commands

All commands run from the **repo root**:

```bash
pnpm build        # Build all packages via Turbo
pnpm dev          # Watch mode for all packages
pnpm typecheck    # Type-check all packages
pnpm clean        # Remove all dist/ directories
```

Working on a single package:
```bash
cd packages/core
pnpm build        # tsc
pnpm dev          # tsc --watch
pnpm typecheck    # tsc --noEmit
```

Running the playground (demo app):
```bash
cd playground
pnpm dev          # vike dev (Vite + SSR)
pnpm rudder      # RudderJS CLI (tsx node_modules/@rudderjs/cli/src/index.ts)
```

> Always run `pnpm build` from root before `pnpm dev` in playground — packages must be compiled first.

Database — `playground/` runs the **native engine** (migrations in `database/migrations/`, typed registry at `.rudder/types/models.d.ts`, committed); its twin `playground-prisma/` is the same app on the **Prisma adapter**:
```bash
# playground/ (native)
pnpm rudder migrate             # Apply migrations + regenerate the typed registry
pnpm rudder schema:types        # Regenerate the registry without a migrate
pnpm rudder db:seed             # Run DatabaseSeeder

# playground-prisma/ (Prisma)
pnpm rudder db:generate         # Regenerate client (Prisma) — no-op for Drizzle
pnpm rudder db:push             # Sync schema → DB (dev, no migrations)
```

Raw Prisma still works in `playground-prisma/` (`pnpm exec prisma <subcommand>`) when you need a Prisma-specific flag.

---

## Publishing

Changesets is set up for release management:

```bash
pnpm changeset            # Create a changeset (select packages + describe changes)
pnpm changeset:version    # Bump versions + update CHANGELOGs
pnpm release              # Build + publish all changed packages to npm
```

For a single package:
```bash
cd packages/<name>
pnpm publish --access public --no-git-checks
```

npm requires browser passkey auth — press Enter when prompted to open the browser.

**Which PRs need a changeset:**

| Prefix | Changeset? | Why |
|---|---|---|
| `fix:` (real user-affecting bug) | **yes** (patch) | Otherwise the fix sits on `main` without a published bump |
| `feat:` | **yes** (minor; `feat!:` → major) | New surface |
| `refactor:` (internal, public API unchanged) | no | No user-visible change |
| `test:` / `docs:` / `chore:` / `ci:` | no | Not published |

Watch compound prefixes — `fix+test:` on a recent PR shipped the bug fix without a changeset and had to be added retroactively. Quick check before push: `git diff --stat main..HEAD .changeset/` should show a new file for any `fix:`/`feat:` PR.

---

## Architecture

### Dependency Flow (summary)

Foundation (contracts, support) → Core (middleware, validation, router, server-hono, core) → Data (database, orm, cache, queue) → Auth & Security → Communication → Utilities → AI → Monitoring (telescope, pulse, horizon) → Testing/CLI/Build

> **Cycle resolution**: `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer('@rudderjs/router')`. Never add `@rudderjs/core` to router's `dependencies` or `devDependencies`.

### Middleware Groups (web / api)

Routes loaded via `withRouting({ web })` are tagged `'web'`; via `withRouting({ api })` tagged `'api'`. The server adapter prepends the matching group's middleware stack before per-route middleware, Laravel-style.

- **`m.web(...)` / `m.api(...)`** in `withMiddleware((m) => ...)` — append to a named group's stack.
- **`m.use(...)`** — global, runs on every request regardless of group (order: `m.use` → group → per-route → handler).
- **`appendToGroup('web' | 'api', handler)`** (core export) — provider-facing helper. Framework packages install into a group during `boot()` instead of calling `router.use()` globally.
- **`@rudderjs/session`** auto-installs `sessionMiddleware` on the `web` group.
- **`@rudderjs/auth`** auto-installs `AuthMiddleware` on the `web` group.
- **API routes are stateless by default** — no `req.user`, no session. Opt into bearer auth per-route with `RequireBearer()` + `scope(...)` from `@rudderjs/passport`, or `RequireAuth('api')` with a token guard.
- **`SessionGuard.user()` soft-fails** when no session ALS context — matches Laravel's `Auth::user()` semantics (returns `null`, never throws).
- Route loaders run **serially**, not via `Promise.all`, because group tagging uses a module-level variable in `@rudderjs/router` that concurrent loaders would clobber. Sequential execution is negligibly slower for ≤4 loaders.

### Dynamic Provider Registration

Providers can be registered at runtime via `app().register(ProviderClass)`:

- Called from within another provider's `boot()` method
- Calls `register()` immediately; calls `boot()` if app is already booted or booting
- Duplicate guard by class reference and class name — safe to call multiple times

```ts
// Inside a provider's boot()
app().register(SomeServiceProvider)
```

### Controller Views (`@rudderjs/view`)

Routes return `view('id', props)` and the page is rendered through Vike's SSR pipeline — Laravel ergonomics, Vike performance, no Inertia adapter. View files live in `app/Views/**` and are discovered by `@rudderjs/vite`'s scanner at dev/build time.

- **Id → URL mapping** is 1:1 by default (`'dashboard'` → `/dashboard`, `'admin.users'` → `/admin/users`). Override by exporting a `route` constant at the top of the view file: `export const route = '/'` or `export const route = '/login'`. **Required** whenever the controller URL diverges from the id-derived path — otherwise Vike's client route table doesn't match the browser URL and SPA nav falls back to full reloads.
- **Framework support**: React / Vue / Solid / vanilla (Blade equivalent — HTML-string functions, zero client JS). Scanner auto-detects the installed `vike-*` renderer. Vanilla views should use the `html\`\`` tagged template from `@rudderjs/view` for auto-escaping.
- **Packages shipping views** follow the shape `packages/<name>/views/<framework>/<Name>.{tsx,vue}` + `src/routes.ts` exporting `registerXRoutes(router, opts)`. `@rudderjs/auth` is the reference implementation — see `feedback_package_ui_shape.md` in memory.
- **Welcome page** (`app/Views/Welcome.tsx` with `export const route = '/'`) is the default landing page scaffolded by `create-rudder`. Auth-aware: shows Log in / Register links or a signed-in user with a Sign out button.
- **Typed `view()` calls** — when a view file exports `interface Props` (or `type Props`), `@rudderjs/vite`'s scanner emits `.rudder/types/views.d.ts` mapping the view id to `import('App/Views/<file>').Props`. The corresponding `view('id', ...)` call is then type-checked at the controller. Views without `Props` keep the loose `Record<string, unknown>` behavior — opt in per view, no migration required. See `docs/guide/typed-views.md`.

### Terminal Views (`@rudderjs/terminal`)

Commands return `terminal('id', props)` and the component is rendered in the terminal via Ink (React 19). Component files live in `app/Terminal/**`, discovered by convention at runtime (no Vite scanner needed — commands run in Node).

- **Id → file mapping**: `'dashboard'` → `app/Terminal/Dashboard.tsx`, `'admin.users'` → `app/Terminal/Admin/Users.tsx` (same dot-notation as `view()`)
- **React 19 required**: `ink@7+` requires `react>=19.2.0`. Do not use `ink@5.x` — it crashes against React 19's internals.
- **TTY guard**: `terminal()` throws a clear error in non-interactive environments (CI, piped output). Check `process.stdout.isTTY` if you need a no-op fallback.
- **Exit signal**: use `useApp().exit()` from Ink to signal completion. Without it, the command hangs until `Ctrl+C`.
- **Scaffolder**: `pnpm rudder make:terminal <Name>` generates `app/Terminal/<Name>.tsx` with a stub component.

### Package Merge Policy (Tight-Coupling Only)

Merge packages only when they are effectively one runtime unit.

Checklist before merging:

1. **Always co-deployed**: both packages are always installed/booted together.
2. **Shared lifecycle**: they register/boot together and one has no meaningful standalone behavior.
3. **No adapter boundary**: package is not a plugin/driver integration surface.
4. **No portability boundary**: package is not optional due to runtime/environment constraints.
5. **Same release cadence**: they nearly always change together.
6. **Low blast radius**: merge does not force widespread import/dependency churn.

If any item fails, keep packages separate.

### Bootstrap Pattern (Laravel 11-style)

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { requestIdMiddleware } from 'App/Http/Middleware/RequestIdMiddleware.ts'
import config from '../config/index.ts'
import providers from './providers.ts'

// `server:` is optional — omitted, core auto-resolves @rudderjs/server-hono
// with config('server'). Pass `server: hono(config.server)` to override.
export default Application.configure({ config, providers })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    // Global — runs on every request, regardless of group
    m.use(requestIdMiddleware)

    // Per-group — only the matching route loader's stack gets these
    m.web(RateLimit.perMinute(60))
    m.web(CsrfMiddleware({ exclude: ['/paddle/webhook'] }))
  })
  .create()
```

```ts
// bootstrap/providers.ts
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ /* event → listeners map */ }),
  AppServiceProvider,
]
```

### Provider Auto-Discovery

Framework providers are auto-discovered from each package's `package.json` `rudderjs` field. The `defaultProviders()` helper reads `bootstrap/cache/providers.json` and returns the right classes in stage + topo order — `foundation → infrastructure → feature → monitoring`, with `depends` resolved within each stage.

**The manifest self-heals at boot** (manifest v3): it carries a fingerprint of the dependency state (`depsHash` = sha256 of the app package.json deps blocks + a lockfile size/mtime stat — stat only, never read; absent in workspace apps where the lockfile lives at the repo root). Missing or stale (raw `pnpm add/remove`) → boot rescans `node_modules` and, in dev, rewrites the manifest (atomic tmp+rename) with one `[RudderJS]` log line. **Production honors a stale manifest** (deterministic boots; warns on stale v3, silent on legacy v2) and scans in memory when it's missing (warn; best-effort write swallowed for read-only FS). No node_modules to scan → 7-entry `BUILTIN_REGISTRY` fallback. `providers:discover` remains as the **build-step primitive** — bundled/serverless deploys must bake the manifest at build time. Note: CLI commands suppress console during `bootApp()`, so the self-heal log lines surface in `pnpm dev`/server boots, not `rudder <cmd>` output. The manifest is gitignored.

**Opt-out paths:**

- **Skip a specific framework provider** — pass `skip` to `defaultProviders()`:
  ```ts
  ...(await defaultProviders({ skip: ['@rudderjs/horizon'] }))
  ```
- **Turn off auto-discovery entirely** — don't call `defaultProviders()`. Import each `*Provider` class explicitly and list them in the array, same as before.
- **Opt a package out of being discovered** — set `rudderjs.autoDiscover: false` in that package's `package.json`. Useful for packages that need explicit positioning or whose `boot()` has side effects that shouldn't fire by default.
- **Load the provider class from a subpath** — set `rudderjs.providerSubpath: "./server"` (or any subpath) in the package's `package.json`. The loader imports `<package>/<providerSubpath>` instead of the main entry. Used by `@rudderjs/ai` so the runtime-agnostic main entry doesn't pull in `@rudderjs/core`.

**`eventsProvider({...})` stays as a function** — it takes a per-app event-listener map, not a config key, so it lives outside auto-discovery and the user adds it manually.

**Dev-mode boot log** — when `app.isDevelopment()` and providers were loaded via `defaultProviders()`, the framework prints them grouped by stage right before `[RudderJS] ready`. Missing packages are immediately visible instead of failing silently when first used. Production stays silent.

For third-party package authors writing their own provider, see `docs/guide/service-providers.md`.

---

## Playground

`playground/` is the framework's own demo app — exercises auth, routing, ORM, queue, mail, cache, storage, scheduling, broadcast, sync, telescope/pulse/horizon, Agents (`@rudderjs/ai`). Pure framework, no extra dependencies.

**Two ORM twins**: `playground/` runs the **native engine** (sqlite, `database/migrations/`, `Model.for<>()` typed models, committed registry); `playground-prisma/` is the same app on the **Prisma adapter** (`prisma/schema/`, delegate table names, cuid ids). Package tables on native mostly use literal delegate-style SQL names (`oAuthClient`, `userMemory`, `notification`, `syncDocument`) so package models run unchanged on both; `@rudderjs/cashier-paddle` instead carries real `@@map` SQL names (`paddle_customers`, …) on its models + a native migration, resolved on Prisma via orm-prisma's SQL-name→delegate fallback (the forward direction other package models will migrate to). Sync persistence on native uses `syncDatabase()` (rides the app's ORM adapter; same `syncDocument` table layout as `syncPrisma()` on the twin).

```bash
cd playground && pnpm dev   # :3000
```

> Always run `pnpm build` from the repo root before running the playground — packages must be compiled first.

### Playground structure

```
playground/
├── .rudder/types/      # generated typed registries (committed; views/routes/models .d.ts)
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [...(await defaultProviders()), eventsProvider({...}), AppServiceProvider]
├── config/             # ai, app, auth, cache, cashier, database, hash, horizon, localization,
│                       #   log, mail, passport, pulse, queue, server, session, storage, sync,
│                       #   telescope + index.ts barrel
├── app/
│   ├── Agents/ResearchAgent.ts   # @rudderjs/ai framework demo
│   ├── Commands/                 # custom rudder commands
│   ├── Events/ + Listeners/      # event dispatching demo
│   ├── Exceptions/               # custom exception renderers
│   ├── Http/                     # Controllers/, Middleware/ (Laravel-style namespace)
│   ├── Jobs/ExampleJob.ts        # queue demo
│   ├── Mail/DemoMail.ts          # mail demo
│   ├── Mcp/                      # MCP servers + tools (Echo + secured)
│   ├── Models/                   # User + demo models (Post/Video/Comment/Tag/Todo use Model.for<>())
│   ├── Modules/Todo/             # self-contained module with service + test
│   ├── Notifications/            # WelcomeNotification + others
│   ├── Providers/AppServiceProvider.ts
│   ├── Services/                 # singleton-ish app services
│   └── Views/                    # Laravel-style view() components (controller-returned)
│       ├── Welcome.tsx           #   `export const route = '/'` → served at /
│       ├── Home.tsx / About.tsx  #   id-derived URLs — /home, /about
│       ├── Auth/                 #   vendored from @rudderjs/auth/views/react/
│       │   └── {Login,Register,ForgotPassword,ResetPassword}.tsx
│       └── Demos/                #   /demos index + 14 framework-feature demos
├── routes/
│   ├── web.ts          # Web routes: welcome + registerAuthRoutes() + redirects/guards
│   ├── api.ts          # JSON API routes (router.get/post/all())
│   └── console.ts      # rudder.command() + db:seed + scheduler
├── pages/              # Vike file-based routing; `pages/__view/` is auto-generated
├── database/migrations/  # native-engine migrations (users, demo tables, package tables)
└── vite.config.ts
```

(`playground-prisma/` keeps the pre-conversion shape: `prisma/schema/` multi-file schema instead of `database/migrations/`, no models registry.)

**Provider boot order**: `DatabaseServiceProvider` (via `database()`) must come before any provider that uses ORM models.

---

## Configuration Layers

| Layer | File(s) | Purpose |
|---|---|---|
| Environment | `.env` | Secrets and environment-specific values |
| Runtime config | `config/*.ts` | Named, typed objects reading from `.env` |
| Framework wiring | `bootstrap/app.ts` | Server adapter, providers, routing |
| Build config | `vite.config.ts` | Vite + Vike plugins |

There is **no `rudderjs.config.ts`** — `bootstrap/app.ts` is the framework wiring file.

---

## TypeScript Conventions

- All packages extend `../../tsconfig.base.json`
- `experimentalDecorators: true` + `emitDecoratorMetadata: true` — required for DI and routing
- Always `import 'reflect-metadata'` at the **entry point**
- `module: "NodeNext"` — use `.js` extensions in all imports
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`

---

## Common Pitfalls

- **Missing `reflect-metadata`**: Add `import 'reflect-metadata'` to entry point; install as dep (not devDep)
- **`process is not defined` / `node:*` crash in a browser bundle**: some `@rudderjs/*` packages are legitimately client-bundled (a `Model` reachable from client code; `app`/`Env` from a shared module). Their entry must evaluate in the browser — no top-level `process.env` read (guard with `typeof process !== 'undefined'`), no static `node:` import in the eval graph (lazy `await import('node:x')` inside a function is fine). For `@rudderjs/core`, import client-reachable symbols from **`@rudderjs/core/client`**, not the main entry (the main entry re-exports the `@clack` CLI chain). The `Client Bundle Smoke` CI gate (`scripts/client-bundle-smoke.mjs`, `pnpm test:client-bundle`) enforces this — add new client-reachable entries to its `TARGETS`.
- **`workspace:*` not resolving**: Run `pnpm install` from root after adding a new local dependency
- **Stale `dist/`**: Run `pnpm build` from root before running the playground
- **Prisma client missing**: Run `pnpm rudder db:generate` (or `pnpm exec prisma generate`) from `playground-prisma/` (the native `playground/` has no client to generate — run `pnpm rudder migrate` there instead)
- **Decorator errors**: Ensure `experimentalDecorators` and `emitDecoratorMetadata` in tsconfig.json
- **Circular dep**: Never add `@rudderjs/core` to router/server-hono's `dependencies` — `peerDependencies` only
- **Port in use**: `lsof -ti :24678 -ti :3000 | xargs kill -9`
- **`rudder` commands not appearing**: Run from `playground/` (needs `bootstrap/app.ts`)
- **RateLimit not working**: Requires a cache provider registered before middleware runs
- **`No session in context` on api routes**: Don't add `sessionMiddleware` to `m.use(...)` (global) — it's auto-installed on the `web` group by `SessionProvider.boot()`. If you need session on a specific api route, add `SessionMiddleware()` per-route (stateless API default is intentional).
- **`req.user` undefined on api routes**: Expected — `AuthMiddleware` runs only on the `web` group. For api auth, use `RequireBearer()` + `scope(...)` (passport) or mount `AuthMiddleware()` per-route.
- **S3 disk errors**: Install `@aws-sdk/client-s3` — it's an optional dep of `@rudderjs/storage`
- **SPA nav falling back to full reloads between view() routes**: the controller URL must match the URL in the view's generated `+route.ts`. Add `export const route = '/...'` at the top of the view file so the scanner picks it up instead of using the id-derived default.
- **Ghost signed-in user across requests**: `AuthManager` must not cache `SessionGuard` instances — the manager is a process-wide DI singleton and a cached guard's `_user` field leaks across requests. Fixed; don't re-introduce the `_guards` Map.
- **Multi-renderer installed error from the view scanner**: install exactly one of `vike-react` / `vike-vue` / `vike-solid`. Multi-framework scaffolder projects with no `app/Views/` are fine because detection is lazy.
- **`ink@5.x` crashes with React 19**: `Cannot read properties of undefined (reading 'ReactCurrentOwner')` — `react-reconciler@0.29.2` (used by Ink 5) accesses React 18 internals that were removed in React 19. Always use `ink@^7.0.0` which requires `react>=19.2.0`.
- **`[RudderJS] @rudderjs/X listed in the provider manifest but not installed`**: a production boot honoring a stale manifest (dev self-heals at boot). Re-bake with `pnpm rudder providers:discover` in the build step.
- **Optional peer fails to load with `No "exports" main defined`**: the package's `exports` field is missing a `default` or `import` condition. `@rudderjs/support`'s `resolveOptionalPeer()` walks `node_modules` and reads `exports['.']['import']` directly as a fallback, but custom resolution paths may not. Add `"default": "./dist/index.js"` to the package's exports if you hit this in your own code.
- **Multi-value Set-Cookie**: when middleware writes more than one cookie cooperatively (CSRF + session is the canonical pair), use `headers.append('Set-Cookie', value)` directly on the existing `Response.headers`. Do NOT clone via `new Response(body, { headers: someHeaders })` — Node's undici-backed `Response` constructor collapses multi-value Set-Cookie down to one. server-hono's `normalizeResponse` tracks `Set-Cookie` separately as an array and `session.save()` appends in place; follow the same pattern in any future cookie-writing middleware.
- **Route/bootstrap/app changes not picked up in dev**: `@rudderjs/vite`'s `rudderjs:routes` plugin watches `routes/`, `bootstrap/`, and `app/` (minus `app/Views/**`, which is on Vike's fast component HMR) and re-bootstraps on change (clearing `__rudderjs_instance__` + `__rudderjs_app__`) because `app/` files (models, resources, controllers) are captured in closures during provider boot. Invalidation is **scoped** to the edited file's import subtree (`invalidateBackendSubtree`), not the whole SSR graph — keeps the framework warm; falls back to `invalidateAll()` when the file isn't tracked. It **always** also re-evaluates the `routes/` loader modules (the dev re-boot does `router.reset()` then re-runs the loaders, so a cached route module wouldn't re-register → 404). To hot-reload a linked package that registers routes/views/config in a provider `boot()`, pass `rudderjs({ watch: ['@scope/pkg'] })` — it watches the package source and `noExternal`s it in dev. Never use `server.restart()` — it closes the module runner and breaks in-flight SSR requests. Diagnose reload timing with `RUDDER_HMR_TRACE=1` (+ `RUDDER_PERF_TRACE=2` for per-provider boot). The watcher **debounces** a burst of events (`performReboot`, ~100ms) so an editor's atomic-write / format-on-save = one re-boot, not two. The re-boot itself is **single-flighted** in `@rudderjs/core` via `globalThis.__rudderjs_boot__` (concurrent re-boots run serially, never interleaving `router.reset()`/`ModelRegistry.set()`), and `handleRequest()` **gates** on the latest in-flight boot — so requests landing in the re-boot window block on a fully-booted graph instead of being served half-booted (empty ORM data). Both core guards are no-ops in production (single boot). Separately, the `orm-prisma` adapter **reuses one `PrismaClient` across re-boots** (cached on `globalThis.__rudderjs_prisma_client__`, a per-connection Map keyed by `connectionName ?? driver::url` since multi-connection support) so an edit doesn't leak a DB connection/pool per re-boot — **don't re-introduce per-re-boot client construction**. Benign on SQLite (a GC-reclaimed file handle) but catastrophic on pooled drivers: each leaked MySQL pool holds ~16–20 server connections → `max_connections` (151) exhaustion in ~9–10 edits. A changed connection signature disposes the superseded client. No-op in production. (`@rudderjs/orm-prisma@2.0.1`, #652.) **`@rudderjs/orm-drizzle` does the same** — `globalThis.__rudderjs_drizzle_client__`, same per-connection Map keying, disposing the underlying driver (`postgres.end()`/`pool.end()`/`libsql.close()`/`better-sqlite3.close()`) on a signature change; **don't re-introduce per-re-boot client construction there either**.
- **Client IP showing `unknown`**: Use `req.ip` (set by server-hono's `extractIp()`), not raw headers. Resolution is Laravel `Request::ip()` parity: proxy headers (`x-forwarded-for` first hop, then `x-real-ip`) ONLY when `trustProxy` is enabled, then the direct socket address in every runtime that exposes one (srvx's `request.ip`/`runtime.node` in the prod server, `env.incoming` under `@hono/node-server`), plus a dev-only `x-real-ip` stand-in injected by `@rudderjs/vite`'s `rudderjs:ip` plugin (the vite pipeline hands the adapter a plain web Request with no socket; branch is gated off `NODE_ENV=production`). Before the socket fallback, `trustProxy=false` (the default) meant `req.ip` was ALWAYS undefined → every client shared one `'unknown'` rate-limit bucket; an ip-keyed `RateLimit` now warns once if `req.ip` is still undefined. Custom `.by()` rate-limit functions must read `req.ip`, not `req.headers['x-real-ip']`. Behind a reverse proxy still set `TRUST_PROXY=true` — otherwise the socket is the proxy's address.
- **Telescope recording toggle not persisting**: recording state lives on `globalThis['__rudderjs_telescope_recording__']` to survive Vite SSR module re-evaluation. The API routes in `api/routes.ts` read/write the same key (no `require()` — ESM only).
- **Telescope incremental build emits nothing**: `tsBuildInfoFile` in `tsconfig.base.json` causes false cache hits. Always build with `--incremental false` or `rm -rf dist` + delete any `.tsbuildinfo` files first.
- **Query results ARE Model instances** (since PR #111, 2026-04-30): every read path — `find`/`first`/`all`/`paginate`/`where(...).first()`/`where(...).get()`/`create`/`update`/`restore`/`firstOrCreate`/`updateOrCreate` — returns objects that are `instanceof Model` with prototype methods bound. Adapters still return plain records; the Model wraps the QueryBuilder via a Proxy. Side effect: `assert.deepStrictEqual(result, plainObject)` no longer holds — node's `deepStrictEqual` checks the prototype, so compare via `{ ...result }` or assert `result instanceof Model`. Use `Model.hydrate(record)` to wrap plain records from outside the ORM (cached JSON, fixtures).
- **Mass assignment is enforced** (since PR #114, 2026-04-30): `static fillable` (allowlist) and `static guarded` (denylist; `['*']` locks all) drop keys outside the policy on `Model.create()`/`Model.update()`/`instance.fill()`. Both default to `[]` (no enforcement). `instance.forceFill(data)` and direct property assignment + `instance.save()` bypass the filter. **Heads-up for `firstOrCreate(attrs, values)`:** `attrs` go through `create()` so lookup keys must be fillable too, otherwise the lookup column won't be set on the new row.
- **Counter columns: use `Model.increment` / `Model.decrement`** (since PR #116, 2026-04-30): atomic SQL `UPDATE col = col ± n` via the QueryBuilder, safe under concurrent writes. Static + instance methods both available; instance variant merges the new value back so `post.viewCount` reflects the update. **Observers do NOT fire** — counter updates are pure data-plane. If you need observer hooks, read the row, set the resolved value, and call `Model.update()` instead.
- **`whereHas` adapter requirements** (since Laravel parity #2 PR3): on Prisma, direct relations (`hasMany`/`hasOne`/`belongsTo`) need an `@relation` declared in `schema.prisma` with the same name — the adapter uses native `some`/`none`. Polymorphic, pivot, AND through relations route through a 2-step lookup so they work without a Prisma-declared relation. On Drizzle, every table referenced from a `whereHas` call — related plus the pivot/through-intermediate when present — must be registered via `tables: { ... }` on `drizzle()` config or `DrizzleTableRegistry.register(name, table)`; missing tables surface a clear error. **Through relations (`hasOneThrough`/`hasManyThrough`) work with `whereHas`/`whereDoesntHave`/`has(op,n)`/`withCount`+aggregates on all 3 adapters** (through-whereHas PR) — the predicate reuses the pivot `through` block with the intermediate in the pivot slot + `fanOut: true`; constrain callbacks apply to the FAR table; counts count FAR rows (never intermediates; a bare intermediate never satisfies existence). **`morphTo` cannot be used with `whereHas`** — the related table is dynamic; filter on `{morphName}Id` / `{morphName}Type` directly. **Nested `whereHas` inside a constrain callback is REAL on the native engine** (nested-callback PR A): children attach to the predicate's `nested` ARRAY (dot-paths keep the singular form), with constraints at EVERY level, inner `whereDoesntHave`, siblings, and unbounded recursion; Drizzle is REAL too (PR B — `_relationExistsExpr` recurses; every table in the chain must be registered). Prisma is REAL for ALL-DIRECT chains (PR C, v1-throw posture — nested `some`/`none`; `_relatedRowsFilter`/`_childRelationLeg`); a pivot/morph/through level is legal only OUTERMOST (its deferred 2-step related filter carries the direct children) — deeper it throws the mixed-chain error (hybrid innermost-first = documented follow-up in the plan: docs/plans/2026-06-07-nested-callback-where-has.md). `withWhereHas` falls back to plain `with(relation)` on adapters that don't implement `withConstrained`, and whenever the callback carries nested children (flat `withConstrained` can't express them). **Drizzle AND native eager loading now work** — `Model.with('hasOne'|'hasMany'|'belongsTo'|'belongsToMany')` resolves in the ORM's Model layer via batched WHERE-IN (both adapters advertise `eagerLoadStrategy: 'model-layer'` on `OrmAdapter`; Prisma omits it → native `include`). The Drizzle adapter's QB-level `with()` still **throws**, but it's now only reachable via the `withWhereHas` *constrained-eager* fallback (`q.with(rel)`) — which Drizzle still can't satisfy. So for constrained eager loading on Drizzle use `whereHas(relation)` (filter-only, never calls `with()`) + load constrained children via `related()`. Nested (`'a.b'`) + polymorphic-via-Model-layer are separate paths; undeclared/nested names throw a clear error. (Eager-with PR + earlier PR3 #826, data-layer arc.)
- **Prisma delegate name vs SQL table name**: `static table` on a Model resolves on the Prisma adapter two ways — the Prisma client delegate (camelCase of the model name, e.g. `oAuthClient`) via `this.prisma[this.table]`, OR the `@@map`'d SQL table name (`oauth_clients`) resolved through the client's runtime datamodel (`@rudderjs/orm-prisma` ≥ the SQL-name-fallback release). The SQL-name form is what lets one model run on BOTH the native engine (literal SQL name) and Prisma — `@rudderjs/cashier-paddle`'s 5 models do this (`paddle_customers` + `keyType: 'ulid'`). Error `[RudderJS ORM] Prisma has no delegate for table "X", and no model … maps to it` = X matches neither a delegate nor any `@@map` name. Most other package models (`oAuthClient`, `userMemory`, …) still carry delegate names — both styles work.
- **Multi-connection essentials**: `config/database.ts`'s `connections` map is a MENU — entries are lazy (registering does no I/O and no driver import); only the default connection boots eagerly, named connections open at first query (config typos surface there, not at boot). `read:`/`write:` on a **Prisma** connection **throws at boot** (single-URL client) — use `@prisma/extension-read-replicas` or `engine: 'native'`; native + Drizzle support split/sticky fully. **Sticky is a no-op outside a request scope** (queue jobs / commands read replicas) — wrap jobs needing read-your-writes in `runWithDatabaseContext` from the node-only `@rudderjs/database/sticky` subpath (`@rudderjs/orm/sticky` re-exports it — same globalThis scope). Transactions are isolated per connection (`transaction(fn, { connection })` never captures default-connection queries). Migrations: `migrate* --connection=<name>` runs a suite on a named NATIVE connection (state table on that connection; `--path=<dir>` for per-database sets; typed-registry regen skipped — it reflects the default schema), and `Schema.connection(name)` scopes one DDL op (resolves via the DB-bridge connection resolver; cross-connection DDL escapes the batch transaction; throws under `--pretend`). Deep detail: `packages/orm/CLAUDE.md` multi-connection bullets + `docs/guide/database/connections.md`.
- **Package commands don't register in CLI**: Domain commands live in their owning package and register via `rudder.command()` in the provider's `boot()` (runtime commands) or via `registerMakeSpecs()` + subpath export (scaffolders). CLI's `loadPackageCommands()` eagerly imports known subpaths. If you add a new package command, add the loader entry in `packages/cli/src/index.ts` and export from a subpath like `@rudderjs/<pkg>/commands/<name>`.
- **Native engine home is `@rudderjs/database`** (Phase-2 relocation #889/#891/#892): compiler, dialects, drivers, `NativeQueryBuilder`, `NativeAdapter`, schema builder/migrator all live there — headline API (`Migration`, `Schema`, `NativeAdapter`) on the main entry, full surface on `@rudderjs/database/native`. `@rudderjs/orm/native` + `@rudderjs/orm/sticky` are permanent re-export shims (app migration files keep working); `NativeDatabaseProvider` stays at `@rudderjs/orm/native/provider` (wires orm-side state; discovery unchanged). `@rudderjs/database` must NEVER depend on `@rudderjs/orm` — devDeps included (turbo graph cycle); Model-coupled engine tests stay in orm. globalThis keys kept their historical names (`__rudderjs_native_client__`, `__rudderjs_orm_sticky__`) — renaming would orphan live drivers across a dev re-boot. Also beware: `stripInternal` + a leading comment merely *mentioning* the JSDoc internal tag strips the next declaration from the emitted d.ts (see `packages/database/CLAUDE.md`).
- **`AiProvider` not exported from `@rudderjs/ai`**: As of the runtime-agnostic split, `AiProvider` lives at `@rudderjs/ai/server`. The main entry is runtime-agnostic (works in RN/browser/Electron renderer); Node-only file helpers live at `@rudderjs/ai/node`. Provider auto-discovery reads `rudderjs.providerSubpath` from `package.json` to load the class from the right subpath — no manual config needed in apps.
- **Node 22 `mock.module()` traps** (when writing tests that mock ESM imports — see [`feedback_node_mock_module_gotchas.md`](memory)): (1) Install at file/module scope, **not** inside a `before()` hook — top-level `before()` re-runs once per top-level describe in Node 22, which trips the duplicate-mock guard. (2) Node keys module mocks on the `file://` URL form, not the bare specifier — for peers loaded via `resolveOptionalPeer` (which does `createRequire().resolve()` first), mock the resolved URL, not the package name. (3) `mock.reset()` does **not** unregister module mocks — install one mock with shared capture arrays, and clear the arrays per-test instead of re-installing. Test scripts also need `--experimental-test-module-mocks` on the `node --test` invocation. Canonical example: `packages/mail/src/nodemailer-adapter.test.ts`.
- **Broadcast drops half its messages on 2+ instance deployments**: the default `LocalDriver` walks an in-process subscriber map only, so a `broadcast()` call on instance B doesn't reach a subscriber on instance A. Install `@rudderjs/broadcast-redis` and set `config.broadcast.driver = () => new RedisDriver({ redis: env.REDIS_URL })` for any deployment with more than one Node process. `broadcast()` is `Promise<void>` since the driver refactor — `await` the call (or `void` it if you don't care about the round-trip).
- **Prerender opt-in is `export const prerender = …`** at the top of a view file (`app/Views/Foo.tsx`). Two forms share the same exported name; the scanner picks output from the RHS shape: `= true` → static (single HTML at the view's URL), `= [...]` or `() => [...]` or `async () => [...]` → dynamic (one HTML per enumerated URL, for parameterized routes like `/blog/@slug`). Static emits `+prerender.ts`; dynamic emits both `+prerender.ts` AND `+onBeforePrerenderStart.ts`. Build-time only — dev still SSRs every request. The controller is NOT called at prerender time, so prerendered views read route params via `usePageContext().routeParams` (dynamic) or render from no per-request props (static). Variable-reference RHS (`= MY_LIST`) is intentionally not detected; inline the list or wrap in a function. Detection is anchored to the start of a logical line so `export const prerender = [...]` appearing inside a string elsewhere in the file (e.g. a `/demos` card description) doesn't false-positive.
- **Typed `route(name, params)` lookups auto-populate**: the `@rudderjs/vite` routes scanner walks `routes/*.ts` for inline `.name('foo')` chains and emits `.rudder/types/routes.d.ts` augmenting `RouteRegistry` — typo names + missing params fail `tsc`. Only literal-path AND literal-name chains are picked up; variable paths (`router.get(loginPath, ...).name(...)`) and runtime-registered routes (e.g. via `registerAuthRoutes(router, opts)`) are NOT auto-discovered — hand-augment the interface for those. Re-run on demand via `pnpm rudder routes:sync` (skip-boot, so it works before `pnpm dev` ever ran).
- **Typed `Env.get()` keys auto-populate**: the `@rudderjs/vite` env scanner parses `.env.example` (the committed contract — NEVER `.env`, which is secret and absent in CI) and emits `.rudder/types/env.d.ts` augmenting support's `EnvRegistry`. Commented-out keys (`# OPENAI_API_KEY=`) are not declared. The loose `Env.get(key: string)` overload stays — packages read keys apps don't declare. `pnpm rudder env:sync` (skip-boot) regenerates AND diffs `.env` against `.env.example` (`--fix` appends missing keys with example values; never deletes).
