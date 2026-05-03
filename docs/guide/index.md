# What is RudderJS?

RudderJS is a framework-agnostic Node.js full-stack framework built on [Vike](https://vike.dev) and [Vite](https://vitejs.dev). It gives you service providers, dependency injection, an expressive ORM, a CLI generator, queues, scheduling, auth, validation — everything a typical web application needs — in strict TypeScript, while staying modular and UI-agnostic.

## Philosophy

RudderJS favors expressive APIs, convention over configuration, and clear lifecycle hooks. The framework should fade into the background while your app's code stays readable.

Three principles shape every package:

**Modular.** Every feature lives in its own `@rudderjs/*` package. There is no monolithic install. Add `@rudderjs/queue` when you need queues, `@rudderjs/cache` when you need caching. Unused packages are not in your `node_modules`.

**UI-agnostic.** Vike handles SSR and page routing. Pair RudderJS with React, Vue, Solid, multiple at once, or no frontend at all. Pure API mode is first-class.

**Deploy anywhere.** RudderJS exposes a standard [WinterCG Fetch handler](https://wintercg.org/). The same `bootstrap/app.ts` runs on Node, Bun, Deno, and Cloudflare Workers without code changes.

## Why RudderJS?

Modern Node.js forces a tradeoff: **great DX in a framework-locked box** (Next.js), **freedom with weeks of wiring** (Express / Hono), or **structure without fullstack views** (NestJS / AdonisJS).

RudderJS refuses the tradeoff. It's batteries-included, modular, UI-agnostic, and fullstack-first — with AI and real-time as first-class primitives, not afterthoughts.

| | Next.js | NestJS | AdonisJS | RudderJS |
|---|---|---|---|---|
| **Philosophy** | Component-first | Angular-style DI | Full MVC port | Service-oriented, modular |
| **Build tool** | Webpack / Turbopack | Webpack / esbuild | Webpack (stencil) | **Vite** |
| **UI framework** | React only | API only | Edge templates / Inertia | React, Vue, Solid, or none |
| **SSR views from controllers** | N/A | ✗ | Inertia adapter | ✓ **native — no Inertia, no JSON envelope** |
| **DI container** | None | Class-based IoC | IoC | Service Providers + ALS request scope |
| **AI-native** | ✗ | ✗ | ✗ | ✓ 11 providers, agents, streaming, MCP |
| **Real-time collab** | ✗ | ✗ | ✗ | ✓ Yjs CRDT + WebSocket on same port |
| **Modularity** | All-in | All-in | Preset-based | **Pay-as-you-go** — 46 opt-in packages |

The shape: one DI container, one CLI, one mental model. Routes return `view()`. Models query the database. Jobs queue work. Agents call tools. The same TypeScript ergonomics from the HTTP edge to the database row.

## What ships in the box

RudderJS provides everything a typical web application needs:

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

RudderJS shipped its **first 1.0 wave on 2026-04-29** — 29 framework packages graduated from `0.x` to `1.0.0` simultaneously, signaling stable public APIs. Breaking changes from here on require explicit major bumps and migration notes.

## Versioning

RudderJS uses **independent versioning** — each `@rudderjs/*` package has its own version line. Same model as Laravel's first-party packages, AdonisJS, and most of the npm ecosystem.

What you'll see across the workspace:

- **`1.0.0`** — packages that graduated in the first wave (2026-04-29). Stable public API, breaking changes require a major bump.
- **Higher majors** (`auth@4.x`, `cashier-paddle@2.x`, `cli@4.x`, `horizon@4.x`, `mcp@4.x`, `pulse@5.x`, `queue@4.x`, `sanctum@6.x`, `telescope@10.x`) — packages that were already past 1.0 before the graduation, plus this release's necessary cascade-major-bumps. The number reflects iteration history, not "more important."

The version spread is informative, not asymmetric: a higher major means the package has been through more iteration cycles, not that it's more central. `core@1.0.0` and `telescope@10.0.0` are equally stable from this release forward.

## Where to next

- [Installation](/guide/installation) — scaffold your first project
- [Directory Structure](/guide/directory-structure) — get oriented
- [Request Lifecycle](/guide/lifecycle) — how a request flows through the framework
