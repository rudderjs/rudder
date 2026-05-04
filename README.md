<p align="center">
  <strong>The fullstack Node.js framework with structure, speed, and AI built in.</strong>
</p>

<p align="center">
  <img src="./logo.png" alt="RudderJS — Boost Your Node App" width="240" />
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

RudderJS is a **batteries-included, modular TypeScript framework for Node.js**. Controller-returned SSR views render React / Vue / Solid through [Vike](https://vike.dev) + [Vite](https://vitejs.dev) with real SPA navigation — no Inertia adapter, no JSON envelope, no page reloads. Ship a signup flow, a background queue, a real-time collaborative document, and an AI agent from **one monorepo**, built on a service-oriented architecture (DI container, service providers, active-record ORM, a single `rudder` CLI for every task).

> **What no one else gets right at once:** structured fullstack DX, native SSR views without the Inertia tax, and a first-class AI/agent engine.

## Why RudderJS?

Modern Node.js forces a choice: **great DX in a framework-locked box** (Next.js), **freedom with weeks of wiring** (Express/Hono), **structure without fullstack views** (NestJS/Adonis API-first).

RudderJS is the middle ground — **batteries-included, modular, UI-agnostic, fullstack-first**.

| | Next.js | NestJS | AdonisJS | RudderJS |
|---|---|---|---|---|
| **Philosophy** | Component-first | Angular-style DI | Full MVC port | Service-oriented, modular |
| **Build tool** | Webpack / Turbopack | Webpack / esbuild | Webpack (stencil) | **Vite** |
| **UI framework** | React only | API only | Edge templates / Inertia | React, Vue, Solid, or none |
| **SSR views from controllers** | N/A | ✗ | Inertia adapter | ✓ **native — no Inertia, no JSON envelope** |
| **DI container** | None | Class-based IoC | IoC | Service Providers + ALS request scope |
| **AI-native** | ✗ | ✗ | ✗ | ✓ 11 providers, agents, streaming, MCP |
| **Real-time collab** | ✗ | ✗ | ✗ | ✓ Yjs CRDT + WebSocket on same port |
| **Modularity** | All-in | All-in | Preset-based | **Pay-as-you-go** — 45 opt-in packages |

---

## Key Features

- **Controller-returned views** — `return view('dashboard', { users })` renders a typed React/Vue/Solid component through Vike SSR with full SPA navigation. No Inertia adapter, no JSON envelope, ~400 bytes per nav.
- **AI-native from day one** — 11 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure for text; Cohere, Jina for reranking + embeddings), agents with tools, streaming, middleware, conversations, attachments, MCP server support, queue integration.
- **Real-time on one port** — WebSocket channels ([`@rudderjs/broadcast`](./packages/broadcast)), Yjs CRDT collab ([`@rudderjs/sync`](./packages/sync)), and HTTP all share the same server. No separate process, no proxy.
- **Service-oriented architecture** — DI container, service providers, gates & policies, an active-record ORM (Prisma or Drizzle), scheduling, queues, notifications, and a built-in inspector — all wired through one bootstrap file and one `rudder` CLI.
- **Pay-as-you-go modularity** — 46 first-party [`@rudderjs/*`](#packages-46) packages. Start with 3 ([`core`](./packages/core), [`router`](./packages/router), [`server-hono`](./packages/server-hono)), bolt on what you need. Swap adapters (Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3).
- **TypeScript-first, strict by default** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM + NodeNext everywhere. Incremental builds. WinterCG-compatible runtime.

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

The interactive installer asks you to pick a database (Prisma or Drizzle), a frontend framework (React / Vue / Solid), optional packages (Auth, Cache, Queue, Mail, AI, MCP, Passport, …), Tailwind, and shadcn/ui — then scaffolds a production-ready project.

After scaffolding (pnpm example — the CLI prints the exact commands for your PM):

```bash
cd my-app
pnpm exec prisma generate
pnpm exec prisma db push
pnpm dev
```

---

## How It Works

> Read the [Request Lifecycle](docs/guide/lifecycle.md) page first if you've used a per-request DI container before. RudderJS's container is process-scoped, not request-scoped — the one-page explanation prevents the whole class of ghost-user / stale-state bugs.

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

```ts
// bootstrap/providers.ts — providers auto-discovered from package.json
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ /* event → listeners */ }),
  AppServiceProvider,
]
```

Run `pnpm rudder providers:discover` after installing or removing packages to refresh the manifest. See [Service Providers](docs/guide/service-providers.md) for the full story.

### 2. Routes

Routes can return JSON (API endpoints) or a `view()` (SSR pages rendered through Vike). Both coexist in the same file, run the same middleware chain, and support full SPA navigation between them.

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

// Controller-returned view — render a typed React/Vue/Solid component
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

> **Why not Inertia?** Inertia ships a ~30kb client runtime, a page-object JSON protocol on every navigation, and an adapter layer between your controller and the renderer. With Laravel you also run a *second* Node SSR process and pay an intra-server HTTP hop on every request. RudderJS is pure Vike in a single Node process: props are JS objects passed by reference, client hydration uses Vike's native path, no protocol, no adapter, no second daemon to run or monitor in production.

**Framework support**: React (`vike-react`), Vue (`vike-vue`), Solid (`vike-solid`), and a vanilla HTML-string mode — zero client JS, perfect for admin reports, email bodies, webhook responses. The scanner auto-detects which renderer is installed. Vanilla views use [`@rudderjs/view`](./packages/view)'s `html\`\`` tagged template, which auto-escapes interpolations and composes via `SafeString`.

**Packages that ship views** follow a consistent shape: `views/<framework>/<Name>.{tsx,vue}` + a `registerXRoutes(router, opts)` helper. [`@rudderjs/auth`](./packages/auth) is the reference implementation — `registerAuthRoutes(Route, { middleware })` wires `/login`, `/register`, `/forgot-password`, `/reset-password` in one line, with the views vendored into `app/Views/Auth/` for the consumer to customize.

See [`@rudderjs/view`](./packages/view) for the full reference.

### 3. Rudder CLI + Scheduling

```ts
// routes/console.ts
import { Cache } from '@rudderjs/cache'
import { Rudder }  from '@rudderjs/console'
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
// app/Http/Controllers/UserController.ts
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
import { UserController } from '../app/Http/Controllers/UserController.js'

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
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
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
// Client (RudderSocket — publish with: pnpm rudder vendor:publish --tag=broadcast-client)
import { RudderSocket } from './vendor/RudderSocket'

const socket = new RudderSocket('ws://localhost:3000/ws')

const chat = socket.channel('chat')
chat.on('message', ({ user, text }) => console.log(`${user}: ${text}`))

const room = socket.presence('room.lobby', token)
room.on('presence.joined', ({ user }) => console.log(`${user.name} joined`))
room.on('presence.members', (members) => setOnlineUsers(members))
```

### 10. Real-time document sync — Yjs CRDT

```ts
// bootstrap/providers.ts
import { broadcasting } from '@rudderjs/broadcast'
import { sync }         from '@rudderjs/sync'
export default [ broadcasting(), sync() ]
```

```ts
// Client — standard yjs + y-websocket (server-side is handled by @rudderjs/sync)
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider(`ws://${location.host}/ws-sync`, 'my-doc', doc)
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

### 11. AI agents — providers, tools, streaming

```ts
// config/ai.ts
export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: {
    anthropic: { driver: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    openai:    { driver: 'openai',    apiKey: process.env.OPENAI_API_KEY! },
  },
}
```

```ts
// app/Agents/SearchAgent.ts
import { Agent, toolDefinition, stepCountIs } from '@rudderjs/ai'
import type { HasTools } from '@rudderjs/ai'
import { z } from 'zod'
import { User } from '../Models/User.js'

const searchUsers = toolDefinition({
  name: 'search_users',
  description: 'Search users by name',
  inputSchema: z.object({ query: z.string() }),
}).server(async ({ query }) => User.where('name', 'like', `%${query}%`).get())

export class SearchAgent extends Agent implements HasTools {
  instructions() { return 'You help find users in the system.' }
  model()        { return 'anthropic/claude-sonnet-4-5' }
  tools()        { return [searchUsers] }
  stopWhen()     { return stepCountIs(5) }
}
```

```ts
// Use it from any route
import { SearchAgent } from '../app/Agents/SearchAgent.js'

Route.post('/api/search', async (req, res) => {
  const response = await new SearchAgent().prompt(req.body.query)
  return res.json({ text: response.text })
})
```

Or call any provider directly with the `AI` facade:

```ts
import { AI } from '@rudderjs/ai'

const summary = await AI.prompt('Summarize this article: …')
```

Streaming responses, structured output (Zod schema), conversation memory, middleware, MCP tools, and approval gates for sensitive actions all ship in [`@rudderjs/ai`](./packages/ai).

### 12. Debug helpers

```ts
import { config, dump, dd, app, resolve } from '@rudderjs/core'

config('app.name')       // → 'my-app'
config('cache.ttl', 60)  // → 60 (with fallback)

dump({ user, session })  // pretty-prints, server keeps running
dd(req.body)             // pretty-prints then stops the request

const svc = resolve<UserService>(UserService)
```

---

## Packages (46)

> **46 first-party packages** across 12 categories — everything from DI and routing to AI agents, real-time CRDT, and production monitoring. All under one monorepo, all opt-in.

### Foundation (7)
| Package | Description |
|---|---|
| [`@rudderjs/core`](./packages/core) | Application bootstrap, DI container, Events, ServiceProvider lifecycle |
| [`@rudderjs/router`](./packages/router) | Fluent + decorator-based HTTP routing |
| [`@rudderjs/middleware`](./packages/middleware) | Pipeline, CORS, logger, CSRF, rate limiting |
| [`@rudderjs/console`](./packages/console) | Rudder CLI registry, Command base class |
| [`@rudderjs/cli`](./packages/cli) | CLI runner — dispatches `make:*` and domain commands (`queue:*`, `mail:*`, `mcp:*`, `passport:*`, `db:*`, `storage:*`, …) shipped by their owning packages |
| [`@rudderjs/support`](./packages/support) | Env, Collection, ConfigRepository, helpers |
| [`@rudderjs/contracts`](./packages/contracts) | Shared TypeScript types (no runtime) |

### HTTP & Frontend (4)
| Package | Description |
|---|---|
| [`@rudderjs/server-hono`](./packages/server-hono) | Hono HTTP adapter |
| [`@rudderjs/session`](./packages/session) | Cookie + Redis session drivers, `Session` facade — auto-installs on the `web` route group |
| [`@rudderjs/view`](./packages/view) | `view('id', props)` controller responses via Vike SSR |
| [`@rudderjs/vite`](./packages/vite) | Vite + Vike plugin with SSR externals and RudderJS integration |

### Database (3)
| Package | Description |
|---|---|
| [`@rudderjs/orm`](./packages/orm) | Model base class, ModelRegistry, QueryBuilder |
| [`@rudderjs/orm-prisma`](./packages/orm-prisma) | Prisma adapter (SQLite, PostgreSQL, MySQL) |
| [`@rudderjs/orm-drizzle`](./packages/orm-drizzle) | Drizzle adapter (SQLite, PostgreSQL, libSQL) |

### Auth & Security (6)
| Package | Description |
|---|---|
| [`@rudderjs/hash`](./packages/hash) | Password hashing (bcrypt, argon2) |
| [`@rudderjs/crypt`](./packages/crypt) | Symmetric encryption (AES-256-CBC) |
| [`@rudderjs/auth`](./packages/auth) | Authentication (guards, providers), Authorization (gates, policies), Password resets |
| [`@rudderjs/sanctum`](./packages/sanctum) | API token authentication with abilities |
| [`@rudderjs/passport`](./packages/passport) | OAuth 2 server (JWT RS256) — auth code + PKCE, client credentials, refresh, device code |
| [`@rudderjs/socialite`](./packages/socialite) | OAuth providers (GitHub, Google, Facebook, Apple) |

### Billing (1)
| Package | Description |
|---|---|
| [`@rudderjs/cashier-paddle`](./packages/cashier-paddle) | Paddle billing — Billable mixin, subscriptions, signed webhooks, checkout, refunds, price previews |

### Infrastructure (6)
| Package | Description |
|---|---|
| [`@rudderjs/queue`](./packages/queue) | Job base class, queue contract |
| [`@rudderjs/queue-bullmq`](./packages/queue-bullmq) | BullMQ Redis-backed queue |
| [`@rudderjs/queue-inngest`](./packages/queue-inngest) | Inngest serverless queue |
| [`@rudderjs/cache`](./packages/cache) | Cache facade, memory + Redis drivers (`ioredis` optional) |
| [`@rudderjs/storage`](./packages/storage) | Storage facade, local + S3/R2/MinIO (`@aws-sdk/client-s3` optional) |
| [`@rudderjs/schedule`](./packages/schedule) | Task scheduler, cron-based |

### Communication (4)
| Package | Description |
|---|---|
| [`@rudderjs/mail`](./packages/mail) | Mailable, Mail facade, log + SMTP drivers (`nodemailer` optional) |
| [`@rudderjs/notification`](./packages/notification) | Multi-channel notifications (mail, database) |
| [`@rudderjs/broadcast`](./packages/broadcast) | WebSocket channels — pub/sub, private, presence |
| [`@rudderjs/sync`](./packages/sync) | Yjs CRDT real-time document sync (editor adapters under subpaths: `@rudderjs/sync/lexical`, `/tiptap`) |

### Internationalization (1)
| Package | Description |
|---|---|
| [`@rudderjs/localization`](./packages/localization) | i18n — `trans()`, `setLocale()`, locale-aware middleware, JSON translation files |

### Developer Experience (7)
| Package | Description |
|---|---|
| [`@rudderjs/log`](./packages/log) | Structured logging — channels (console, file, daily, stack), RFC 5424 levels, formatters, context |
| [`@rudderjs/http`](./packages/http) | Fluent HTTP client — retries, timeouts, pools, interceptors, `Http.fake()` |
| [`@rudderjs/context`](./packages/context) | Request-scoped context — ALS-backed data bag, auto-propagates to logs and queued jobs |
| [`@rudderjs/pennant`](./packages/pennant) | Feature flags — define, scope to users/teams, Lottery gradual rollout, `Feature.fake()` |
| [`@rudderjs/process`](./packages/process) | Shell execution — run, pool, pipe, timeouts, real-time output, `Process.fake()` |
| [`@rudderjs/concurrency`](./packages/concurrency) | Parallel execution via worker threads, deferred fire-and-forget, sync driver for testing |
| [`@rudderjs/testing`](./packages/testing) | TestCase, TestResponse assertions, RefreshDatabase, WithFaker, HTTP request helpers |

### Media (1)
| Package | Description |
|---|---|
| [`@rudderjs/image`](./packages/image) | Fluent image processing — resize, crop, convert, optimize (sharp wrapper) |

### Observability (3)
| Package | Description |
|---|---|
| [`@rudderjs/telescope`](./packages/telescope) | Development inspector — 19 watchers: requests, queries, jobs, exceptions, logs, mail, notifications, events, cache, schedule, models, commands, outgoing HTTP, authorization gates, AI agent runs, MCP server activity, dumps, WebSocket lifecycle, Yjs CRDT events |
| [`@rudderjs/pulse`](./packages/pulse) | Application metrics — request throughput/duration, queue metrics, cache hit rates, active users, server stats |
| [`@rudderjs/horizon`](./packages/horizon) | Queue monitor — full job lifecycle, per-queue metrics, worker status, failed job retry/delete |

### AI & Tooling (3)
| Package | Description |
|---|---|
| [`@rudderjs/ai`](./packages/ai) | AI engine — 11 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure for text; Cohere, Jina for reranking + embeddings), Agent class, tool system, streaming, middleware |
| [`@rudderjs/boost`](./packages/boost) | AI dev tools — MCP server for Claude Code, Cursor, Copilot |
| [`@rudderjs/mcp`](./packages/mcp) | MCP server framework — build custom MCP servers with decorators and testing utilities |

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

RudderJS is **fully on 1.0+** as of 2026-05-02. The first wave (2026-04-29) graduated 29 framework packages simultaneously; three follow-up waves over the next four days finished the remaining eight (`http`, `image`, `process`, `concurrency`, then `console`, `sync`, `vite`, `orm-drizzle`). Every published `@rudderjs/*` package is now at `1.0.0` or higher, with stable public APIs — breaking changes from here on require explicit major bumps and migration notes.

- Framework packages published to npm under `@rudderjs/*`
- Scaffolder published as [`create-rudder-app`](https://www.npmjs.com/package/create-rudder-app)
- CI runs build, typecheck, lint, and tests on every PR
- Automated releases via Changesets — merge a version PR, packages publish automatically
- Playground (port 3000) demonstrates routing, ORM, auth, queues, cache, storage, mail, notifications, scheduling, WebSocket broadcasting, real-time Yjs CRDT, AI agents, monitoring (Telescope, Pulse, Horizon) — all end-to-end

### Versioning

RudderJS uses **independent versioning** — each `@rudderjs/*` package has its own version line. Same model as Laravel's first-party packages (`cashier@16.x`, `socialite@5.x`, `sanctum@4.x` — all live in the same ecosystem, all at different majors), AdonisJS, and most of the npm ecosystem.

What you'll see across the workspace:

- **`1.0.x`** — packages that graduated in one of the four waves. Stable public API, breaking changes require a major bump.
- **Higher majors** (`auth@4.x`, `cashier-paddle@2.x`, `cli@4.x`, `horizon@6.x`, `mcp@5.x`, `pulse@6.x`, `queue@4.x`, `sanctum@6.x`, `telescope@12.x`) — packages that were already past 1.0 before the graduation, plus the cascade-major-bumps from each release wave. The number reflects iteration history, not "more important."

The version spread is informative, not asymmetric: a higher major means the package has been through more iteration cycles, not that it's more central. `core@1.0.x` and `telescope@12.x` are equally stable.

## Contributing

```bash
git clone https://github.com/rudderjs/rudder.git
cd rudder
pnpm install
pnpm build
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dependency conventions and the package merge policy.

## License

MIT © [RudderJS](https://github.com/rudderjs/rudder)
