# What is Forge?

Forge is a **Laravel-inspired, framework-agnostic Node.js meta-framework** built on top of [Vike](https://vike.dev) and [Vite](https://vitejs.dev). It brings Laravel's developer ergonomics — service providers, dependency injection, an Eloquent-style ORM, an Artisan CLI, queues, scheduling, and more — to the Node.js ecosystem, while remaining modular and UI-agnostic.

## Philosophy

### Laravel's DX, TypeScript's Safety

Laravel has earned its reputation for developer happiness. Forge takes the patterns that make Laravel productive — expressive APIs, convention over configuration, clear lifecycle hooks — and rebuilds them in TypeScript from the ground up, without the PHP runtime or Composer ecosystem.

### Modular by Design

Every Forge feature lives in its own npm package under the `@forge/*` scope. Use only what you need:

```bash
pnpm add @forge/core @forge/server-hono @forge/orm-prisma
```

There is no monolithic "install everything" step. Queue support, caching, auth, notifications — all optional.

### Framework-Agnostic UI

Forge uses [Vike](https://vike.dev) as its SSR/routing layer, which means you can pair it with any UI framework:

- **React** — the playground default
- **Vue** — first-class support
- **Solid** — supported
- **No frontend** — pure API mode works out of the box

### WinterCG-Compatible Runtime

Every Forge app exports a standard [WinterCG Fetch handler](https://wintercg.org/):

```ts
// src/index.ts
export default { fetch: forge.handleRequest }
```

This means you can deploy to Node.js, Cloudflare Workers, Deno Deploy, Bun, or any runtime that speaks the Fetch API.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite + TypeScript |
| SSR/Routing | Vike |
| HTTP | Hono (default), Express, Fastify, H3 (adapters) |
| ORM | Prisma (default), Drizzle |
| Auth | better-auth |
| Queue | BullMQ (Redis), Inngest |
| Cache | In-memory (default), Redis |
| Storage | Local filesystem (default), S3/R2/MinIO |
| Mail | Log (dev default), SMTP via Nodemailer |
| Scheduling | croner |

## Dependency Architecture

Forge is structured as a clean DAG — no circular dependencies:

```
@forge/contracts   (pure types, no runtime)
       │
@forge/support     (Env, Collection, helpers)
@forge/di          (Container, decorators)
@forge/middleware  (Pipeline, built-ins)
@forge/validation  (FormRequest, z)
       │
@forge/router      @forge/server-hono
       │
@forge/core        (Application, ServiceProvider, bootstrap)
       │
@forge/orm         @forge/queue    @forge/cache    @forge/storage
       │                │               │               │
 orm-prisma        queue-bullmq    cache-redis      storage-s3
 orm-drizzle       queue-inngest
       │
@forge/auth   @forge/events   @forge/mail   @forge/schedule   @forge/rate-limit
       │
@forge/notification
```

This means you can use `@forge/di` in isolation without pulling in the entire framework.

## Status

Forge is in **early development (v0.0.1)**. All packages are functional, the playground is a working full-stack app, and the API is settling down. We are targeting a stable v1.0 release soon.

- All 28 packages are implemented and type-check cleanly
- The playground demonstrates all major features end-to-end
- Breaking changes may still occur before v1.0

## Next Steps

- [Installation](/guide/installation) — set up your first Forge project
- [Your First App](/guide/your-first-app) — build a working API endpoint in under 5 minutes
- [Package Catalog](/packages/) — explore all available packages
