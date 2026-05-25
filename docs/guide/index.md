# What is Rudder?

Rudder is a framework-agnostic Node.js full-stack framework built on [Vike](https://vike.dev) and [Vite](https://vitejs.dev). It gives you service providers, dependency injection, an expressive ORM, a CLI generator, queues, scheduling, auth, validation — everything a typical web application needs — in strict TypeScript, while staying modular and UI-agnostic.

Here's the whole loop — a route loads data with the ORM and returns a view, rendered through Vike with SSR and SPA navigation:

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { Post } from '../app/Models/Post.js'

Route.get('/posts', async () => {
  const posts = await Post.all()
  return view('posts', { posts: posts.map(p => p.toJSON()) })
})
```

That's it — no Inertia adapter, no JSON envelope, no separate API layer to wire up. Build it end-to-end in the [tutorial](/guide/tutorial), or read on for why the framework is shaped this way.

## Philosophy

Rudder favors expressive APIs, convention over configuration, and clear lifecycle hooks. The framework should fade into the background while your app's code stays readable.

Three principles shape every package:

**Modular.** Every feature lives in its own `@rudderjs/*` package. There is no monolithic install. Add `@rudderjs/queue` when you need queues, `@rudderjs/cache` when you need caching. Unused packages are not in your `node_modules`.

**UI-agnostic.** Vike handles SSR and page routing. Pair Rudder with React, Vue, Solid, multiple at once, or no frontend at all. Pure API mode is first-class.

**Deploy anywhere.** Rudder exposes a standard [WinterCG Fetch handler](https://wintercg.org/). The same `bootstrap/app.ts` runs on Node, Bun, Deno, and Cloudflare Workers without code changes.

## Why Rudder?

Modern Node.js forces a tradeoff: **great DX in a framework-locked box** (Next.js), **freedom with weeks of wiring** (Express / Hono), or **structure without fullstack views** (NestJS / AdonisJS).

Rudder refuses the tradeoff. It's batteries-included, modular, UI-agnostic, and fullstack-first — with AI and real-time as first-class primitives, not afterthoughts.

| | Next.js | NestJS | AdonisJS | Rudder |
|---|---|---|---|---|
| **Philosophy** | Component-first | Angular-style DI | Full MVC port | Service-oriented, modular |
| **Build tool** | Webpack / Turbopack | Webpack / esbuild | Webpack (stencil) | **Vite** |
| **UI framework** | React only | API only | Edge templates / Inertia | React, Vue, Solid, or none |
| **SSR views from controllers** | N/A | ✗ | Inertia adapter | ✓ **native — no Inertia, no JSON envelope** |
| **DI container** | None | Class-based IoC | IoC | Service Providers + ALS request scope |
| **AI-native** | ✗ | ✗ | ✗ | ✓ 15 providers, agents, streaming, MCP |
| **Real-time collab** | ✗ | ✗ | ✗ | ✓ Yjs CRDT + WebSocket on same port |
| **Modularity** | All-in | All-in | Preset-based | **Pay-as-you-go** — 47 opt-in packages |

The shape: one DI container, one CLI, one mental model. Routes return `view()`. Models query the database. Jobs queue work. Agents call tools. The same TypeScript ergonomics from the HTTP edge to the database row.

## What ships in the box

Rudder provides everything a typical web application needs:

- **HTTP server** with routing, middleware groups, validation, and form requests
- **DI container** with constructor injection, service providers, and auto-discovery
- **ORM** with Prisma or Drizzle adapters and an Eloquent-style query API
- **Auth** with guards, gates, policies, password reset, and email verification
- **Sessions** backed by HMAC-signed cookies or Redis
- **Queues** with BullMQ or Inngest, plus a built-in scheduler
- **Cache** and **storage** with pluggable drivers (Redis, S3, R2, MinIO)
- **Mail** and **notifications** with multi-channel delivery
- **AI agents** and **MCP servers** as first-class primitives
- **Real-time** broadcasting and Y.js-based collaborative sync
- **Telescope** — request-by-request observability with timeline, query, and event collectors

Optional packages — `@rudderjs/passport`, `@rudderjs/sanctum`, `@rudderjs/socialite`, `@rudderjs/boost`, `@rudderjs/telescope` — opt in per project.

## Status

Rudder is **fully on 1.0+** as of 2026-05-02. The first wave (2026-04-29) graduated 29 packages simultaneously; three follow-up waves over the next four days finished the rest. Every published `@rudderjs/*` package has a stable public API — breaking changes from here on require explicit major bumps and migration notes.

## Versioning

Rudder uses **independent versioning** — each `@rudderjs/*` package has its own version line, the same model Laravel's first-party packages, AdonisJS, and most of the npm ecosystem use.

What you'll see across the workspace:

- **`1.0.x`** — packages that graduated in one of the four waves. Stable public API, breaking changes require a major bump.
- **Higher majors** (`auth@5.x`, `cashier-paddle@3.x`, `cli@4.x`, `horizon@6.x`, `mcp@5.x`, `pulse@6.x`, `queue@4.x`, `sanctum@7.x`, `telescope@13.x`) — packages that were already past 1.0 before the graduation, plus the cascade-major-bumps from each wave. The number reflects iteration history, not "more important."

`core@1.x` and `telescope@13.x` are equally stable; the spread is informative, not asymmetric.

## Where to next

- [Installation](/guide/installation) — scaffold your first project
- [Directory Structure](/guide/directory-structure) — get oriented
- [Request Lifecycle](/guide/lifecycle) — how a request flows through the framework
