<p align="center">
  <strong>Laravel's developer experience, reimagined for the Node.js ecosystem.</strong>
</p>

<p align="center">
  <img src="./logo.png" alt="RudderJS — Boost Your Node App" width="480" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rudderjs/core"><img src="https://img.shields.io/npm/v/@rudderjs/core?label=core&color=f5a623" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/create-rudder-app"><img src="https://img.shields.io/npm/v/create-rudder-app?label=create-rudder-app&color=f5a623" alt="create-rudder-app" /></a>
  <a href="https://github.com/rudderjs/rudder/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/rudderjs/rudder/ci.yml?branch=main&label=CI" alt="CI" /></a>
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
- **Pay-as-you-go** — modular `@rudderjs/*` packages; use only what you need
- **AI-native** — 9-provider AI engine (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), agents with tools, streaming, middleware, attachments, conversations, queue integration
- **Native auth** — session guards, API tokens (Sanctum), OAuth (Socialite), gates & policies, password hashing & encryption
- **Pluggable adapters** — swap Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3, SMTP ↔ any mailer
- **UI-agnostic** — pair with React, Vue, Solid, or run as a pure API server
- **Laravel-style views** — return `view('dashboard', { users })` from controllers and render typed React/Vue/Solid components (or vanilla HTML strings for the Blade equivalent) with full Vike SSR + SPA navigation, no Inertia adapter
- **TypeScript-first** — strict TypeScript with incremental builds (~10s for single-package changes)
- **Test-friendly** — TestCase, fluent assertions, fakes for HTTP, queue, cache, events, notifications
- **CI/CD ready** — automated testing, linting, and npm publishing via Changesets
- **WinterCG compatible** — runs on Node.js, Cloudflare Workers, Deno, and Bun

---

## Quick Start

Use whichever package manager you prefer — the installer auto-detects it and adapts all generated files and next-step instructions accordingly:

```bash
pnpm create rudder-app my-app
# or
npm create rudder-app@latest my-app
# or
yarn create rudder-app my-app
# or
bunx create-rudder-app my-app
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

Routes can return JSON (API endpoints) or a `view()` (Laravel-style SSR pages rendered through Vike). Both coexist in the same file, run the same middleware chain, and support full SPA navigation between them.

```ts
// routes/api.ts
import { Route } from '@rudderjs/router'
import { view }  from '@rudderjs/view'

// JSON API — return an object or use res.json()
Route.get('/api/users', async (_req, res) => {
  const users = await User.all()
  return res.json({ data: users })
})

Route.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)
  return res.status(201).json({ data: user })
})

// Laravel-style view — render a typed React/Vue/Solid component
// from app/Views/Dashboard.tsx with controller-supplied props
Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { title: 'Dashboard', users })
})

// Welcome page served at / — controller URL diverges from the id-derived
// /welcome default, so the view file declares its canonical URL
Route.get('/', async () => view('welcome', { appName: config('app.name') }))
```

The view file is a normal component that takes typed props:

```tsx
// app/Views/Dashboard.tsx
interface DashboardProps {
  title: string
  users: { id: number; name: string; email: string }[]
}

export default function Dashboard({ title, users }: DashboardProps) {
  return (
    <div>
      <h1>{title}</h1>
      <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
    </div>
  )
}
```

View ids map 1:1 to URLs by convention (`'dashboard'` → `/dashboard`). When a controller serves a view at a URL that doesn't match the id — `view('welcome')` at `/`, `view('auth.login')` at `/login` — declare the canonical URL at the top of the view file:

```tsx
// app/Views/Welcome.tsx
export const route = '/'
export default function Welcome(props: WelcomeProps) { ... }
```

The scanner reads the constant and writes it into the generated Vike `+route.ts`, so Vike's client route table matches the browser URL and SPA navigation stays instant.

Middleware (auth, rate limiting, CSRF, form validation) runs **before** the view renders — same router chain as JSON routes. Client-side navigation between views and between views and regular Vike pages is full SPA — no full page reloads, no Inertia adapter, no JSON envelope. Just Vike's native `pageContext.json` fetches (~400 bytes per nav).

**Framework support**: React (`vike-react`), Vue (`vike-vue`), Solid (`vike-solid`), and vanilla HTML-string mode for the Blade equivalent — zero client JS, perfect for admin reports, email bodies, webhook responses. The scanner auto-detects which renderer is installed. Vanilla views use `@rudderjs/view`'s `html\`\`` tagged template, which auto-escapes interpolations and composes via `SafeString`.

**Packages that ship views** follow a consistent shape: `views/<framework>/<Name>.{tsx,vue}` + a `registerXRoutes(router, opts)` helper. `@rudderjs/auth` is the reference implementation — `registerAuthRoutes(Route, { middleware })` wires `/login`, `/register`, `/forgot-password`, `/reset-password` in one line, with the views vendored into `app/Views/Auth/` for the consumer to customize.

See [`@rudderjs/view`](./packages/view) for the full reference.

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

### 11. Debug helpers (the ones every Laravel dev misses)

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
| `@rudderjs/view` | Laravel-style `view('id', props)` controller responses via Vike SSR |
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

### Media & Image
| Package | Description |
|---|---|
| `@rudderjs/image` | Fluent image processing — resize, crop, convert, optimize (sharp wrapper) |

### Monitoring
| Package | Description |
|---|---|
| `@rudderjs/telescope` | Development inspector — records requests, queries, jobs, exceptions, logs, mail, notifications, events, cache, schedule, model changes |
| `@rudderjs/pulse` | Application metrics — request throughput/duration, queue metrics, cache hit rates, active users, server stats |
| `@rudderjs/horizon` | Queue monitor — full job lifecycle, per-queue metrics, worker status, failed job retry/delete |

### AI
| Package | Description |
|---|---|
| `@rudderjs/ai` | AI engine — 9 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), Agent class, tool system, streaming, middleware |
| `@rudderjs/boost` | AI dev tools — MCP server for Claude Code, Cursor, Copilot |
| `@rudderjs/mcp` | MCP server framework — build custom MCP servers with decorators and testing utilities |
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

- Framework packages published to npm under `@rudderjs/*`
- Scaffolder published as [`create-rudder-app`](https://www.npmjs.com/package/create-rudder-app)
- CI runs build, typecheck, lint, and tests on every PR
- Automated releases via Changesets — merge a version PR, packages publish automatically
- Playground (port 3000) demonstrates routing, ORM, auth, queues, cache, storage, mail, notifications, scheduling, WebSocket broadcasting, real-time Yjs CRDT, AI agents, monitoring (Telescope, Pulse, Horizon) — all end-to-end

## Contributing

```bash
git clone https://github.com/rudderjs/rudder.git
cd rudder
pnpm install
pnpm build
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dependency conventions and the package merge policy.

### Open-Core Ecosystem

RudderJS is the framework layer. Two sibling projects build on it:

| Project | Packages | Description |
|---|---|---|
| **[Pilotiq](https://github.com/pilotiq/pilotiq)** | `@pilotiq/{panels,lexical,media}` | Open-source admin panel builder (MIT) |
| **Pilotiq Pro** | `@pilotiq-pro/{ai,collab,workspaces}` | Commercial extensions — AI agents, real-time collab |

---

## License

MIT © [Suleiman Shahbari](https://github.com/rudderjs/rudder)
