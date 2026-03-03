# Package Catalog

All `@boostkit/*` packages are published to npm individually. Install only what your project needs.

## Core

| Package | Description | Install |
|---|---|---|
| [@boostkit/contracts](./core/contracts) | Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters. | `pnpm add @boostkit/contracts` |
| [@boostkit/support](./core/support) | Shared utility primitives — collections, env access, config lookup, and helper functions. | `pnpm add @boostkit/support` |
| [@boostkit/di](./core/di) | Dependency injection container with decorators for constructor injection. | `pnpm add @boostkit/di` |
| [@boostkit/middleware](./core/middleware) | HTTP middleware base class, pipeline runner, and built-in implementations. | `pnpm add @boostkit/middleware` |
| [@boostkit/validation](./core/validation) | Zod-powered request validation with FormRequest and middleware helpers. | `pnpm add @boostkit/validation` |
| [@boostkit/artisan](./artisan) | CLI registry, Command base class, and the global `artisan` singleton. | `pnpm add @boostkit/artisan` |
| [@boostkit/cli](/cli/) | Code generators (`make:*`, `make:module`) and artisan command dispatcher. Install as a dev dependency. | `pnpm add -D @boostkit/cli` |
| [@boostkit/core](./core/) | Application bootstrap, service provider lifecycle, and framework-level runtime orchestration. | `pnpm add @boostkit/core` |

## Server

| Package | Description | Install |
|---|---|---|
| [@boostkit/router](./server/router) | Fluent HTTP router and decorator-based controller support — the global `router` singleton. | `pnpm add @boostkit/router` |
| [@boostkit/server-hono](./server/hono) | Hono-based HTTP server adapter with unified request logging and CORS support. | `pnpm add @boostkit/server-hono` |

## ORM

| Package | Description | Install |
|---|---|---|
| [@boostkit/orm](./orm/) | ORM contract interface, Model base class, QueryBuilder, and ModelRegistry. | `pnpm add @boostkit/orm` |
| [@boostkit/orm-prisma](./orm/prisma) | Prisma adapter for @boostkit/orm — multi-driver (PostgreSQL, SQLite, libSQL). | `pnpm add @boostkit/orm-prisma` |
| [@boostkit/orm-drizzle](./orm/drizzle) | Drizzle ORM adapter — multi-driver (sqlite, postgresql, libsql) with DrizzleTableRegistry. | `pnpm add @boostkit/orm-drizzle` |

## Queue

| Package | Description | Install |
|---|---|---|
| [@boostkit/queue](./queue/) | Queue contract interface, Job base class, and `queue:work` artisan command. | `pnpm add @boostkit/queue` |
| [@boostkit/queue-bullmq](./queue/bullmq) | BullMQ Redis-backed queue adapter with job registry and graceful shutdown. | `pnpm add @boostkit/queue-bullmq` |
| [@boostkit/queue-inngest](./queue/inngest) | Inngest adapter for durable, event-driven background jobs. | `pnpm add @boostkit/queue-inngest` |

## Auth

| Package | Description | Install |
|---|---|---|
| [@boostkit/auth](./auth/) | Shared authentication types — AuthUser, AuthSession, AuthResult. | `pnpm add @boostkit/auth` |
| [@boostkit/auth](./auth/better-auth) | better-auth adapter — `betterAuth()` factory, Prisma wiring, `/api/auth/*` mount. | `pnpm add @boostkit/auth` |

## Cache

| Package | Description | Install |
|---|---|---|
| [@boostkit/cache](./cache/) | Cache facade, built-in MemoryAdapter, and `cache()` factory. Redis driver built-in (requires `ioredis`). | `pnpm add @boostkit/cache` |

## Storage

| Package | Description | Install |
|---|---|---|
| [@boostkit/storage](./storage/) | Storage facade, local + S3/R2/MinIO drivers, `storage()` factory, and `storage:link` artisan command. | `pnpm add @boostkit/storage` |

## Mail

| Package | Description | Install |
|---|---|---|
| [@boostkit/mail](./mail/) | Mailable base class, Mail facade, built-in LogAdapter, and `mail()` factory. | `pnpm add @boostkit/mail` |
| [@boostkit/mail-nodemailer](./mail/nodemailer) | Nodemailer SMTP adapter — optional peer for the `smtp` driver. | `pnpm add @boostkit/mail-nodemailer` |

## Features

| Package | Description | Install |
|---|---|---|
| [@boostkit/events](./events) | EventDispatcher, Listener interface, `dispatch()` helper, and `events()` factory. | `pnpm add @boostkit/events` |
| [@boostkit/schedule](./schedule) | Task scheduler — `schedule` singleton, `scheduler()` factory, and `schedule:run/work/list` commands. | `pnpm add @boostkit/schedule` |
| [Rate Limiting](./rate-limit) | Cache-backed rate limiting via `@boostkit/middleware` — `RateLimit.perMinute/Hour/Day` and `X-RateLimit-*` headers. | `pnpm add @boostkit/middleware` |
| [@boostkit/notification](./notification) | Multi-channel notifications (mail, database) — Notifiable, Notification, ChannelRegistry, `notify()`. | `pnpm add @boostkit/notification` |
