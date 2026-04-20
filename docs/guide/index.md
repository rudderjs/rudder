# What is RudderJS?

RudderJS is a **Laravel-inspired, framework-agnostic Node.js meta-framework** built on top of [Vike](https://vike.dev) and [Vite](https://vitejs.dev). It brings Laravel's developer ergonomics — service providers, dependency injection, an Eloquent-style ORM, an Rudder CLI, queues, scheduling, and more — to the Node.js ecosystem, while staying modular, UI-agnostic, and fully typed.

## Philosophy

### Laravel's DX, TypeScript's Safety

Laravel has earned its reputation for developer happiness. RudderJS takes the patterns that make Laravel productive — expressive APIs, convention over configuration, clear lifecycle hooks — and rebuilds them in TypeScript from the ground up, without the PHP runtime or Composer ecosystem.

The result: a framework that feels familiar to Laravel developers and safe to TypeScript developers.

### Modular by Design

Every RudderJS feature lives in its own npm package under the `@rudderjs/*` scope. Use only what you need:

```bash
pnpm add @rudderjs/core @rudderjs/server-hono @rudderjs/orm-prisma
```

There is no monolithic "install everything" step. Queue support, caching, auth, notifications — all optional, all tree-shakable.

### Framework-Agnostic UI

RudderJS uses [Vike](https://vike.dev) as its SSR and page-routing layer, which means you can pair it with any UI framework:

- **React** — full support via `vike-react`
- **Vue** — full support via `vike-vue`
- **Solid** — full support via `vike-solid`
- **Multiple at once** — the scaffolder lets you select several frameworks; each gets its own pages
- **No frontend** — pure API mode works out of the box

The `create-rudder-app` scaffolder asks which frameworks you want, which is primary (drives main pages), and whether to include Tailwind CSS and shadcn/ui. Secondary frameworks get minimal demo pages at `pages/{fw}-demo/`.

### Deploy Anywhere

RudderJS exposes a standard [WinterCG Fetch handler](https://wintercg.org/) through `bootstrap/app.ts`. This means you can deploy to **Node.js, Cloudflare Workers, Deno Deploy, Bun**, or any runtime that speaks the Fetch API — without changing your application code.

## What's Included

| Feature | Package | Notes |
|---------|---------|-------|
| HTTP server | `@rudderjs/server-hono` | Hono adapter with request logger, CORS, error pages |
| Routing | `@rudderjs/router` | Fluent + decorator-based, middleware support |
| Middleware | `@rudderjs/middleware` | Pipeline, CSRF, rate limiting, throttle, CORS |
| Validation | `@rudderjs/core` | Zod-powered, `FormRequest`, `validate()`, `validateWith()` |
| DI container | `@rudderjs/core` | `Container`, `@Injectable`, `@Inject` |
| ORM | `@rudderjs/orm-prisma` / `orm-drizzle` | Prisma or Drizzle adapters |
| Auth | `@rudderjs/auth` | Laravel-style guards, `Auth` facade, Gate/Policy, password reset, email verification |
| Sessions | `@rudderjs/session` | Cookie (HMAC) or Redis driver |
| Queue | `@rudderjs/queue-bullmq` / `queue-inngest` | BullMQ (Redis) or Inngest |
| Cache | `@rudderjs/cache` | In-memory or Redis |
| Storage | `@rudderjs/storage` | Local filesystem or S3/R2/MinIO |
| Mail | `@rudderjs/mail` | Log (dev) or SMTP (Nodemailer) built-in |
| Events | `@rudderjs/core` | In-process event dispatcher |
| Scheduling | `@rudderjs/schedule` | Cron-based task scheduler |
| Notifications | `@rudderjs/notification` | Multi-channel (mail, database) |
| CLI | `@rudderjs/rudder` / `cli` | `make:*` generators, custom commands |

## Dependency Architecture

RudderJS is structured as a clean DAG — no circular dependencies, so you can use any layer in isolation:

```
@rudderjs/contracts   (pure types, no runtime)
       │
@rudderjs/support     (Env, Collection, helpers)
@rudderjs/core        (Application, Container, decorators, service providers)
@rudderjs/middleware  (Pipeline, built-ins, RateLimit)
@rudderjs/validation  (FormRequest, z)
       │
@rudderjs/router      @rudderjs/server-hono
       │
@rudderjs/core        (Application, ServiceProvider, bootstrap)
       │
@rudderjs/orm    @rudderjs/queue    @rudderjs/cache    @rudderjs/storage
       │              │           (redis built-in)   (s3 built-in)
 orm-prisma       queue-bullmq
 orm-drizzle      queue-inngest
       │
@rudderjs/auth                      @rudderjs/mail   @rudderjs/schedule
       │
@rudderjs/notification
```

## Status

RudderJS is in **early development**. All packages are functional, the playground is a working full-stack app, and the API is settling. Breaking changes may still occur before v1.0.

## Next Steps

- [Installation](/guide/installation) — set up your first RudderJS project
- [Your First App](/guide/your-first-app) — build a working API endpoint in minutes
- [Package Catalog](/packages/) — explore all available packages
