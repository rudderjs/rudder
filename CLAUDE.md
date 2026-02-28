# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forge is a Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite. It's a pnpm monorepo managed with Turbo. All packages are under the `@forge/*` npm scope and are at early-development version `0.0.1`.

## Commands

All commands run from the repo root using **pnpm** and **Turbo**:

```bash
pnpm build        # Build all packages (turbo run build)
pnpm dev          # Start dev mode with watch (turbo run dev)
pnpm lint         # Lint all packages (turbo run lint)
pnpm typecheck    # Type-check all packages (turbo run typecheck)
pnpm clean        # Remove all dist/ directories (turbo run clean)
```

To work on a single package:
```bash
cd packages/core
pnpm build        # tsc
pnpm dev          # tsc --watch
pnpm typecheck    # tsc --noEmit
```

There are no tests yet — `testing` package is planned but not implemented.

## Monorepo Layout

```
packages/          # Framework packages (@forge/*)
adapters/          # UI adapters (@forge/adapter-react, vue, solid)
create-forge-app/  # CLI scaffolder
playground/        # Demo app showing framework usage
```

## Architecture

### Core Abstractions

**`@forge/di`** — Custom DI container (lighter than tsyringe/InversifyJS):
- `Container`: `bind()`, `singleton()`, `instance()`, `make()`
- `@Injectable()` class decorator — marks a class for auto-resolution
- `@Inject(token)` parameter decorator — overrides injection token
- Uses `reflect-metadata` for constructor type reflection

**`@forge/core`** — Application lifecycle:
- `Application` singleton wraps the DI container
- `ServiceProvider` abstract class with `register()` and `boot()` lifecycle hooks
- Global helpers: `app()`, `resolve()`

**`@forge/router`** — Decorator-based routing wrapping Vike:
- `@Controller(prefix)`, `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()`, `@Options()`
- `@Middleware([...])` for route or controller-level middleware
- Global `router` instance; call `router.registerController()` then `router.mount(server)`

**`@forge/server`** — Abstract server adapter interface. Concrete adapters: `server-hono`, `server-express`, `server-fastify`, `server-h3`.

**`@forge/orm`** — Abstract ORM contract. Adapters: `orm-prisma`, `orm-drizzle`.

**`@forge/queue`** — Abstract queue interface. Adapters: `queue-inngest`, `queue-bullmq`.

**`@forge/validation`** — Laravel-style `FormRequest` wrapping Zod schemas.

**`@forge/middleware`** — Middleware pipeline used by the HTTP kernel.

**`@forge/support`** — Shared utilities, `Collection` class, env helpers.

### Package Dependency Flow

```
@forge/support
    ↑
@forge/di ← @forge/core
                ↑
    @forge/router, @forge/middleware, @forge/orm, @forge/queue
                ↑
    server-*, orm-*, queue-* adapters
```

### TypeScript Configuration

All packages extend `tsconfig.base.json` at the root:
- `experimentalDecorators: true` and `emitDecoratorMetadata: true` — required for DI/routing decorators; all packages that use decorators must import `reflect-metadata`
- `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`
- `module: "NodeNext"`, `moduleResolution: "NodeNext"` — use `.js` extensions in imports even for `.ts` source files
- Outputs to `dist/` with declaration files and source maps

### Key Conventions

- Each package has its own `tsconfig.json` extending the base, building to `dist/`
- Package `main`/`exports` always point to `dist/index.js`
- Turbo's build graph respects `^build` dependencies — changing a package rebuilds all downstream dependents
- The `playground/` demonstrates the intended public API and is the primary integration reference
