# Package Catalog

All `@forge/*` packages are published to npm individually. Install only what your project needs.

## Core

| Package | Description | Install |
|---|---|---|
| [@forge/contracts](./core/contracts) | Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters. | `pnpm add @forge/contracts` |
| [@forge/support](./core/support) | Shared utility primitives — collections, env access, config lookup, and helper functions. | `pnpm add @forge/support` |
| [@forge/di](./core/di) | Dependency injection container with decorators for constructor injection. | `pnpm add @forge/di` |
| [@forge/middleware](./core/middleware) | HTTP middleware base class, pipeline runner, and built-in implementations. | `pnpm add @forge/middleware` |
| [@forge/validation](./core/validation) | Zod-powered request validation with FormRequest and middleware helpers. | `pnpm add @forge/validation` |
| [@forge/artisan](./artisan) | CLI registry, Command base class, and the global `artisan` singleton. | `pnpm add @forge/artisan` |
| [@forge/cli](/cli/) | Code generators (`make:*`, `make:module`) and artisan command dispatcher. Install as a dev dependency. | `pnpm add -D @forge/cli` |
| [@forge/core](./core/) | Application bootstrap, service provider lifecycle, and framework-level runtime orchestration. | `pnpm add @forge/core` |

## Server

| Package | Description | Install |
|---|---|---|
| [@forge/router](./server/router) | Fluent HTTP router and decorator-based controller support — the global `router` singleton. | `pnpm add @forge/router` |
| [@forge/server-hono](./server/hono) | Hono-based HTTP server adapter with unified request logging and CORS support. | `pnpm add @forge/server-hono` |

## ORM

| Package | Description | Install |
|---|---|---|
| [@forge/orm](./orm/) | ORM contract interface, Model base class, QueryBuilder, and ModelRegistry. | `pnpm add @forge/orm` |
| [@forge/orm-prisma](./orm/prisma) | Prisma adapter for @forge/orm — multi-driver (PostgreSQL, SQLite, libSQL). | `pnpm add @forge/orm-prisma` |
| [@forge/orm-drizzle](./orm/drizzle) | Drizzle ORM adapter — multi-driver (sqlite, postgresql, libsql) with DrizzleTableRegistry. | `pnpm add @forge/orm-drizzle` |

## Queue

| Package | Description | Install |
|---|---|---|
| [@forge/queue](./queue/) | Queue contract interface, Job base class, and `queue:work` artisan command. | `pnpm add @forge/queue` |
| [@forge/queue-bullmq](./queue/bullmq) | BullMQ Redis-backed queue adapter with job registry and graceful shutdown. | `pnpm add @forge/queue-bullmq` |
| [@forge/queue-inngest](./queue/inngest) | Inngest adapter for durable, event-driven background jobs. | `pnpm add @forge/queue-inngest` |

## Auth

| Package | Description | Install |
|---|---|---|
| [@forge/auth](./auth/) | Shared authentication types — AuthUser, AuthSession, AuthResult. | `pnpm add @forge/auth` |
| [@forge/auth-better-auth](./auth/better-auth) | better-auth adapter — `betterAuth()` factory, Prisma wiring, `/api/auth/*` mount. | `pnpm add @forge/auth-better-auth` |

## Cache

| Package | Description | Install |
|---|---|---|
| [@forge/cache](./cache/) | Cache facade, built-in MemoryAdapter, and `cache()` factory. | `pnpm add @forge/cache` |
| [@forge/cache-redis](./cache/redis) | Redis cache adapter via ioredis — optional peer for the `redis` driver. | `pnpm add @forge/cache-redis` |

## Storage

| Package | Description | Install |
|---|---|---|
| [@forge/storage](./storage/) | Storage facade, built-in LocalAdapter, `storage()` factory, and `storage:link` artisan command. | `pnpm add @forge/storage` |
| [@forge/storage-s3](./storage/s3) | S3/R2/MinIO adapter via `@aws-sdk/client-s3` — optional peer. | `pnpm add @forge/storage-s3` |

## Mail

| Package | Description | Install |
|---|---|---|
| [@forge/mail](./mail/) | Mailable base class, Mail facade, built-in LogAdapter, and `mail()` factory. | `pnpm add @forge/mail` |
| [@forge/mail-nodemailer](./mail/nodemailer) | Nodemailer SMTP adapter — optional peer for the `smtp` driver. | `pnpm add @forge/mail-nodemailer` |

## Features

| Package | Description | Install |
|---|---|---|
| [@forge/events](./events) | EventDispatcher, Listener interface, `dispatch()` helper, and `events()` factory. | `pnpm add @forge/events` |
| [@forge/schedule](./schedule) | Task scheduler — `schedule` singleton, `scheduler()` factory, and `schedule:run/work/list` commands. | `pnpm add @forge/schedule` |
| [@forge/rate-limit](./rate-limit) | Cache-backed rate limiting — `RateLimit.perMinute/Hour/Day` and `X-RateLimit-*` headers. | `pnpm add @forge/rate-limit` |
| [@forge/notification](./notification) | Multi-channel notifications (mail, database) — Notifiable, Notification, ChannelRegistry, `notify()`. | `pnpm add @forge/notification` |
