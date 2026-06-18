# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

**Extended docs** (read on-demand when relevant):
- `claude-notes/packages.md` — Full monorepo layout + package status table
- `claude-notes/architecture.md` — Architecture deep-dive (middleware groups, provider discovery, views, terminal, bootstrap pattern, package merge policy)
- `claude-notes/playground.md` — Playground structure and ORM twins
- `claude-notes/pitfalls.md` — Common pitfalls (ORM, HMR, cookies, IP, client bundle, etc.)
- `claude-notes/create-app.md` — create-rudder scaffolder details
- `claude-notes/ai-sdk-comparison.md` — Rudder vs Laravel AI vs Vercel AI SDK vs TanStack — feature matrix and design positioning
- `claude-notes/db-orm-comparison.md` — Rudder data layer vs Prisma/Drizzle/TypeORM/Kysely/MikroORM — feature matrices, positioning (§13), prioritized gap work-queue (§14)
- `Architecture.md` — High-level package map + dependency flow (read for orientation; not exhaustive)
- `ROADMAP.md` — Plans 1–10 all ✅ DONE (Nightwatch dropped 2026-06-06 — standalone product, not framework work)

---

## Project Overview

**Rudder** is a Laravel-inspired, framework-agnostic Node.js meta-framework built on top of **Vike + Vite**. It brings Laravel's developer experience (DI container, Eloquent-style ORM, Rudder CLI, middleware, form requests, queues) to the Node.js ecosystem — while remaining modular and UI-agnostic.

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
pnpm rudder      # Rudder CLI (tsx node_modules/@rudderjs/cli/src/index.ts)
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
