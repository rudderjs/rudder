# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

**Extended docs** (read on-demand when relevant):
- `docs/claude/packages.md` — Full monorepo layout + package status table
- `docs/claude/create-app.md` — create-rudder-app scaffolder details

---

## Project Overview

**RudderJS** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It brings Laravel's developer experience (DI container, Eloquent-style ORM, Rudder CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@rudderjs/*`
- **GitHub**: https://github.com/rudderjs/rudder
- **Status**: Early development
- **Open-core**: Panels/media/lexical extracted to [pilotiq](https://github.com/pilotiq/pilotiq); AI agents/collab to pilotiq-pro

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

Prisma (run from `playground/`):
```bash
pnpm exec prisma generate       # Regenerate client after schema changes
pnpm exec prisma db push        # Sync schema → DB (dev, no migrations)
pnpm exec prisma migrate dev    # Create a migration
pnpm rudder db:seed            # Seed via rudder command
```

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

---

## Architecture

### Dependency Flow (summary)

Foundation (contracts, support) → Core (middleware, validation, router, server-hono, core) → Data (orm, cache, queue) → Auth & Security → Communication → Utilities → AI → Monitoring (telescope, pulse, horizon) → Testing/CLI/Build

> **Cycle resolution**: `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer('@rudderjs/router')`. Never add `@rudderjs/core` to router's `dependencies` or `devDependencies`.

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
- **Welcome page** (`app/Views/Welcome.tsx` with `export const route = '/'`) is the default landing page scaffolded by `create-rudder-app`. Auth-aware: shows Log in / Register links or a signed-in user with a Sign out button.

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
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60).toHandler())
  })
  .create()
```

---

## Playgrounds

Three playgrounds exist across three repos, one per tier of the open-core stack. All three can run simultaneously.

| Playground | Repo | Port | HMR | Purpose |
|---|---|---|---|---|
| `rudderjs/playground` | rudderjs | 3000 | 24678 | Pure framework demo — auth, routing, ORM, queue, mail, cache, storage, scheduling, broadcast, live, telescope/pulse/horizon, Agents (`@rudderjs/ai`). **Zero** `@pilotiq/*` or `@pilotiq-pro/*` deps. |
| `pilotiq/playground` | pilotiq | 3001 | 24679 | Free pilotiq dogfood — panels + lexical (local-only) + media. **No** AI chat, **no** collab, **no** `@pilotiq-pro/*`. |
| `pilotiq-pro/playground` | pilotiq-pro | 3002 | 24680 | Full-stack pro dogfood — framework + free pilotiq + `@pilotiq-pro/{ai,collab}`. AI chat sidebar, `✦` field actions, collab, sub-agents. |

### Running

```bash
cd ~/Projects/rudderjs/playground  && pnpm dev   # :3000
cd ~/Projects/pilotiq/playground   && pnpm dev   # :3001
cd ~/Projects/pilotiq-pro/playground && pnpm dev # :3002
```

> Always run `pnpm build` from the **rudderjs** root before running any playground — packages must be compiled first.

### Cross-repo wiring

All three resolve `@rudderjs/*` to `link:../rudderjs/packages/<name>` via `pnpm.overrides` in each repo's root `package.json`. `pilotiq-pro` also overrides `@pilotiq/*` to `link:../pilotiq/packages/<name>`. No git submodules; just sibling clones on disk.

### rudderjs/playground structure

```
playground/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [log, database, session, hash, cache, auth, queue, events, mail, storage, localization, scheduler, notifications, broadcasting, live, ai, boost, telescope, pulse, horizon, AppServiceProvider]
├── config/             # app, server, database, auth, queue, mail, cache, storage, ai, log, telescope, pulse, horizon, index
├── app/
│   ├── Models/User.ts
│   ├── Agents/ResearchAgent.ts   # @rudderjs/ai framework demo
│   ├── Modules/Todo/             # self-contained module with its own .prisma + test
│   ├── Views/                    # Laravel-style view() components (controller-returned)
│   │   ├── Welcome.tsx           #   `export const route = '/'` → served at /
│   │   ├── Home.tsx / About.tsx  #   id-derived URLs — /home, /about
│   │   └── Auth/                 #   vendored from @rudderjs/auth/views/react/
│   │       └── {Login,Register,ForgotPassword,ResetPassword}.tsx
│   └── Providers/AppServiceProvider.ts
├── routes/
│   ├── web.ts          # Web routes: welcome + registerAuthRoutes() + redirects/guards
│   ├── api.ts          # JSON API routes (router.get/post/all())
│   └── console.ts      # rudder.command() + db:seed + scheduler
├── pages/              # Vike file-based routing; `pages/__view/` is auto-generated
├── prisma/schema/      # multi-file: auth, base, live, notification, app (Todo only)
└── vite.config.ts
```

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
- **`workspace:*` not resolving**: Run `pnpm install` from root after adding a new local dependency
- **Stale `dist/`**: Run `pnpm build` from root before running the playground
- **Prisma client missing**: Run `pnpm exec prisma generate` from `playground/`
- **Decorator errors**: Ensure `experimentalDecorators` and `emitDecoratorMetadata` in tsconfig.json
- **Circular dep**: Never add `@rudderjs/core` to router/server-hono's `dependencies` — `peerDependencies` only
- **Port in use**: `lsof -ti :24678 -ti :3000 | xargs kill -9`
- **`rudder` commands not appearing**: Run from `playground/` (needs `bootstrap/app.ts`)
- **RateLimit not working**: Requires a cache provider registered before middleware runs
- **S3 disk errors**: Install `@aws-sdk/client-s3` — it's an optional dep of `@rudderjs/storage`
- **SPA nav falling back to full reloads between view() routes**: the controller URL must match the URL in the view's generated `+route.ts`. Add `export const route = '/...'` at the top of the view file so the scanner picks it up instead of using the id-derived default.
- **Ghost signed-in user across requests**: `AuthManager` must not cache `SessionGuard` instances — the manager is a process-wide DI singleton and a cached guard's `_user` field leaks across requests. Fixed; don't re-introduce the `_guards` Map.
- **Multi-renderer installed error from the view scanner**: install exactly one of `vike-react` / `vike-vue` / `vike-solid`. Multi-framework scaffolder projects with no `app/Views/` are fine because detection is lazy.
