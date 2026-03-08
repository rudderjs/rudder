# Coming from Next.js

If you've been building with Next.js, you'll find BoostKit's patterns immediately familiar — with a few key differences that give you more control.

## The Core Difference

Next.js is **React-first**. Every architectural decision — routing, data fetching, server components — is built around React. The backend is an afterthought bolted on as API Routes.

BoostKit is **backend-first**. The frontend (React, Vue, or Solid) is a rendering layer powered by [Vike](https://vike.dev). The backend has a real architecture: service providers, DI container, middleware pipeline, Artisan CLI.

::: tip What is Vike?
Vike is to Vite what Next.js is to React — file-based routing and SSR, but UI-agnostic. It works with React, Vue, Solid, or no framework at all.
:::

---

## Concept Mapping

| Next.js | BoostKit | Notes |
|---|---|---|
| `pages/` or `app/` | `pages/` | Same file-based routing idea |
| `page.tsx` | `+Page.tsx` | The `+` prefix is Vike's convention |
| `getServerSideProps` | `+data.ts` | SSR data loader, runs server-side only |
| `middleware.ts` | `+guard.ts` | Per-page auth/redirect guard |
| `app/api/route.ts` | `routes/api.ts` | Clean separation, not co-located with pages |
| `next.config.js` | `vite.config.ts` | Vite config |
| No DI | `ServiceProvider` + `resolve()` | Real dependency injection |
| No CLI | `pnpm artisan make:*` | Laravel-style generators |

---

## Routing

Both use file-based routing, but BoostKit uses the `+` prefix convention from Vike.

**Next.js**
```
app/
  users/
    page.tsx        → renders at /users
    loading.tsx     → loading UI
    layout.tsx      → layout wrapper
```

**BoostKit**
```
pages/
  users/
    +Page.tsx       → renders at /users
    +data.ts        → SSR data loader
    +guard.ts       → auth guard / redirect
    +config.ts      → page-level Vike config
```

---

## Data Fetching

**Next.js** — `getServerSideProps` or async Server Components:
```ts
// Next.js
export async function getServerSideProps() {
  const users = await db.user.findMany()
  return { props: { users } }
}
```

**BoostKit** — `+data.ts` runs server-side, result is passed to `+Page.tsx` via `useData()`:
```ts
// pages/users/+data.ts
import { resolve } from '@boostkit/core'
import { UserService } from '../../app/Services/UserService.js'

export type Data = { users: { id: string; name: string }[] }

export async function data(): Promise<Data> {
  const users = await resolve(UserService).findAll()
  return { users }
}
```

```tsx
// pages/users/+Page.tsx
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function UsersPage() {
  const { users } = useData<Data>()
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

---

## Auth Guards

**Next.js** — global `middleware.ts` at the root:
```ts
// middleware.ts (Next.js)
export function middleware(req: NextRequest) {
  if (!req.cookies.get('session')) {
    return NextResponse.redirect('/login')
  }
}
export const config = { matcher: ['/dashboard/:path*'] }
```

**BoostKit** — per-page `+guard.ts`, co-located with the page it protects:
```ts
// pages/dashboard/+guard.ts
import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'
import type { BetterAuthInstance } from '@boostkit/auth'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!import.meta.env.SSR) return
  const { app } = await import('@boostkit/core')
  const auth = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers ?? {}),
  })
  if (!session?.user) throw redirect('/login')
}
```

---

## API Routes

**Next.js** — co-located with pages:
```ts
// app/api/users/route.ts (Next.js)
export async function GET() {
  const users = await db.user.findMany()
  return Response.json({ users })
}
```

**BoostKit** — separate `routes/api.ts`, keeping backend and frontend cleanly separated:
```ts
// routes/api.ts
import { Route } from '@boostkit/router'
import { resolve } from '@boostkit/core'
import { UserService } from '../app/Services/UserService.js'

Route.get('/api/users', async (_req, res) => {
  const users = await resolve(UserService).findAll()
  return res.json({ users })
})
```

Or use decorator-based controllers:
```ts
// app/Controllers/UserController.ts
import { Controller, Get } from '@boostkit/router'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

@Controller('/api/users')
export class UserController {
  @Get('/')
  async index(_req: AppRequest, res: AppResponse) {
    return res.json({ users: [] })
  }
}
```

---

## What You Gain

Coming from Next.js, BoostKit gives you things that don't exist in the Next.js world:

**Real Dependency Injection**
```ts
// Swap your entire database layer by changing one line
this.app.singleton(UserRepository, () => new PrismaUserRepository())
// → this.app.singleton(UserRepository, () => new DrizzleUserRepository())
```

**Artisan CLI**
```bash
pnpm artisan make:controller UserController
pnpm artisan make:model Post
pnpm artisan make:job SendWelcomeEmail
pnpm artisan make:module Blog
```

**Laravel debug helpers**
```ts
import { dd, dump } from '@boostkit/core'

dump(user)     // pretty-prints to terminal, keeps server running
dd(req.body)   // pretty-prints then stops (you've missed this)
```

**True modularity** — don't need queues? Don't install `@boostkit/queue`. Don't need mail? Skip `@boostkit/mail`. Next.js ships everything whether you use it or not.

---

## What's Different

| | Next.js | BoostKit |
|---|---|---|
| UI framework | React only | React, Vue, Solid, or none |
| Backend DX | API Routes (simple) | Service Providers + DI + Artisan |
| Build tool | Webpack / Turbopack | **Vite** (fast) |
| Modularity | All-in | Pay-as-you-go |
| Auth | NextAuth / Clerk | better-auth (built-in) |
| CLI | None | Artisan (`make:*`, `db:seed`, custom commands) |
| Deployment | Vercel-optimized | Node.js, Bun, Deno, Cloudflare Workers |

---

## Getting Started

```bash
pnpm create boostkit-app my-app
cd my-app
pnpm install
pnpm exec prisma generate
pnpm exec prisma db push
pnpm dev
```

The interactive installer walks you through choosing your database, frontend framework, Tailwind, and auth pages — then scaffolds a working full-stack app in under 2 minutes.
