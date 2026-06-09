<p align="center">
  <strong>The fullstack Node.js framework with structure, speed, and AI built in.</strong>
</p>

<p align="center">
  <img src="./logo.png" alt="Rudder — Boost Your Node App" width="280" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rudderjs/core"><img src="https://img.shields.io/npm/v/@rudderjs/core?label=core&color=f5a623" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/create-rudder"><img src="https://img.shields.io/npm/v/create-rudder?label=create-rudder&color=f5a623" alt="create-rudder" /></a>
  <a href="https://github.com/rudderjs/rudder/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-powered-646cff" alt="Vite" />
</p>

---

Rudder is a **batteries-included, modular TypeScript framework for Node.js**. Ship a signup flow, a background queue, a real-time collaborative document, and an AI agent from one monorepo — wired through a DI container, an active-record ORM, and a single `rudder` CLI.

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
export interface Props { users: User[] }

export default function Dashboard({ users }: Props) {
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

That's a typed, SSR'd `/dashboard` rendered through Vike — full SPA navigation, no Inertia adapter, no JSON envelope. Export `Props` and the `view('dashboard', ...)` call is type-checked at the controller. The same router chain serves JSON APIs, queued jobs, scheduled tasks, WebSocket channels, and AI agents.

---

## Highlights

- **Controller-returned SSR views** — `return view('id', props)` renders typed React / Vue / Solid components through Vike. SPA nav after first paint, ~400 bytes per nav, no Inertia tax. `return terminal('id', props)` renders the same components in the terminal via Ink.
- **AI-native** — 15 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure, Cohere, Jina, OpenRouter, Bedrock, ElevenLabs, Voyage), agents with tools, streaming, MCP, queue-backed runs, approval gates.
- **Real-time on one port** — WebSocket channels, presence, and Yjs CRDT collab share the same Hono server. No second daemon, no proxy.
- **Service-oriented** — DI container with ALS request scope, service providers, gates & policies, active-record ORM (built-in native engine, or Prisma / Drizzle), one bootstrap file.
- **Pay-as-you-go** — 51 first-party `@rudderjs/*` packages. Start with three, bolt on what you need. Swap adapters (native ↔ Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3) without changing app code.
- **Auto-discovery** — install a `@rudderjs/*` package, done. The provider manifest self-heals at boot: no command to run, no imports to add, no provider array to maintain. Laravel-style package discovery for the Node ecosystem.
- **One CLI** — `pnpm rudder make:*`, `queue:*`, `mail:*`, `mcp:*`, `passport:*`, `db:*`, `storage:*`, plus your own commands. Scaffolders ship with their owning packages. First-class diagnostics — `pnpm rudder doctor` pre-flights every layer green/yellow/red, with `--fix` for the safe ones. Introspection on tap — `route:list --verbose`, `event:list`, `config:show` for the "where is this wired up?" questions.
- **TypeScript-first** — typed everything from one convention each: views (`view('id', props)` checked against the component's `Props`), routes (path params, query / body / response schemas, + `route()` lookups), models (column types generated from migrations), `config()` (dot-paths from your own `config/`), and `Env.get()` (keys from `.env.example`). Validators are [Standard Schema](https://standardschema.dev) (Zod / Valibot / ArkType). Plus `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM + NodeNext, WinterCG-compatible runtime.
- **Code-first API docs** — declare responses with `.responds(schema)` and `@rudderjs/openapi` emits an [OpenAPI 3.1 spec + Swagger UI](./docs/guide/openapi.md) from your route table. No hand-written YAML, opt-in, FastAPI-style.

---

## A taste of Rudder

Thirteen features, thirteen snippets. Each one is real code from the playground — copy, run, ship.

### 1. Bootstrap — the whole app shape in one file

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import { Application } from '@rudderjs/core'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import config from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({ config, providers })
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

One file — config, providers, routing, middleware groups, exception handlers (`.withExceptions(...)`), all in a fluent chain. The HTTP server adapter resolves itself (`@rudderjs/server-hono`, configured from `config/server.ts`) — pass `server: hono(...)` only to override it. No nested config trees, no decorators-at-the-root, no surprise files. And the config layer is typed end-to-end: `config('app.name')` autocompletes dot-paths from your own `config/` directory, `Env.get('DATABASE_URL')` autocompletes the keys declared in `.env.example` — no codegen to remember for the former, one auto-regenerated registry for the latter.

### 2. Routing — web & API in one router, end-to-end typed

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view }  from '@rudderjs/view'

Route.get('/dashboard', async () => view('dashboard'))
```

```ts
// routes/api.ts — typed path, query, AND body in one declaration
import { Route, route } from '@rudderjs/router'
import { z } from 'zod'

Route.post(
  '/api/users/:id',
  {
    query: z.object({ notify: z.coerce.boolean().default(false) }),
    body:  z.object({ name: z.string(), email: z.string().email() }),
  },
  (req, res) => {
    const id:     string  = req.params.id     // from the path
    const notify: boolean = req.query.notify  // coerced from ?notify=1
    const name:   string  = req.body.name     // validated body
    return res.json({ id, notify, updated: name })
  },
)
  .name('users.update')
  .responds(z.object({ id: z.string(), updated: z.string() }))  // typed response → OpenAPI

// `route()` URL generator — type-check params against the path (opt-in)
route('users.update', { id: 1, notify: true })
// → '/api/users/1?notify=true'
```

Same router, same middleware engine — the `web` group runs through session + auth + CSRF, the `api` group is stateless by default. Path params, query, body, **and response** all infer from a single declaration; failure surfaces as `422 { errors: {...} }` automatically. Schemas type against [Standard Schema](https://standardschema.dev) (Zod / Valibot / ArkType — Zod by default), and `@rudderjs/openapi` turns the same declarations into an [OpenAPI 3.1 spec + Swagger UI](./docs/guide/openapi.md), no hand-written YAML. Declare your named routes in `RouteRegistry` (see [Typed Routes](./docs/guide/typed-routes.md)) and `route()` calls type-check too.

### 3. Controllers, middleware & views

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
// app/Views/Users/Index.tsx — SSR'd through Vike, props checked at the controller
export interface Props { users: User[] }

export default function Index({ users }: Props) {
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

Decorator controllers, fluent middleware, controller-returned SSR views. Export `Props` from the view and the matching `view('id', ...)` call is type-checked — wrong shape fails tsc, not render. No Inertia adapter, no JSON envelope.

### 4. Console & Terminal — rudder commands + Ink

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

Need to poke at the DB or a service interactively? `pnpm rudder tinker` boots the app and drops into a Node REPL with `app()`, `Route`, every model in `app/Models/`, and the facades pre-imported — Laravel `php artisan tinker` parity:

```bash
$ pnpm rudder tinker
Rudder Tinker — node v22.14.0, env=local

> await User.count()
12
> const alice = await User.where('email', 'alice@example.com').first()
> alice.posts().count()
5
> route('users.show', { id: alice.id })
'/users/42'
```

Top-level `await`, persistent history in `~/.rudder-tinker-history`, `.boot` meta-command to pick up code changes.

### 5. ORM — active record on the built-in engine, Prisma, or Drizzle

```ts
// app/Models/Post.ts — column types GENERATED from your migrations (native engine)
import { Model } from '@rudderjs/orm'

export class Post extends Model.for<'posts'>() {
  static table    = 'posts'
  static fillable = ['title', 'body', 'authorId']
  // no id!/title!/body! — they come from the migrated schema, so they can't drift
}

// Anywhere — query, mutate, paginate
const recent = await Post.where('published', true).latest().paginate(1, 20)
const post   = await Post.create({ title: 'Hello', body: 'World', authorId: 1 })
await post.update({ title: 'Hello, Rudder' })

// Full SQL when you need it — joins, CTEs, EXISTS subqueries, JSON paths, row locks
const polyglots = await Post.where('meta->lang', 'en').orWhereJsonContains('meta->tags', 'i18n').get()
const authors   = await User.whereExists(
  Post.query().whereColumn('posts.authorId', '=', 'users.id'),
).get()
```

One Model API over three engines: the **built-in native engine** (`@rudderjs/database` — zero codegen, Laravel-style migrations + rollback, types generated from the schema as a migrate side effect) or **Prisma** / **Drizzle**. Swap engines in config without touching model code; relations (incl. polymorphic + through), soft deletes, observers, factories, casts, and read/write splitting with sticky reads work on all three.

### 6. AI agents — 15 providers, tools, streaming

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

### 9. Auth — guards, policies, vendored views

```ts
// config/auth.ts
import { User } from 'App/Models/User.js'

export default {
  defaults:  { guard: 'web' },
  guards:    { web: { driver: 'session', provider: 'users' } },
  providers: { users: { driver: 'eloquent', model: User } },
}
```

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { auth, Gate } from '@rudderjs/auth'
import { registerAuthRoutes } from '@rudderjs/auth/routes'

registerAuthRoutes(Route)   // /login, /register, /forgot-password, /reset-password

Gate.define('edit-post', (user, post: { authorId: number }) => user?.id === post.authorId)

Route.get('/me', async (req, res) => {
  const user = await auth().user()
  return res.json({ user })
})
```

`AuthMiddleware` auto-installs on the web group — `req.user` is populated for every web route. Login/register pages are vendored into `app/Views/Auth/` at scaffold time so the app owns the files. `Gate` + `Policy` mirror Laravel's authorization API.

### 10. Validation — `FormRequest` + Zod

```ts
// app/Http/Requests/CreateUserRequest.ts
import { FormRequest, z } from '@rudderjs/core'

const schema = z.object({
  name:  z.string().min(2, 'Name must be at least 2 characters.'),
  email: z.string().email('Invalid email address.'),
  role:  z.enum(['admin', 'user']).optional().default('user'),
})

export class CreateUserRequest extends FormRequest<typeof schema> {
  rules() { return schema }
}
```

```ts
// routes/api.ts
Route.post('/api/users', async (req, res) => {
  const data = await new CreateUserRequest().validate(req)
  // data is typed: { name: string; email: string; role: 'admin' | 'user' }
  return res.json({ created: data })
})
```

Validation failures throw a `ValidationError` that the framework auto-renders as `422 { errors: {...} }` for JSON requests, or flashes back to the form with `old` data on web routes. Lifecycle hooks (`prepareForValidation`, `messages`, `after`, `passedValidation`, `failedValidation`) match Laravel's `FormRequest`.

### 11. MCP servers — expose your app to AI agents

```ts
// app/Mcp/EchoServer.ts
import { McpServer, Name, Version, Instructions } from '@rudderjs/mcp'
import { EchoTool } from './EchoTool.js'

@Name('echo-server')
@Version('1.0.0')
@Instructions('A demo MCP server that echoes messages back.')
export class EchoServer extends McpServer {
  protected tools = [EchoTool]
}
```

```ts
// app/Mcp/EchoTool.ts — typed input, DI-injected dependencies
import { z } from 'zod'
import { McpTool, McpResponse, Description, Handle } from '@rudderjs/mcp'
import { GreetingService } from 'App/Services/GreetingService.js'

@Description("Greets someone by name using the app's GreetingService")
export class EchoTool extends McpTool {
  schema() { return z.object({ name: z.string().describe('The name to greet') }) }

  @Handle(GreetingService)
  async handle(input: Record<string, unknown>, greeter: GreetingService) {
    return McpResponse.text(greeter.greet(String(input['name'])))
  }
}
```

Mount over HTTP or stdio. Inspect tool calls live with `pnpm rudder mcp:inspector`. Bridge an `Agent` straight to MCP with `mcpServerFromAgent(MyAgent)` — Laravel doesn't ship this; Rudder does.

### 12. Queue — typed jobs, retries, priorities

```ts
// app/Jobs/WelcomeUserJob.ts
import { Job } from '@rudderjs/queue'

export class WelcomeUserJob extends Job {
  static override queue   = 'default'
  static override retries = 3

  constructor(private readonly name: string, private readonly email: string) {
    super()
  }

  async handle() {
    // send mail, sync CRM, whatever
  }

  failed(error: unknown) {
    console.error('[WelcomeUserJob] failed:', error)
  }
}
```

```ts
// anywhere — dispatch from a controller, event listener, or another job
await WelcomeUserJob.dispatch('Ada', 'ada@example.com').send()
await WelcomeUserJob.dispatch('VIP', 'vip@example.com').onQueue('priority').send()
```

Sync driver for dev, BullMQ + Inngest adapters for prod. Run workers with `pnpm rudder queue:work`. Monitor live with `@rudderjs/horizon` (Laravel Horizon equivalent).

### 13. Schedule — fluent cron, no crontab edits

```ts
// routes/console.ts
import { Schedule } from '@rudderjs/schedule'
import { Cache } from '@rudderjs/cache'

Schedule.call(async () => {
  await Cache.forget('users:all')
}).everyFiveMinutes().description('Flush users:all cache')

Schedule.call(() => sendDigest())
  .weekdays()
  .dailyAt('9:00')
  .timezone('America/New_York')
  .description('Morning digest')
```

Run the scheduler with `pnpm rudder schedule:work` (long-lived) or `schedule:run` (one-shot, cron-driven). Frequency helpers, timezones, overlap prevention, and per-task descriptions surface in `pnpm rudder schedule:list`.

---

## Quick start

Pick any package manager — the installer auto-detects it:

```bash
pnpm create rudder my-app
# or: npm create rudder@latest my-app
# or: yarn create rudder my-app
# or: bunx create-rudder my-app
```

The installer asks one question — _"What are you building?"_ — and picks a recipe (Web app · SaaS · API service · Realtime · Minimal · Custom), a database, a frontend framework, and styling. Then it installs deps, sets up the database (native migrations by default; Prisma/Drizzle generate + push if you picked those), publishes auth views, and initializes git — all without leaving the prompt.

```bash
cd my-app && pnpm dev
```

Visit `http://localhost:3000`. Done.

> **Adding packages later.** `pnpm rudder add queue` installs the package, generates its config, registers it in `config/index.ts`, and refreshes the provider manifest. `pnpm rudder remove queue` reverses it. See the [CLI guide](./docs/guide/rudder.md).
>
> **Something not working?** `pnpm rudder doctor` checks env, structure, deps, ORM, and runtime — one line per failure plus a paste-able fix. Add `--fix` to auto-apply the safe ones. See the [Doctor guide](./docs/guide/doctor.md).

---

## Packages (51)

> Three foundation packages get you running. The rest are opt-in.

**Foundation** — [`core`](./packages/core) · [`router`](./packages/router) · [`server-hono`](./packages/server-hono) · [`middleware`](./packages/middleware) · [`console`](./packages/console) · [`cli`](./packages/cli) · [`terminal`](./packages/terminal) · [`support`](./packages/support) · [`contracts`](./packages/contracts) · [`json-schema`](./packages/json-schema)

**HTTP & frontend** — [`view`](./packages/view) · [`vite`](./packages/vite) · [`session`](./packages/session) · [`openapi`](./packages/openapi)

**Data** — [`orm`](./packages/orm) · [`database`](./packages/database) · [`orm-prisma`](./packages/orm-prisma) · [`orm-drizzle`](./packages/orm-drizzle) · [`cache`](./packages/cache) · [`storage`](./packages/storage)

**Auth & security** — [`auth`](./packages/auth) · [`hash`](./packages/hash) · [`crypt`](./packages/crypt) · [`sanctum`](./packages/sanctum) · [`passport`](./packages/passport) · [`socialite`](./packages/socialite)

**Billing** — [`cashier-paddle`](./packages/cashier-paddle)

**Workloads** — [`queue`](./packages/queue) · [`queue-bullmq`](./packages/queue-bullmq) · [`queue-inngest`](./packages/queue-inngest) · [`schedule`](./packages/schedule) · [`concurrency`](./packages/concurrency) · [`process`](./packages/process)

**Communication** — [`mail`](./packages/mail) · [`notification`](./packages/notification) · [`broadcast`](./packages/broadcast) · [`broadcast-redis`](./packages/broadcast-redis) · [`sync`](./packages/sync)

**AI & tooling** — [`ai`](./packages/ai) · [`mcp`](./packages/mcp) · [`boost`](./packages/boost)

**Developer experience** — [`log`](./packages/log) · [`http`](./packages/http) · [`context`](./packages/context) · [`pennant`](./packages/pennant) · [`localization`](./packages/localization) · [`image`](./packages/image) · [`testing`](./packages/testing)

**Observability** — [`telescope`](./packages/telescope) · [`pulse`](./packages/pulse) · [`horizon`](./packages/horizon)

---

## Default stack

| Layer | Default | Swap with |
|---|---|---|
| HTTP | Hono | pluggable server adapter |
| ORM / database | Native engine (built-in, `@rudderjs/database`) | Prisma, Drizzle |
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

- [HTTP client](./docs/guide/http-client.md) · [Logging](./docs/guide/logging.md) · [Localization](./docs/guide/localization.md) · [Rudder CLI](./docs/guide/rudder.md) · [Rudder Doctor](./docs/guide/doctor.md) · [Testing](./docs/guide/testing.md) · [Deployment](./docs/guide/deployment.md)

---

## Why Rudder?

Modern Node.js forces a choice: **great DX in a framework-locked box** (Next.js), **freedom with weeks of wiring** (Express / Hono), **structure without fullstack views** (NestJS / Adonis).

Rudder is the middle ground — batteries-included, modular, UI-agnostic, fullstack-first.

| | Next.js | NestJS | AdonisJS | Rudder |
|---|---|---|---|---|
| Philosophy | Component-first | Angular-style DI | Full MVC port | Service-oriented, modular |
| Build tool | Webpack / Turbopack | Webpack / esbuild | Webpack (stencil) | **Vite** |
| UI framework | React only | API only | Edge templates / Inertia | React, Vue, Solid, or none |
| SSR views from controllers | N/A | ✗ | Inertia adapter | ✓ native — no Inertia, no JSON envelope |
| DI container | None | Class-based IoC | IoC | Service Providers + ALS request scope |
| AI-native | ✗ | ✗ | ✗ | ✓ 15 providers, agents, streaming, MCP |
| Real-time collab | ✗ | ✗ | ✗ | ✓ Yjs CRDT + WebSocket on same port |
| Modularity | All-in | All-in | Preset-based | Pay-as-you-go — 48 opt-in packages |

---

## Status

Rudder is **fully on 1.0+** as of 2026-05-02. Every published `@rudderjs/*` package has a stable public API; breaking changes from here on require explicit major bumps and migration notes.

Rudder uses **independent versioning** — each `@rudderjs/*` package has its own version line, matching the norm across the npm ecosystem. A higher major reflects iteration history, not "more important."

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

MIT © [Rudder](https://github.com/rudderjs/rudder)
