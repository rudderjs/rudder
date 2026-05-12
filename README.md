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

RudderJS is a **batteries-included, modular TypeScript framework for Node.js**. Ship a signup flow, a background queue, a real-time collaborative document, and an AI agent from one monorepo — wired through a DI container, an active-record ORM, and a single `rudder` CLI.

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view }  from '@rudderjs/view'
import { User }  from 'App/Models/User.js'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { users })
})
```

```tsx
// app/Views/Dashboard.tsx
export default function Dashboard({ users }: { users: User[] }) {
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

That's a typed, SSR'd `/dashboard` rendered through Vike — full SPA navigation, no Inertia adapter, no JSON envelope. The same router chain serves JSON APIs, queued jobs, scheduled tasks, WebSocket channels, and AI agents.

---

## Highlights

- **Controller-returned SSR views** — `return view('id', props)` renders typed React / Vue / Solid components through Vike. SPA nav after first paint, ~400 bytes per nav, no Inertia tax. `return terminal('id', props)` renders the same components in the terminal via Ink.
- **AI-native** — 11 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure, Cohere, Jina), agents with tools, streaming, MCP, queue-backed runs, approval gates.
- **Real-time on one port** — WebSocket channels, presence, and Yjs CRDT collab share the same Hono server. No second daemon, no proxy.
- **Service-oriented** — DI container with ALS request scope, service providers, gates & policies, active-record ORM (Prisma or Drizzle), one bootstrap file.
- **Pay-as-you-go** — 46 first-party `@rudderjs/*` packages. Start with three, bolt on what you need. Swap adapters (Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3) without changing app code.
- **One CLI** — `pnpm rudder make:*`, `queue:*`, `mail:*`, `mcp:*`, `passport:*`, `db:*`, `storage:*`, plus your own commands. Scaffolders ship with their owning packages.
- **TypeScript-first** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM + NodeNext, incremental builds, WinterCG-compatible runtime.

---

## A taste of RudderJS

Seven features, seven snippets. Each one is real code from the playground — copy, run, ship.

### 1. Bootstrap — the whole app shape in one file

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({ server: hono(configs.server), config: configs, providers })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.web(CsrfMiddleware())
    m.web(RateLimit.perMinute(120))
    m.api(RateLimit.perMinute(60))
  })
  .create()
```

One file — server adapter, config, providers, routing, middleware groups, exception handlers (`.withExceptions(...)`), all in a fluent chain. No nested config trees, no decorators-at-the-root, no surprise files.

### 2. Routing — web & API in one router

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view }  from '@rudderjs/view'

Route.get('/dashboard', async () => view('dashboard'))
```

```ts
// routes/api.ts
import { Route } from '@rudderjs/router'

Route.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
Route.post('/api/users', async (req, res) => res.json({ created: req.body }))
```

Same router, same middleware engine — the `web` group runs through session + auth + CSRF, the `api` group is stateless by default.

### 3. Console & Terminal — rudder commands + Ink

```ts
// routes/console.ts — wire rudder commands
import { Rudder } from '@rudderjs/console'
import { terminal } from '@rudderjs/terminal'
import { User } from 'App/Models/User.js'

// Inline command — read DB, print stdout
Rudder.command('users:count', async () => {
  console.log(`${await User.count()} users`)
}).description('Count users')

// Same handler, but renders an Ink component in the terminal
Rudder.command('dashboard', async () => {
  return terminal('dashboard', { users: 1240, orders: 87 })
}).description('Show a terminal dashboard')
```

```tsx
// app/Terminal/Dashboard.tsx — typed props, React 19 + Ink
import { Box, Text } from 'ink'

export default function Dashboard({ users, orders }: { users: number; orders: number }) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Daily snapshot</Text>
      <Text>{users} users · {orders} orders</Text>
    </Box>
  )
}
```

Run with `pnpm rudder users:count` or `pnpm rudder dashboard`. Scaffold new ones with `make:command` (plain handlers) or `make:terminal` (Ink components). Class-based commands extend `Command` for DI + signature parsing.

### 4. Controllers, middleware & views

```ts
// app/Http/Controllers/UserController.ts
import { Controller, Get, Middleware } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import { view } from '@rudderjs/view'
import { User } from 'App/Models/User.js'

@Controller('/users')
export class UserController {
  @Get('/')
  @Middleware([RateLimit.perMinute(60)])
  async index() {
    const users = await User.all()
    return view('users.index', { users })
  }
}
```

```tsx
// app/Views/Users/Index.tsx — typed props, SSR'd through Vike
export default function Index({ users }: { users: User[] }) {
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

Decorator controllers, fluent middleware, controller-returned SSR views. No Inertia adapter, no JSON envelope.

### 5. ORM — active record, Prisma or Drizzle

```ts
// app/Models/Post.ts
import { Model } from '@rudderjs/orm'

export class Post extends Model {
  static table    = 'post'
  static fillable = ['title', 'body', 'authorId']

  id!: number
  title!: string
  body!: string
}

// Anywhere — query, mutate, paginate
const recent = await Post.where('published', true).orderBy('createdAt', 'desc').paginate(1, 20)
const post   = await Post.create({ title: 'Hello', body: 'World', authorId: 1 })
await post.update({ title: 'Hello, RudderJS' })
```

Same API on top of Prisma or Drizzle — swap adapters without touching model code.

### 6. AI agents — 11 providers, tools, streaming

```ts
import { agent, toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'

const getWeather = toolDefinition({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  inputSchema: z.object({ city: z.string() }),
}).server(async ({ city }) => `${city}: 22°C and sunny`)

const weatherAgent = agent({
  instructions: 'You help people check the weather. Use get_weather when asked.',
  model: 'anthropic/claude-haiku-4-5-20251001',
  tools: [getWeather],
})

const reply = await weatherAgent.prompt('What is the weather in Tokyo?')
// reply.text, reply.steps, reply.usage
```

Same agent works with Anthropic, OpenAI, Google, Groq, Ollama, xAI, DeepSeek, Mistral, Azure, Cohere, Jina. Add `.stream()` for SSE, run agents on the queue, gate tool calls with approval.

### 7. Real-time — WebSocket channels on the same port

```ts
// routes/channels.ts — declare a presence channel
import { Broadcast } from '@rudderjs/broadcast'

Broadcast.channel('presence-lobby', async (req) => {
  return { id: req.user?.id, name: req.user?.name }
})
```

```ts
// anywhere — push to every subscriber
import { broadcast } from '@rudderjs/broadcast'

broadcast('chat', 'message', { user: 'Ada', text: 'Hi there', ts: Date.now() })
```

WebSocket server bundled with `@rudderjs/broadcast` — no second daemon, no Pusher dependency. Auth, presence, and wildcard channels work out of the box.

### 8. Sync — collaborative documents with Yjs CRDT

```ts
// bootstrap/providers.ts
import { SyncProvider } from '@rudderjs/sync'

export default [
  ...(await defaultProviders()),
  SyncProvider,  // mounts /ws-sync on the same Hono server
]
```

```ts
// client — any browser, any framework
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3000/ws-sync', 'article:42', doc)
const text     = doc.getText('content')

text.observe(() => console.log(text.toString()))
text.insert(0, 'Hello, collaborator!')
```

Conflict-free merging, offline support, presence — same port as your HTTP server. Persist to memory, Redis, or Prisma.

---

## Quick start

Pick any package manager — the installer auto-detects it:

```bash
pnpm create rudder-app my-app
# or: npm create rudder-app@latest my-app
# or: yarn create rudder-app my-app
# or: bunx create-rudder-app my-app
```

The interactive installer asks you to pick a database (Prisma or Drizzle), a frontend framework (React / Vue / Solid), optional packages (Auth, Cache, Queue, Mail, AI, MCP, Passport, …), Tailwind, and shadcn/ui — then scaffolds a production-ready project.

```bash
cd my-app
pnpm exec prisma generate
pnpm exec prisma db push
pnpm dev
```

Visit `http://localhost:3000`. Done.

---

## Packages (47)

> Three foundation packages get you running. The rest are opt-in.

**Foundation** — [`core`](./packages/core) · [`router`](./packages/router) · [`server-hono`](./packages/server-hono) · [`middleware`](./packages/middleware) · [`console`](./packages/console) · [`cli`](./packages/cli) · [`terminal`](./packages/terminal) · [`support`](./packages/support) · [`contracts`](./packages/contracts)

**HTTP & frontend** — [`view`](./packages/view) · [`vite`](./packages/vite) · [`session`](./packages/session)

**Data** — [`orm`](./packages/orm) · [`orm-prisma`](./packages/orm-prisma) · [`orm-drizzle`](./packages/orm-drizzle) · [`cache`](./packages/cache) · [`storage`](./packages/storage)

**Auth & security** — [`auth`](./packages/auth) · [`hash`](./packages/hash) · [`crypt`](./packages/crypt) · [`sanctum`](./packages/sanctum) · [`passport`](./packages/passport) · [`socialite`](./packages/socialite)

**Billing** — [`cashier-paddle`](./packages/cashier-paddle)

**Workloads** — [`queue`](./packages/queue) · [`queue-bullmq`](./packages/queue-bullmq) · [`queue-inngest`](./packages/queue-inngest) · [`schedule`](./packages/schedule) · [`concurrency`](./packages/concurrency) · [`process`](./packages/process)

**Communication** — [`mail`](./packages/mail) · [`notification`](./packages/notification) · [`broadcast`](./packages/broadcast) · [`sync`](./packages/sync)

**AI & tooling** — [`ai`](./packages/ai) · [`mcp`](./packages/mcp) · [`boost`](./packages/boost)

**Developer experience** — [`log`](./packages/log) · [`http`](./packages/http) · [`context`](./packages/context) · [`pennant`](./packages/pennant) · [`localization`](./packages/localization) · [`image`](./packages/image) · [`testing`](./packages/testing)

**Observability** — [`telescope`](./packages/telescope) · [`pulse`](./packages/pulse) · [`horizon`](./packages/horizon)

---

## Default stack

| Layer | Default | Swap with |
|---|---|---|
| HTTP | Hono | Express, Fastify, H3 |
| ORM | Prisma | Drizzle |
| Auth | Native session | Sanctum (API tokens), Socialite (OAuth) |
| Queue | BullMQ | Inngest |
| Cache | In-memory | Redis |
| Storage | Local disk | S3, R2, MinIO |
| Mail | Log (dev) | SMTP via Nodemailer |

---

## Documentation

**Get started**

- [Installation](./docs/guide/installation.md) · [Configuration](./docs/guide/configuration.md) · [Directory structure](./docs/guide/directory-structure.md) · [Request lifecycle](./docs/guide/lifecycle.md)

**Core**

- [Routing](./docs/guide/routing.md) · [Middleware](./docs/guide/middleware.md) · [Controllers](./docs/guide/controllers.md) · [Requests](./docs/guide/requests.md) · [Responses](./docs/guide/responses.md) · [Validation](./docs/guide/validation.md) · [Frontend / views](./docs/guide/frontend.md)
- [Service providers](./docs/guide/service-providers.md) · [DI container](./docs/guide/container.md) · [Facades](./docs/guide/facades.md) · [Events](./docs/guide/events.md) · [Error handling](./docs/guide/error-handling.md)

**Data**

- [Database](./docs/guide/database.md) · [Cache](./docs/guide/cache.md) · [Storage](./docs/guide/storage.md)

**Auth & security**

- [Authentication](./docs/guide/authentication.md) · [Authorization](./docs/guide/authorization.md) · [Hashing](./docs/guide/hashing.md) · [Encryption](./docs/guide/encryption.md) · [Rate limiting](./docs/guide/rate-limiting.md)

**Workloads & messaging**

- [Queues](./docs/guide/queues.md) · [Scheduling](./docs/guide/scheduling.md) · [Mail](./docs/guide/mail.md) · [Notifications](./docs/guide/notifications.md) · [Broadcasting](./docs/guide/broadcasting.md) · [Sync (CRDT)](./docs/guide/sync.md)

**AI & MCP**

- [AI agents](./docs/guide/ai.md) · [MCP servers](./docs/guide/mcp.md)

**More**

- [HTTP client](./docs/guide/http-client.md) · [Logging](./docs/guide/logging.md) · [Localization](./docs/guide/localization.md) · [Rudder CLI](./docs/guide/rudder.md) · [Testing](./docs/guide/testing.md) · [Deployment](./docs/guide/deployment.md)

---

## Why RudderJS?

Modern Node.js forces a choice: **great DX in a framework-locked box** (Next.js), **freedom with weeks of wiring** (Express / Hono), **structure without fullstack views** (NestJS / Adonis).

RudderJS is the middle ground — batteries-included, modular, UI-agnostic, fullstack-first.

| | Next.js | NestJS | AdonisJS | RudderJS |
|---|---|---|---|---|
| Philosophy | Component-first | Angular-style DI | Full MVC port | Service-oriented, modular |
| Build tool | Webpack / Turbopack | Webpack / esbuild | Webpack (stencil) | **Vite** |
| UI framework | React only | API only | Edge templates / Inertia | React, Vue, Solid, or none |
| SSR views from controllers | N/A | ✗ | Inertia adapter | ✓ native — no Inertia, no JSON envelope |
| DI container | None | Class-based IoC | IoC | Service Providers + ALS request scope |
| AI-native | ✗ | ✗ | ✗ | ✓ 11 providers, agents, streaming, MCP |
| Real-time collab | ✗ | ✗ | ✗ | ✓ Yjs CRDT + WebSocket on same port |
| Modularity | All-in | All-in | Preset-based | Pay-as-you-go — 46 opt-in packages |

---

## Status

RudderJS is **fully on 1.0+** as of 2026-05-02. Every published `@rudderjs/*` package has a stable public API; breaking changes from here on require explicit major bumps and migration notes.

RudderJS uses **independent versioning** — each `@rudderjs/*` package has its own version line, matching the norm across the npm ecosystem. A higher major reflects iteration history, not "more important."

---

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
