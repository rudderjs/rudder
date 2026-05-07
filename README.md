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
import { User }  from './app/Models/User.js'

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

- 🎨 **Controller-returned SSR views** — `return view('id', props)` renders typed React / Vue / Solid components through Vike. SPA nav after first paint, ~400 bytes per nav, no Inertia tax.
- 🧠 **AI-native** — 11 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure, Cohere, Jina), agents with tools, streaming, MCP, queue-backed runs, approval gates.
- 🔌 **Real-time on one port** — WebSocket channels, presence, and Yjs CRDT collab share the same Hono server. No second daemon, no proxy.
- 🧱 **Service-oriented** — DI container with ALS request scope, service providers, gates & policies, active-record ORM (Prisma or Drizzle), one bootstrap file.
- 🪶 **Pay-as-you-go** — 46 first-party `@rudderjs/*` packages. Start with three, bolt on what you need. Swap adapters (Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3) without changing app code.
- 🛠️ **One CLI** — `pnpm rudder make:*`, `queue:*`, `mail:*`, `mcp:*`, `passport:*`, `db:*`, `storage:*`, plus your own commands. Scaffolders ship with their owning packages.
- 🔒 **TypeScript-first** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM + NodeNext, incremental builds, WinterCG-compatible runtime.

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

## Packages (46)

> Three foundation packages get you running. The rest are opt-in.

**Foundation** — [`core`](./packages/core) · [`router`](./packages/router) · [`server-hono`](./packages/server-hono) · [`middleware`](./packages/middleware) · [`console`](./packages/console) · [`cli`](./packages/cli) · [`support`](./packages/support) · [`contracts`](./packages/contracts)

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

RudderJS uses **independent versioning** — each `@rudderjs/*` package has its own version line, same model as Laravel's first-party packages, AdonisJS, and most of the npm ecosystem. A higher major reflects iteration history, not "more important."

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
