<p align="center">
  <strong>Laravel's developer experience, reimagined for the Node.js ecosystem.</strong>
</p>

<p align="center">
  <img src="./logo.png" alt="RudderJS — Boost Your Node App" width="480" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rudderjs/core"><img src="https://img.shields.io/npm/v/@rudderjs/core?label=core&color=f5a623" alt="npm" /></a>
  <a href="https://github.com/rudderjs/rudder/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-powered-646cff" alt="Vite" />
</p>

---

RudderJS is a modular, TypeScript-first Node.js meta-framework built on [Vike](https://vike.dev) + [Vite](https://vitejs.dev). It brings the patterns that make Laravel productive — service providers, dependency injection, an Eloquent-style ORM, an Rudder CLI, queues, scheduling, and more — without the PHP runtime.

## Why RudderJS?

Modern web development forces a choice between **developer experience** and **architectural freedom**.

- **Next.js** gives you great DX but locks you into React and a black-box architecture
- **Express/Hono** gives you freedom but you spend weeks wiring up auth, ORMs, queues, and DI from scratch
- **NestJS** is structured but heavy, Angular-style, and API-only

RudderJS is the middle ground: a **batteries-included architecture that stays entirely modular and UI-agnostic**.

| | Next.js | NestJS | RudderJS |
|---|---|---|---|
| **Philosophy** | Component-first | Angular-style DI | Laravel-style DX |
| **Build tool** | Webpack / Turbopack | Webpack / esbuild | **Vite** |
| **UI framework** | React only | API only | React, Vue, Solid, or none |
| **DI container** | None | Class-based IoC | Service Providers |
| **Backend pattern** | File-based API routes | Controllers + Modules | Routes + Service Providers |
| **Modularity** | All-in | All-in | Pay-as-you-go |

---

## Key Features

- **Laravel-inspired DX** — service providers, fluent bootstrap, Rudder CLI, FormRequest validation
- **Pay-as-you-go** — 47 optional `@rudderjs/*` packages; use only what you need
- **AI-native** — 9-provider AI engine (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), agents with tools, streaming, middleware, attachments, conversations, queue integration
- **Native auth** — session guards, API tokens (Sanctum), OAuth (Socialite), gates & policies, password hashing & encryption
- **Pluggable adapters** — swap Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3, SMTP ↔ any mailer
- **UI-agnostic** — pair with React, Vue, Solid, or run as a pure API server
- **TypeScript-first** — strict types, generics, and decorator support throughout
- **WinterCG compatible** — runs on Node.js, Cloudflare Workers, Deno, and Bun

---

## Quick Start

Use whichever package manager you prefer — the installer auto-detects it and adapts all generated files and next-step instructions accordingly:

```bash
pnpm create rudderjs-app my-app
# or
npm create rudderjs-app@latest my-app
# or
yarn create rudderjs-app my-app
# or
bunx create-rudderjs-app my-app
```

The interactive installer asks you to choose your database, frontend framework (React / Vue / Solid), Tailwind, shadcn/ui, and authentication pages — then scaffolds a production-ready project.

After scaffolding (pnpm example — the CLI prints the exact commands for your PM):

```bash
cd my-app
pnpm exec prisma generate
pnpm exec prisma db push
pnpm dev
```

---

## How It Works

### 1. Bootstrap — one file wires everything

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'
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
import { Route } from '@rudderjs/router'

Route.get('/api/users', async (_req, res) => {
  const users = await User.all()
  return res.json({ data: users })
})

Route.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)
  return res.status(201).json({ data: user })
})
```

### 3. Rudder CLI + Scheduling

```ts
// routes/console.ts
import { Cache } from '@rudderjs/cache'
import { Rudder }  from '@rudderjs/rudder'
import { Schedule } from '@rudderjs/schedule'

Rudder.command('db:seed', async () => {
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
import { Model } from '@rudderjs/orm'

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
import { Controller, Get, Post, Middleware } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

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
import { Route } from '@rudderjs/router'
import { UserController } from '../app/Controllers/UserController.js'

Route.registerController(UserController)
```

Or use fluent routing for simpler cases — both styles work side by side.

### 6. Service Providers & Dependency Injection

```ts
// app/Providers/AppServiceProvider.ts
import { ServiceProvider } from '@rudderjs/core'
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
import { resolve } from '@rudderjs/core'
import { UserService } from '../app/Services/UserService.js'

const users = await resolve(UserService).findAll()
```

Swap the entire implementation by changing one line in `register()` — your routes and controllers never change.

Providers can also register other providers at runtime — enabling self-contained modules:

```ts
export class AppServiceProvider extends ServiceProvider {
  async boot() {
    await this.app.register(panels([adminPanel], [panelsLexical(), media()]))
    await this.app.register(TodoServiceProvider)
  }
}
```

### 7. Mail

```ts
// app/Mail/WelcomeEmail.ts
import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) { super() }

  build(): this {
    return this
      .subject(`Welcome to RudderJS, ${this.userName}!`)
      .html(`<h1>Welcome, ${this.userName}!</h1><p>Your account is ready.</p>`)
      .text(`Welcome, ${this.userName}! Your account is ready.`)
  }
}
```

```ts
import { Mail } from '@rudderjs/mail'

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
import { events } from '@rudderjs/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'

export default [
  events({ [UserRegistered.name]: [new SendWelcomeEmailListener()] }),
  // ...other providers
]
```

```ts
// Dispatch from anywhere
import { dispatch } from '@rudderjs/core'

await dispatch(new UserRegistered(user.id, user.name, user.email))
```

### 9. Broadcasting — real-time channels

```ts
// bootstrap/providers.ts
import { broadcasting } from '@rudderjs/broadcast'
export default [ broadcasting(), /* ...other providers */ ]
```

```ts
// routes/channels.ts
import { Broadcast } from '@rudderjs/broadcast'

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
import { broadcast } from '@rudderjs/broadcast'

broadcast('chat', 'message', { user: 'Alice', text: 'Hello!' })
broadcast('private-orders.42', 'status.updated', { status: 'shipped' })
```

```ts
// Client (BKSocket — publish with: pnpm rudder vendor:publish --tag=broadcast-client)
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
import { broadcasting } from '@rudderjs/broadcast'
import { live }         from '@rudderjs/live'
export default [ broadcasting(), live() ]
```

```ts
// Client — standard yjs + y-websocket (server-side is handled by @rudderjs/live)
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

### 11. Admin Panels — Filament-style resource CRUD

```ts
// app/Panels/Admin/AdminPanel.ts
import { Panel, Dashboard, Widget } from '@rudderjs/panels'

export const adminPanel = Panel.make('admin')
  .path('/admin')
  .branding({ title: 'My App' })
  .resources([ArticleResource, UserResource])
  .globals([SiteSettingsGlobal])
  .schema(async () => [
    Dashboard.make('overview')
      .widgets([
        Widget.make('total-users').component('stat').data(async () => ({
          value: await User.query().count(),
        })),
      ]),
  ])
```

```ts
// app/Panels/Admin/resources/ArticleResource.ts
import { Resource, TextField, RichContentField, SelectField, FileField } from '@rudderjs/panels'

export class ArticleResource extends Resource {
  static model = Article
  static label = 'Articles'
  static icon  = 'file-text'

  fields() {
    return [
      TextField.make('title').required().searchable().sortable(),
      RichContentField.make('content').collaborative(),
      SelectField.make('status').options(['draft', 'published']),
      FileField.make('image').image().optimize().conversions([
        { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
      ]),
    ]
  }
}
```

Register panels with extensions — each extension gets dynamically registered via `app.register()`:

```ts
// bootstrap/providers.ts (or inside AppServiceProvider)
import { panels } from '@rudderjs/panels'
import { panelsLexical } from '@rudderjs/panels-lexical/server'
import { media } from '@rudderjs/media/server'

panels([adminPanel], [
  panelsLexical(),
  media({ conversions: [{ name: 'thumb', width: 200, height: 200, format: 'webp' }] }),
])
```

### 12. Media Library

Full-featured file browser built as a panels extension:

- **Grid + list views** with file type icons and image thumbnails
- **Upload** — multi-file, drag-and-drop files/directories, drag images from other browser tabs
- **Folders** — DB-only hierarchy, breadcrumb navigation via Vike `navigate()`
- **Preview** — images, video, audio, PDF, text, JSON, CSV rendered natively in the browser
- **Scoped access** — shared files (all users) or private files (per user)
- **Image conversions** — auto-generates thumbnails via `@rudderjs/image` on upload

### 13. Image Processing

Fluent image processing API, independent of the media library:

```ts
import { image } from '@rudderjs/image'

// Resize, convert, optimize
const buffer = await image(uploadedFile)
  .resize(800, 600)
  .format('webp')
  .quality(85)
  .stripMetadata()
  .toBuffer()

// Batch conversions to storage
await image(file)
  .conversions([
    { name: 'thumb', width: 200, height: 200, crop: true, format: 'webp' },
    { name: 'og',    width: 1200, height: 630, crop: true, format: 'webp' },
  ])
  .generateToStorage('public', 'posts/42/')
```

### 14. Debug helpers (the ones every Laravel dev misses)

```ts
import { config, dump, dd, app, resolve } from '@rudderjs/core'

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
| `@rudderjs/core` | Application bootstrap, DI container, Events, ServiceProvider lifecycle |
| `@rudderjs/router` | Fluent + decorator-based HTTP routing |
| `@rudderjs/middleware` | Pipeline, CORS, logger, CSRF, rate limiting |
| `@rudderjs/rudder` | Rudder CLI registry, Command base class |
| `@rudderjs/cli` | `make:*` generators — controller, model, job, middleware, module |
| `@rudderjs/support` | Env, Collection, ConfigRepository, helpers |
| `@rudderjs/contracts` | Shared TypeScript types (no runtime) |

### HTTP & Frontend
| Package | Description |
|---|---|
| `@rudderjs/server-hono` | Hono HTTP adapter |
| `@rudderjs/session` | Cookie + Redis session drivers, `SessionMiddleware()`, `Session` facade |
| `@rudderjs/vite` | Vite + Vike plugin with SSR externals and RudderJS integration |

### Database
| Package | Description |
|---|---|
| `@rudderjs/orm` | Model base class, ModelRegistry, QueryBuilder |
| `@rudderjs/orm-prisma` | Prisma adapter (SQLite, PostgreSQL, MySQL) |
| `@rudderjs/orm-drizzle` | Drizzle adapter (SQLite, PostgreSQL, libSQL) |

### Auth
| Package | Description |
|---|---|
| `@rudderjs/hash` | Password hashing (bcrypt, argon2) |
| `@rudderjs/crypt` | Symmetric encryption (AES-256-CBC) |
| `@rudderjs/auth` | Authentication (guards, providers), Authorization (gates, policies), Password resets |
| `@rudderjs/sanctum` | API token authentication with abilities |
| `@rudderjs/socialite` | OAuth providers (GitHub, Google, Facebook, Apple) |

### Infrastructure
| Package | Description |
|---|---|
| `@rudderjs/queue` | Job base class, queue contract |
| `@rudderjs/queue-bullmq` | BullMQ Redis-backed queue |
| `@rudderjs/queue-inngest` | Inngest serverless queue |
| `@rudderjs/cache` | Cache facade, memory + Redis drivers (`ioredis` optional) |
| `@rudderjs/storage` | Storage facade, local + S3/R2/MinIO (`@aws-sdk/client-s3` optional) |
| `@rudderjs/mail` | Mailable, Mail facade, log + SMTP drivers (`nodemailer` optional) |
| `@rudderjs/notification` | Multi-channel notifications (mail, database) |
| `@rudderjs/schedule` | Task scheduler, cron-based |
| `@rudderjs/broadcast` | WebSocket channels — pub/sub, private, presence |
| `@rudderjs/live` | Yjs CRDT real-time document sync |

### Developer Experience
| Package | Description |
|---|---|
| `@rudderjs/log` | Structured logging — channels (console, file, daily, stack), RFC 5424 levels, formatters, context |
| `@rudderjs/http` | Fluent HTTP client — retries, timeouts, pools, interceptors, `Http.fake()` |
| `@rudderjs/context` | Request-scoped context — ALS-backed data bag, auto-propagates to logs and queued jobs |
| `@rudderjs/pennant` | Feature flags — define, scope to users/teams, Lottery gradual rollout, `Feature.fake()` |
| `@rudderjs/process` | Shell execution — run, pool, pipe, timeouts, real-time output, `Process.fake()` |
| `@rudderjs/concurrency` | Parallel execution via worker threads, deferred fire-and-forget, sync driver for testing |
| `@rudderjs/testing` | TestCase, TestResponse assertions, RefreshDatabase, WithFaker, HTTP request helpers |

### Admin & Media
| Package | Description |
|---|---|
| `@rudderjs/panels` | Admin panel builder — resources, fields, dashboards, widgets, versioning, collaboration |
| `@rudderjs/panels-lexical` | Lexical rich-text editor for panels (optional extension) |
| `@rudderjs/media` | Media library — file browser, uploads, folders, preview, image conversions |
| `@rudderjs/image` | Fluent image processing — resize, crop, convert, optimize (sharp wrapper) |

### Monitoring
| Package | Description |
|---|---|
| `@rudderjs/telescope` | Development inspector — records requests, queries, jobs, exceptions, logs, mail, notifications, events, cache, schedule, model changes |
| `@rudderjs/pulse` | Application metrics — request throughput/duration, queue metrics, cache hit rates, active users, server stats |
| `@rudderjs/horizon` | Queue monitor — full job lifecycle, per-queue metrics, worker status, failed job retry/delete |

### AI & Workspaces
| Package | Description |
|---|---|
| `@rudderjs/ai` | AI engine — 9 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), Agent class, tool system, streaming, middleware |
| `@rudderjs/boost` | AI dev tools — MCP server for Claude Code, Cursor, Copilot |
| `@rudderjs/mcp` | MCP server framework — build custom MCP servers with decorators and testing utilities |
| `@rudderjs/workspaces` | AI workspace canvas — Isoflow-style 3D nodes, departments, connections, chat, orchestrator |
| `@rudderjs/localization` | i18n — `trans()`, `setLocale()`, locale-aware middleware, JSON translation files |

---

## Default Stack

| Layer | Default | Swap with |
|-------|---------|-----------|
| HTTP server | Hono | Express, Fastify, H3 |
| ORM | Prisma | Drizzle |
| Auth | Native (session-based) | Sanctum (API tokens), Socialite (OAuth) |
| Queue | BullMQ | Inngest |
| Cache | In-memory | Redis |
| Storage | Local filesystem | S3, R2, MinIO |
| Mail | Log (dev) | SMTP via Nodemailer |

---

## Status

RudderJS is in **early development**. All packages are functional and the playground is a working full-stack application. Breaking changes may occur before v1.0.

- 47 packages published to npm under `@rudderjs/*`
- Playground demonstrates routing, ORM, auth, queues, cache, storage, mail, notifications, scheduling, WebSocket broadcasting, real-time Yjs CRDT collaboration, admin panels with resource CRUD, media library, AI engine with multi-provider support, AI workspace canvas, monitoring (Telescope, Pulse, Horizon), request-scoped context, feature flags, and shell/concurrency utilities — all end-to-end

---

## License

MIT © [Suleiman Shahbari](https://github.com/rudderjs/rudder)
