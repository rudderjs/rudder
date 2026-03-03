# BoostKit

**Laravel's developer experience, reimagined for the Node.js ecosystem.**

BoostKit is a modular, TypeScript-first Node.js meta-framework built on [Vike](https://vike.dev) + [Vite](https://vitejs.dev). It brings the patterns that make Laravel productive — service providers, dependency injection, an Eloquent-style ORM, an Artisan CLI, queues, scheduling, and more — without the PHP runtime.

---

## Features

- **Laravel-inspired DX** — service providers, fluent bootstrap, Artisan CLI, FormRequest validation
- **Modular by design** — every feature is an optional `@boostkit/*` package; use only what you need
- **Pluggable adapters** — swap Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3, SMTP ↔ any mailer
- **Framework-agnostic UI** — pair with React, Vue, Solid, or run as a pure API server
- **TypeScript-first** — strict types, generics, and decorator support throughout
- **WinterCG compatible** — deploys to Node.js, Cloudflare Workers, Deno, and Bun

---

## Quick Start

```bash
pnpm create boostkit-app my-app
cd my-app
pnpm install
pnpm dev
```

---

## Packages

| Package | Description |
|---|---|
| `@boostkit/core` | Application bootstrap, ServiceProvider lifecycle |
| `@boostkit/di` | DI container, `@Injectable`, `@Inject` decorators |
| `@boostkit/router` | Fluent + decorator-based HTTP routing |
| `@boostkit/middleware` | Middleware pipeline, CORS, logger, rate limiting |
| `@boostkit/validation` | FormRequest, `validate()`, Zod re-export |
| `@boostkit/server-hono` | Hono HTTP adapter |
| `@boostkit/orm` | Model base class, QueryBuilder |
| `@boostkit/orm-prisma` | Prisma adapter (SQLite, PostgreSQL, MySQL) |
| `@boostkit/orm-drizzle` | Drizzle adapter (SQLite, PostgreSQL, libSQL) |
| `@boostkit/auth` | better-auth service provider factory |
| `@boostkit/queue` | Job base class, queue contract |
| `@boostkit/queue-bullmq` | BullMQ Redis-backed queue |
| `@boostkit/queue-inngest` | Inngest serverless queue |
| `@boostkit/cache` | Cache facade, in-memory adapter |
| `@boostkit/cache-redis` | Redis cache adapter |
| `@boostkit/storage` | Storage facade, local filesystem adapter |
| `@boostkit/storage-s3` | S3/R2/MinIO adapter |
| `@boostkit/mail` | Mailable, Mail facade, log adapter |
| `@boostkit/mail-nodemailer` | Nodemailer SMTP adapter |
| `@boostkit/events` | EventDispatcher, Listener interface |
| `@boostkit/schedule` | Task scheduler, cron-based |
| `@boostkit/notification` | Multi-channel notifications (mail, database) |
| `@boostkit/artisan` | Artisan CLI registry, Command base class |
| `@boostkit/support` | Env, Collection, ConfigRepository, helpers |
| `@boostkit/contracts` | Shared TypeScript types (no runtime) |

---

## Example

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import { RateLimit } from '@boostkit/middleware'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60).toHandler())
  })
  .create()
```

```ts
// routes/api.ts
import { router } from '@boostkit/router'

router.get('/api/users', async (_req, res) => {
  const users = await User.all()
  return res.json({ data: users })
})

router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)
  return res.status(201).json({ data: user })
})
```

```ts
// app/Models/User.ts
import { Model } from '@boostkit/orm'

export class User extends Model {
  static table = 'user'
  id!: string
  name!: string
  email!: string
}
```

---

## Tech Stack

| Layer | Default | Alternatives |
|-------|---------|--------------|
| HTTP server | Hono | Express, Fastify, H3 |
| ORM | Prisma | Drizzle |
| Auth | better-auth | — |
| Queue | BullMQ | Inngest |
| Cache | In-memory | Redis |
| Storage | Local filesystem | S3, R2, MinIO |
| Mail | Log (dev) | SMTP via Nodemailer |

---

## Status

BoostKit is in **early development**. All packages are functional and the playground is a working full-stack application. Breaking changes may occur before v1.0.

- 28 packages published to npm under `@boostkit/*`
- Playground demonstrates routing, ORM, auth, queues, cache, storage, mail, notifications, and scheduling end-to-end

---

## License

MIT © [BoostKit](https://github.com/boostkitjs/boostkit)
