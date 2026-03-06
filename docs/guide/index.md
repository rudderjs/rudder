# What is BoostKit?

BoostKit is a **Laravel-inspired, framework-agnostic Node.js meta-framework** built on top of [Vike](https://vike.dev) and [Vite](https://vitejs.dev). It brings Laravel's developer ergonomics — service providers, dependency injection, an Eloquent-style ORM, an Artisan CLI, queues, scheduling, and more — to the Node.js ecosystem, while staying modular, UI-agnostic, and fully typed.

## Philosophy

### Laravel's DX, TypeScript's Safety

Laravel has earned its reputation for developer happiness. BoostKit takes the patterns that make Laravel productive — expressive APIs, convention over configuration, clear lifecycle hooks — and rebuilds them in TypeScript from the ground up, without the PHP runtime or Composer ecosystem.

The result: a framework that feels familiar to Laravel developers and safe to TypeScript developers.

### Modular by Design

Every BoostKit feature lives in its own npm package under the `@boostkit/*` scope. Use only what you need:

```bash
pnpm add @boostkit/core @boostkit/server-hono @boostkit/orm-prisma
```

There is no monolithic "install everything" step. Queue support, caching, auth, notifications — all optional, all tree-shakable.

### Framework-Agnostic UI

BoostKit uses [Vike](https://vike.dev) as its SSR and page-routing layer, which means you can pair it with any UI framework:

- **React** — full support via `vike-react`
- **Vue** — full support via `vike-vue`
- **Solid** — full support via `vike-solid`
- **Multiple at once** — the scaffolder lets you select several frameworks; each gets its own pages
- **No frontend** — pure API mode works out of the box

The `create-boostkit-app` scaffolder asks which frameworks you want, which is primary (drives main pages), and whether to include Tailwind CSS and shadcn/ui. Secondary frameworks get minimal demo pages at `pages/{fw}-demo/`.

### Deploy Anywhere

BoostKit exposes a standard [WinterCG Fetch handler](https://wintercg.org/) through `bootstrap/app.ts`. This means you can deploy to **Node.js, Cloudflare Workers, Deno Deploy, Bun**, or any runtime that speaks the Fetch API — without changing your application code.

## What's Included

| Feature | Package | Notes |
|---------|---------|-------|
| HTTP server | `@boostkit/server-hono` | Hono adapter with request logger, CORS, error pages |
| Routing | `@boostkit/router` | Fluent + decorator-based, middleware support |
| Middleware | `@boostkit/middleware` | Pipeline, CSRF, rate limiting, throttle, CORS |
| Validation | `@boostkit/validation` | Zod-powered, `FormRequest`, `validate()`, `validateWith()` |
| DI container | `@boostkit/core` | `Container`, `@Injectable`, `@Inject` |
| ORM | `@boostkit/orm-prisma` / `orm-drizzle` | Prisma or Drizzle adapters |
| Auth | `@boostkit/auth` | better-auth integration + `AuthMiddleware` |
| Sessions | `@boostkit/session` | Cookie (HMAC) or Redis driver |
| Queue | `@boostkit/queue-bullmq` / `queue-inngest` | BullMQ (Redis) or Inngest |
| Cache | `@boostkit/cache` | In-memory or Redis |
| Storage | `@boostkit/storage` | Local filesystem or S3/R2/MinIO |
| Mail | `@boostkit/mail` / `mail-nodemailer` | Log (dev) or SMTP |
| Events | `@boostkit/core` | In-process event dispatcher |
| Scheduling | `@boostkit/core` | Cron-based task scheduler |
| Notifications | `@boostkit/notification` | Multi-channel (mail, database) |
| CLI | `@boostkit/artisan` / `cli` | `make:*` generators, custom commands |

## Dependency Architecture

BoostKit is structured as a clean DAG — no circular dependencies, so you can use any layer in isolation:

```
@boostkit/contracts   (pure types, no runtime)
       │
@boostkit/support     (Env, Collection, helpers)
@boostkit/core        (Application, Container, decorators, service providers)
@boostkit/middleware  (Pipeline, built-ins, RateLimit)
@boostkit/validation  (FormRequest, z)
       │
@boostkit/router      @boostkit/server-hono
       │
@boostkit/core        (Application, ServiceProvider, bootstrap)
       │
@boostkit/orm    @boostkit/queue    @boostkit/cache    @boostkit/storage
       │              │           (redis built-in)   (s3 built-in)
 orm-prisma       queue-bullmq
 orm-drizzle      queue-inngest
       │
@boostkit/auth                      @boostkit/mail
       │
@boostkit/notification
```

## Status

BoostKit is in **early development**. All packages are functional, the playground is a working full-stack app, and the API is settling. Breaking changes may still occur before v1.0.

## Next Steps

- [Installation](/guide/installation) — set up your first BoostKit project
- [Your First App](/guide/your-first-app) — build a working API endpoint in minutes
- [Package Catalog](/packages/) — explore all available packages
