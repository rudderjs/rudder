# Package Catalog

All `@rudderjs/*` packages are published to npm individually. Install only what your project needs.

## Core

| Package | Description | Install |
|---|---|---|
| [@rudderjs/contracts](./core/contracts) | Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters. | `pnpm add @rudderjs/contracts` |
| [@rudderjs/support](./core/support) | Shared utility primitives — collections, env access, config lookup, and helper functions. | `pnpm add @rudderjs/support` |
| [@rudderjs/middleware](./core/middleware) | HTTP middleware base class, pipeline runner, CSRF, rate limiting, and built-in implementations. | `pnpm add @rudderjs/middleware` |
| [@rudderjs/rudder](./rudder) | CLI registry, Command base class, and the global `rudder` singleton. | `pnpm add @rudderjs/rudder` |
| [@rudderjs/cli](/cli/) | Code generators (`make:*`, `make:module`) and rudder command dispatcher. Install as a dev dependency. | `pnpm add -D @rudderjs/cli` |
| [@rudderjs/core](./core/) | Application bootstrap, DI container with decorators, Events, FormRequest validation, Zod, service provider lifecycle. | `pnpm add @rudderjs/core` |

## Build

| Package | Description | Install |
|---|---|---|
| [@rudderjs/vite](./vite/) | Vite plugin — registers Vike, sets the `@/` alias, and externalises SSR-incompatible packages. | `pnpm add @rudderjs/vite` |

## Server

| Package | Description | Install |
|---|---|---|
| [@rudderjs/router](./server/router) | Fluent HTTP router and decorator-based controller support — the global `router` singleton. | `pnpm add @rudderjs/router` |
| [@rudderjs/server-hono](./server/hono) | Hono-based HTTP server adapter with unified request logging and CORS support. | `pnpm add @rudderjs/server-hono` |

## ORM

| Package | Description | Install |
|---|---|---|
| [@rudderjs/orm](./orm/) | ORM contract interface, Model base class, QueryBuilder, and ModelRegistry. | `pnpm add @rudderjs/orm` |
| [@rudderjs/orm-prisma](./orm/prisma) | Prisma adapter for @rudderjs/orm — multi-driver (PostgreSQL, SQLite, libSQL). | `pnpm add @rudderjs/orm-prisma` |
| [@rudderjs/orm-drizzle](./orm/drizzle) | Drizzle ORM adapter — multi-driver (sqlite, postgresql, libsql) with DrizzleTableRegistry. | `pnpm add @rudderjs/orm-drizzle` |

## Queue

| Package | Description | Install |
|---|---|---|
| [@rudderjs/queue](./queue/) | Queue contract interface, Job base class, and `queue:work` rudder command. | `pnpm add @rudderjs/queue` |
| [@rudderjs/queue-bullmq](./queue/bullmq) | BullMQ Redis-backed queue adapter with job registry and graceful shutdown. | `pnpm add @rudderjs/queue-bullmq` |
| [@rudderjs/queue-inngest](./queue/inngest) | Inngest adapter for durable, event-driven background jobs. | `pnpm add @rudderjs/queue-inngest` |

## Auth

| Package | Description | Install |
|---|---|---|
| [@rudderjs/auth](./auth/) | Authentication types (AuthUser, AuthSession, AuthResult) + `auth()` factory with Prisma auto-discovery, `AuthMiddleware()`, and `/api/auth/*` mount. | `pnpm add @rudderjs/auth` |

## Cache

| Package | Description | Install |
|---|---|---|
| [@rudderjs/cache](./cache/) | Cache facade, built-in MemoryAdapter, and `cache()` factory. Redis driver built-in (requires `ioredis`). | `pnpm add @rudderjs/cache` |

## Storage

| Package | Description | Install |
|---|---|---|
| [@rudderjs/storage](./storage/) | Storage facade, local + S3/R2/MinIO drivers, `storage()` factory, and `storage:link` rudder command. | `pnpm add @rudderjs/storage` |

## Mail

| Package | Description | Install |
|---|---|---|
| [@rudderjs/mail](./mail/) | Mailable base class, Mail facade, built-in LogAdapter + SMTP (Nodemailer), and `mail()` factory. | `pnpm add @rudderjs/mail` |

## Session

| Package | Description | Install |
|---|---|---|
| [@rudderjs/session](./session) | Cookie and Redis session drivers — `SessionMiddleware()`, `Session` facade, and `session()` factory. | `pnpm add @rudderjs/session` |

## Real-time

| Package | Description | Install |
|---|---|---|
| [@rudderjs/broadcast](./broadcast) | WebSocket broadcasting — `broadcasting()`, `Broadcast.channel()`, public/private/presence channels, BKSocket client. | `pnpm add @rudderjs/broadcast` |
| [@rudderjs/live](./live) | Yjs CRDT real-time document sync — `live()`, `MemoryPersistence`, `liveRedis()`, `livePrisma()`. | `pnpm add @rudderjs/live` |

## Admin

| Package | Description | Install |
|---|---|---|
| [@rudderjs/panels](./panels/index) | Admin panel builder — define resources, fields, filters, and actions in TypeScript; auto-generates CRUD API routes and a React UI with sidebar or topbar layout. | `pnpm add @rudderjs/panels` |

## Features

| Package | Description | Install |
|---|---|---|
| [Events (core)](./events) | EventDispatcher, Listener interface, `dispatch()` helper, and `events()` factory (built into core). | `pnpm add @rudderjs/core` |
| [@rudderjs/localization](./localization) | Laravel-style i18n with JSON files, `__()`, `trans()`, interpolation, pluralization, fallback locale, and per-request locale context. | `pnpm add @rudderjs/localization` |
| [@rudderjs/schedule](./schedule) | Task scheduler — `schedule` singleton, `scheduler()` factory, and `schedule:run/work/list` commands. | `pnpm add @rudderjs/schedule` |
| [Rate Limiting](./rate-limit) | Cache-backed rate limiting via `@rudderjs/middleware` — `RateLimit.perMinute/Hour/Day` and `X-RateLimit-*` headers. | `pnpm add @rudderjs/middleware` |
| [@rudderjs/notification](./notification) | Multi-channel notifications (mail, database) — Notifiable, Notification, ChannelRegistry, `notify()`. | `pnpm add @rudderjs/notification` |
