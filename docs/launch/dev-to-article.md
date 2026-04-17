# Introducing RudderJS — a fullstack TypeScript framework for Node.js with structure, speed, and AI built in

*cover_image: https://raw.githubusercontent.com/rudderjs/rudder/main/logo.png*
*tags: typescript, nodejs, javascript, webdev*
*canonical_url: https://github.com/rudderjs/rudder*
*published: false*

---

## The state of fullstack Node.js

If you've built a non-trivial Node.js app in the last few years, this probably sounds familiar:

- **Next.js** gives you great DX, but locks you into React and a black-box architecture. Try swapping React for something else, try owning your routing, try running background jobs cleanly — you can't.
- **Express / Hono** gives you total freedom, but you spend three weeks wiring up auth, validation, ORM integration, DI, queues, scheduling, and a CLI before you ship your first feature.
- **NestJS** gives you structure, but it's API-first. No fullstack views. And the Angular-style module system is a specific taste.
- **AdonisJS** gets closest in philosophy, but is still API-first for its SSR story (Edge templates or Inertia) and doesn't move with where the web has gone in the last 18 months.

There's a gap in the middle: a framework that gives you **structure, speed, AND fullstack SSR views — without forcing a specific UI library, without an adapter layer, and without locking you into one deployment target.**

That's what [**RudderJS**](https://github.com/rudderjs/rudder) is.

## What RudderJS actually is

RudderJS is a batteries-included, modular TypeScript framework for Node.js. 45 first-party `@rudderjs/*` packages, all opt-in, all MIT. You pick what you need:

- **Controller-returned SSR views** through [Vike](https://vike.dev) + [Vite](https://vitejs.dev) with real SPA navigation. No Inertia adapter. No JSON envelope. Just typed props passing from your route handler to a React / Vue / Solid component — and ~400 bytes per navigation.
- **AI-native from day one** — 9 providers (Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, Azure), agents with tools, streaming, conversations, MCP server support, queue integration.
- **Real-time on one port** — WebSocket channels (`@rudderjs/broadcast`) and Yjs CRDT collab (`@rudderjs/live`) share the same HTTP server. No separate process, no reverse proxy.
- **Service-oriented architecture** — DI container, service providers, gates & policies, an active-record ORM (Prisma or Drizzle), scheduling, queues, notifications, built-in inspector — all wired through one bootstrap file and one `rudder` CLI.
- **Pay-as-you-go** — start with 3 packages (core, router, server-hono), bolt on what you need. Swap adapters (Prisma ↔ Drizzle, BullMQ ↔ Inngest, local ↔ S3).
- **TypeScript-first, strict by default** — `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM + NodeNext everywhere.

## The "aha" — controller-returned SSR views

Most fullstack Node frameworks have you pick between:

- **File-based routes with colocated data** (Next.js) — magical, but you lose control of the request lifecycle.
- **Controllers + separate templates** (NestJS API + something else) — loses fullstack SSR ergonomics.
- **Inertia** — elegant in Laravel/Rails, but you pay for it: a ~30kb client runtime, a page-object JSON protocol on every navigation, and an adapter layer between controller and renderer. With Laravel SSR you also run a *second* Node process and pay an intra-server HTTP hop per request (PHP → Node SSR → PHP → browser). Two processes to deploy and monitor, extra latency on every page.

RudderJS just... lets your controller return a view.

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { User } from '../app/Models/User.js'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { title: 'Dashboard', users })
})
```

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

That's it. Middleware runs before the view renders — same chain as your JSON routes. Navigation between views is full SPA — no full page reloads, ~400 bytes per nav. And because it's just a Vike page under the hood, you get Vite's HMR, code splitting, streaming SSR, and everything else Vike does for free.

Same file can return JSON *and* views. Same middleware chain. Same router.

```ts
// JSON API
Route.get('/api/users', async (_req, res) => {
  return res.json({ data: await User.all() })
})

// SSR view
Route.get('/dashboard', async () => {
  return view('dashboard', { users: await User.all() })
})
```

No adapter. No envelope. No second process.

## Why it matters that the container is process-scoped

If you're migrating from a per-request framework (Laravel, Rails, Django), here's the single technical insight that will save you from 80% of future bugs:

**Node.js runs one process. One container. Many requests.** Unlike PHP-FPM recycling the container per request, every singleton you register in RudderJS's DI container is shared across every request the process ever handles. This means caching per-user state on a process-scoped service leaks that state to the next request.

The pattern: anything request-scoped goes in `AsyncLocalStorage`, accessed via the `runWithX()` / `currentX()` convention.

```ts
// Middleware establishes the scope once per request
app.withMiddleware((m) => {
  m.use(async (req, next) => {
    const manager = app().make<AuthManager>('auth.manager')
    await runWithAuth(manager, next)  // AsyncLocalStorage.run
  })
})

// Anywhere downstream reads from the current scope
const user = await currentAuth().user()
```

If you call `currentAuth()` outside a `runWithAuth()` scope, it throws a clear error. Silent ghosts are impossible.

We wrote [a one-page mental model guide](https://github.com/rudderjs/rudder/blob/main/docs/guide/mental-model.md) covering this with concrete wrong/right examples. It's the doc I wish I'd had six months ago.

## 60-second scaffold

```bash
pnpm create rudder-app my-app
cd my-app
pnpm exec prisma generate && pnpm exec prisma db push
pnpm dev
```

That's it. Open `http://localhost:3000` and you get:

- A welcome page (Laravel-level styling out of the box with Tailwind + shadcn/ui)
- Working register, login, logout, password reset flow
- Session-based auth with cookie sessions and rate limiting
- Prisma + SQLite wired, `User` model generated, schema migrated
- Bootstrap file you can read in 30 seconds

Tick the **AI** package during the interactive install, and you get a chat demo at `/ai-chat`. Tick **Passport**, and you get a full OAuth 2 server at `/oauth/authorize` / `/oauth/token`. Tick **WebSocket**, and you get real-time channels. Everything is opt-in.

## What's honest about where we are

RudderJS is in early development — there will be breaking changes before v1.0. The team ships fast. 45 packages is a lot of surface area, and we're still polishing rough edges in some (especially AI middleware, queue-inngest, localization). The scaffolder just had two embarrassing bugs caught and patched in the first week of public testing — that's life in early OSS.

What we're confident about:

- The **core is stable and tested** — router, DI, service providers, ORM, auth, session, cache, middleware — all battle-tested in playgrounds and real apps.
- The **architectural decisions are right** — controller-returned views, ALS request scoping, Vike as the SSR engine, process-scoped container, peer-dep patterns. These are the foundations and they're not moving.
- The **team is committed** — this isn't a weekend project or a thought experiment. Daily commits, active playgrounds, open design discussions.

## Try it, break it, tell us

```bash
pnpm create rudder-app my-app
```

If you come from Laravel, the mental model guide is your first stop. If you come from Next.js, try [the controller + view example](https://github.com/rudderjs/rudder#2-routes) — it's the shortest path to feeling the difference. If you come from NestJS, you'll recognize the DI container immediately; the rest is the fullstack layer NestJS never shipped.

- **Repo**: [github.com/rudderjs/rudder](https://github.com/rudderjs/rudder) — star it if you like what you see
- **Scaffolder**: [npmjs.com/package/create-rudder-app](https://www.npmjs.com/package/create-rudder-app)
- **Discussions**: [github.com/rudderjs/rudder/discussions](https://github.com/rudderjs/rudder/discussions) — questions, feature ideas, "does anyone else want X" threads
- **Mental model doc**: [docs/guide/mental-model.md](https://github.com/rudderjs/rudder/blob/main/docs/guide/mental-model.md)

We're looking for contributors, package maintainers, adapter authors, and — most importantly — people who'll kick the tires and file the issues that make v1.0 solid.

Come build with us.
