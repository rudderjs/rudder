# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

**Extended docs** (read on-demand when relevant):
- `docs/claude/packages.md` — Full monorepo layout + package status table
- `docs/claude/panels.md` — Panels, Lexical, collaborative editing architecture
- `docs/claude/create-app.md` — create-rudderjs-app scaffolder details

---

## Project Overview

**RudderJS** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It brings Laravel's developer experience (DI container, Eloquent-style ORM, Rudder CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

- **Monorepo**: pnpm workspaces + Turborepo
- **Language**: TypeScript (strict, ESM, NodeNext)
- **npm scope**: `@rudderjs/*`
- **GitHub**: https://github.com/rudderjs/rudder
- **Status**: Early development — 38 packages published to npm

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

Foundation (contracts, support) → Core (middleware, validation, router, server-hono, core) → Data (orm, cache, queue) → Auth & Security → Communication → Utilities → AI → Admin Panels → Testing/CLI/Build

> **Cycle resolution**: `@rudderjs/core` loads `@rudderjs/router` at runtime via `resolveOptionalPeer('@rudderjs/router')`. Never add `@rudderjs/core` to router's `dependencies` or `devDependencies`.

### Dynamic Provider Registration

Providers can be registered at runtime via `app().register(ProviderClass)`:

- Called from within another provider's `boot()` method
- Calls `register()` immediately; calls `boot()` if app is already booted or booting
- Duplicate guard by class reference and class name — safe to call multiple times

```ts
// Inside a provider's boot()
app().register(PanelServiceProvider)

// Panels extensions use Panel.use()
Panel.make('admin')
  .use(media({ conversions: [...] }))
  .use(panelsLexical())
  .resources([...])
```

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

## Playground Structure

```
playground/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [hash, auth, events, queue, mail, notifications, cache, storage, scheduler, DatabaseServiceProvider, AppServiceProvider]
├── config/             # app, server, database, auth, queue, mail, cache, storage, index
├── app/
│   ├── Models/User.ts
│   ├── Services/UserService.ts
│   └── Providers/DatabaseServiceProvider.ts + AppServiceProvider.ts
├── routes/
│   ├── api.ts          # router.get/post/all()
│   └── console.ts      # rudder.command()
├── pages/              # Vike file-based routing
├── prisma/schema.prisma
└── vite.config.ts
```

**Provider boot order**: `DatabaseServiceProvider` must come before any provider that uses ORM models.

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
