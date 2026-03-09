<p align="center">
  <img src="./logo.png" alt="BoostKit — Boost Your Node App" width="480" />
</p>

<p align="center">
  <strong>Laravel's developer experience, reimagined for the Node.js ecosystem.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@boostkit/core"><img src="https://img.shields.io/npm/v/@boostkit/core?label=core&color=f5a623" alt="npm" /></a>
  <a href="https://github.com/boostkitjs/boostkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-powered-646cff" alt="Vite" />
</p>

---

BoostKit is a modular, TypeScript-first Node.js meta-framework built on [Vike](https://vike.dev) + [Vite](https://vitejs.dev). It brings the patterns that make Laravel productive — service providers, dependency injection, an Eloquent-style ORM, an Artisan CLI, queues, scheduling, and more — without the PHP runtime.

## Why BoostKit?

Modern web development forces a choice between **developer experience** and **architectural freedom**.

- **Next.js** gives you great DX but locks you into React and a black-box architecture
- **Express/Hono** gives you freedom but you spend weeks wiring up auth, ORMs, queues, and DI from scratch
- **NestJS** is structured but heavy, Angular-style, and API-only

BoostKit is the middle ground: a **batteries-included architecture that stays entirely modular and UI-agnostic**.

| | Next.js | NestJS | BoostKit |
|---|---|---|---|
| **Philosophy** | Component-first | Angular-style DI | Laravel-style DX |
| **Build tool** | Webpack / Turbopack | Webpack / esbuild | **Vite** |
| **UI framework** | React only | API only | React, Vue, Solid, or none |
| **DI container** | None | Class-based IoC | Service Providers |
| **Backend pattern** | File-based API routes | Controllers + Modules | Routes + Service Providers |
| **Modularity** | All-in | All-in | Pay-as-you-go |

---

## Key Features

- **Laravel-inspired DX** — service providers, fluent bootstrap, Artisan CLI, FormRequest validation
- **Pay-as-you-go** — 29 optional `@boostkit/*` packages; use only what you need
- **Pluggable adapters** — swap Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3, SMTP ↔ any mailer
- **UI-agnostic** — pair with React, Vue, Solid, or run as a pure API server
- **TypeScript-first** — strict types, generics, and decorator support throughout
- **WinterCG compatible** — runs on Node.js, Cloudflare Workers, Deno, and Bun

---

## Quick Start

```bash
pnpm create boostkit-app my-app
cd my-app
pnpm install
pnpm exec prisma generate
pnpm exec prisma db push
pnpm dev
```

The interactive installer asks you to choose your database, frontend framework (React / Vue / Solid), Tailwind, shadcn/ui, and authentication pages — then scaffolds a production-ready project.

---

## How It Works

### 1. Bootstrap — one file wires everything

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
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60))
  })
  .create()
```

### 2. Routes

```ts
// routes/api.ts
import { Route } from '@boostkit/router'

Route.get('/api/users', async (_req, res) => {
  const users = await User.all()
  return res.json({ data: users })
})

Route.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)
  return res.status(201).json({ data: user })
})
```

### 3. Artisan CLI + Scheduling

```ts
// routes/console.ts
import { Cache } from '@boostkit/cache'
import { Artisan }  from '@boostkit/artisan'
import { Schedule } from '@boostkit/schedule'

Artisan.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com' })
  console.log('Seeded.')
}).description('Seed the database')

Schedule.call(async () => {
  await Cache.forget('users:all')
}).everyFiveMinutes().description('Flush users cache')
```

### 4. Models

```ts
// app/Models/User.ts
import { Model } from '@boostkit/orm'

export class User extends Model {
  static table = 'user'
  id!:    string
  name!:  string
  email!: string
}
```

### 5. Controllers (decorator routing)

```ts
// app/Controllers/UserController.ts
import { Controller, Get, Post, Middleware } from '@boostkit/router'
import { RateLimit } from '@boostkit/middleware'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

@Controller('/api/users')
export class UserController {
  @Get('/')
  index(_req: AppRequest, res: AppResponse) {
    return res.json({ users: [] })
  }

  @Post('/')
  @Middleware([RateLimit.perMinute(10)])
  store(req: AppRequest, res: AppResponse) {
    return res.json({ created: req.body })
  }
}
```

Register the controller once in your routes file:

```ts
// routes/api.ts
import { Route } from '@boostkit/router'
import { UserController } from '../app/Controllers/UserController.js'

Route.registerController(UserController)
```

Or use fluent routing for simpler cases — both styles work side by side.

### 6. Service Providers & Dependency Injection

```ts
// app/Providers/AppServiceProvider.ts
import { ServiceProvider } from '@boostkit/core'
import { UserService } from '../Services/UserService.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Bind once — resolve anywhere via resolve(UserService)
    this.app.singleton(UserService, () => new UserService())
  }
}
```

```ts
// Anywhere in your routes or services
import { resolve } from '@boostkit/core'
import { UserService } from '../app/Services/UserService.js'

const users = await resolve(UserService).findAll()
```

Swap the entire implementation by changing one line in `register()` — your routes and controllers never change.

### 7. Mail

```ts
// app/Mail/WelcomeEmail.ts
import { Mailable } from '@boostkit/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) { super() }

  build(): this {
    return this
      .subject(`Welcome to BoostKit, ${this.userName}!`)
      .html(`<h1>Welcome, ${this.userName}!</h1><p>Your account is ready.</p>`)
      .text(`Welcome, ${this.userName}! Your account is ready.`)
  }
}
```

```ts
import { Mail } from '@boostkit/mail'

await Mail.to(user.email).send(new WelcomeEmail(user.name))
```

### 8. Events

```ts
// app/Events/UserRegistered.ts
export class UserRegistered {
  constructor(
    public readonly id:    string,
    public readonly name:  string,
    public readonly email: string,
  ) {}
}
```

```ts
// bootstrap/providers.ts — register listeners
import { events } from '@boostkit/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'

export default [
  events({ [UserRegistered.name]: [new SendWelcomeEmailListener()] }),
  // ...other providers
]
```

```ts
// Dispatch from anywhere
import { dispatch } from '@boostkit/core'

await dispatch(new UserRegistered(user.id, user.name, user.email))
```

### 9. Broadcasting — real-time channels

```ts
// bootstrap/providers.ts
import { broadcasting } from '@boostkit/broadcast'
export default [ broadcasting(), /* ...other providers */ ]
```

```ts
// routes/channels.ts
import { Broadcast } from '@boostkit/broadcast'

// Private — return true/false
Broadcast.channel('private-orders.*', async (req) => {
  return verifyToken(req.token)
})

// Presence — return member info to track who is online
Broadcast.channel('presence-room.*', async (req) => {
  const user = await getUser(req.token)
  return user ? { id: user.id, name: user.name } : false
})
```

```ts
// Broadcast from any route or job
import { broadcast } from '@boostkit/broadcast'

broadcast('chat', 'message', { user: 'Alice', text: 'Hello!' })
broadcast('private-orders.42', 'status.updated', { status: 'shipped' })
```

```ts
// Client (BKSocket — publish with: pnpm artisan vendor:publish --tag=broadcast-client)
import { BKSocket } from './vendor/BKSocket'

const socket = new BKSocket('ws://localhost:3000/ws')

const chat = socket.channel('chat')
chat.on('message', ({ user, text }) => console.log(`${user}: ${text}`))

const room = socket.presence('room.lobby', token)
room.on('presence.joined', ({ user }) => console.log(`${user.name} joined`))
room.on('presence.members', (members) => setOnlineUsers(members))
```

### 10. Live collaboration — Yjs CRDT

```ts
// bootstrap/providers.ts
import { broadcasting } from '@boostkit/broadcast'
import { live }         from '@boostkit/live'
export default [ broadcasting(), live() ]
```

```ts
// Client — standard yjs + y-websocket (server-side is handled by @boostkit/live)
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider(`ws://${location.host}/ws-live`, 'my-doc', doc)
const text     = doc.getText('content')

text.observe(() => setContent(text.toString()))

// Awareness — who is online
provider.awareness.setLocalStateField('user', { name: 'Alice', color: '#f97316' })
provider.awareness.on('change', () => {
  const online = [...provider.awareness.getStates().values()].flatMap(s => s.user ? [s.user] : [])
  setOnlineUsers(online)
})
```

HTTP, WebSocket channels, and CRDT sync all share the same port — no separate process or proxy needed.

### 11. Debug helpers (the ones every Laravel dev misses)

```ts
import { config, dump, dd, app, resolve } from '@boostkit/core'

config('app.name')       // → 'my-app'
config('cache.ttl', 60)  // → 60 (with fallback)

dump({ user, session })  // pretty-prints, server keeps running
dd(req.body)             // pretty-prints then stops (like Laravel's dd())

const svc = resolve<UserService>(UserService)
```

---

## Packages

### Foundation
| Package | Description |
|---|---|
| `@boostkit/core` | Application bootstrap, DI container, Events, ServiceProvider lifecycle |
| `@boostkit/router` | Fluent + decorator-based HTTP routing |
| `@boostkit/middleware` | Pipeline, CORS, logger, CSRF, rate limiting |
| `@boostkit/artisan` | Artisan CLI registry, Command base class |
| `@boostkit/cli` | `make:*` generators — controller, model, job, middleware, module |
| `@boostkit/support` | Env, Collection, ConfigRepository, helpers |
| `@boostkit/contracts` | Shared TypeScript types (no runtime) |

### HTTP & Frontend
| Package | Description |
|---|---|
| `@boostkit/server-hono` | Hono HTTP adapter |
| `@boostkit/session` | Cookie + Redis session drivers, `SessionMiddleware()`, `Session` facade |
| `@boostkit/vite` | Vite + Vike plugin with SSR externals and BoostKit integration |

### Database
| Package | Description |
|---|---|
| `@boostkit/orm` | Model base class, ModelRegistry, QueryBuilder |
| `@boostkit/orm-prisma` | Prisma adapter (SQLite, PostgreSQL, MySQL) |
| `@boostkit/orm-drizzle` | Drizzle adapter (SQLite, PostgreSQL, libSQL) |

### Auth
| Package | Description |
|---|---|
| `@boostkit/auth` | better-auth service provider + `AuthMiddleware()` |

### Infrastructure
| Package | Description |
|---|---|
| `@boostkit/queue` | Job base class, queue contract |
| `@boostkit/queue-bullmq` | BullMQ Redis-backed queue |
| `@boostkit/queue-inngest` | Inngest serverless queue |
| `@boostkit/cache` | Cache facade, memory + Redis drivers (`ioredis` optional) |
| `@boostkit/storage` | Storage facade, local + S3/R2/MinIO (`@aws-sdk/client-s3` optional) |
| `@boostkit/mail` | Mailable, Mail facade, log + SMTP drivers (`nodemailer` optional) |
| `@boostkit/notification` | Multi-channel notifications (mail, database) |
| `@boostkit/schedule` | Task scheduler, cron-based |
| `@boostkit/broadcast` | WebSocket channels — pub/sub, private, presence |
| `@boostkit/live` | Yjs CRDT real-time document sync |

---

## Default Stack

| Layer | Default | Swap with |
|-------|---------|-----------|
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

- 29 packages published to npm under `@boostkit/*`
- Playground demonstrates routing, ORM, auth, queues, cache, storage, mail, notifications, scheduling, WebSocket broadcasting, and real-time Yjs CRDT collaboration end-to-end

---

## License

MIT © [Suleiman Shahbari](https://github.com/boostkitjs/boostkit)
