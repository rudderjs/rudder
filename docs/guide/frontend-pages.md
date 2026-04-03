# Frontend Pages & SSR

RudderJS uses [Vike](https://vike.dev) for file-based routing and SSR. Pages live in the `pages/` directory alongside your API routes and backend code — the frontend and backend share the same project, same DI container, and same service layer.

::: tip What is Vike?
Vike is to Vite what Next.js is to React — file-based routing and SSR, but UI-agnostic. It works with React, Vue, Solid, or no framework at all.
:::

---

## File Conventions

Each page is a directory under `pages/` containing one or more `+` prefixed files:

| File | Purpose |
|------|---------|
| `+Page.tsx` / `+Page.vue` | The page component — what the user sees |
| `+data.ts` | SSR data loader — runs on the server, result passed to the page |
| `+guard.ts` | Auth guard — runs before render, can redirect or abort |
| `+config.ts` | Per-page Vike config — sets the UI framework |

---

## Root Config

`pages/+config.ts` is the root Vike config for the entire app. It wires `vike-photon` to your RudderJS server and — for single-framework apps — declares the UI renderer here too:

```ts
// pages/+config.ts — single framework (React)
import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'
import vikeReact from 'vike-react/config'

export default {
  extends: [vikePhoton, vikeReact],
  photon: {
    server: 'bootstrap/app.ts',
  },
} as unknown as Config
```

With the renderer in the root config, no per-page `+config.ts` files are needed — all pages inherit React automatically.

For **Vue** replace `vike-react/config` with `vike-vue/config`. For **Solid** use `vike-solid/config`.

---

## Per-Page Config (multi-framework only)

When mixing multiple UI frameworks, keep the renderer **out** of the root `pages/+config.ts` and instead add a `+config.ts` inside each page folder or subtree:

```ts
// pages/index/+config.ts (React subtree)
import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default { extends: vikeReact } as unknown as Config
```

```ts
// pages/vue-demo/+config.ts
import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default { extends: vikeVue } as unknown as Config
```

```ts
// pages/solid-demo/+config.ts
import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default { extends: vikeSolid } as unknown as Config
```

A `+config.ts` in a parent directory applies to the entire subtree — you do not need one in every single page directory.

---

## Page Components

`+Page.tsx` (React / Solid) or `+Page.vue` (Vue) is the component rendered for the route:

```tsx
// pages/index/+Page.tsx
export default function HomePage() {
  return (
    <main>
      <h1>Welcome to RudderJS</h1>
      <p>Your full-stack app is running.</p>
    </main>
  )
}
```

```vue
<!-- pages/index/+Page.vue -->
<template>
  <main>
    <h1>Welcome to RudderJS</h1>
    <p>Your full-stack app is running.</p>
  </main>
</template>
```

---

## SSR Data Loading — `+data.ts`

`+data.ts` exports an async `data()` function that runs **server-side only**. Its return value is serialised and passed to the page component via `useData()`.

```ts
// pages/users/+data.ts
import { resolve } from '@rudderjs/core'
import { UserService } from '../../app/Services/UserService.js'

// Export the type so +Page.tsx can import it
export type Data = Awaited<ReturnType<typeof data>>

export async function data() {
  // resolve() pulls from the DI container — same singletons as your API routes
  const userService = resolve<UserService>(UserService)

  return {
    users: await userService.findAll(),
  }
}
```

Access the data in your page component using the framework-specific `useData()` hook:

```tsx
// pages/users/+Page.tsx
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function UsersPage() {
  const { users } = useData<Data>()

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name} — {user.email}</li>
      ))}
    </ul>
  )
}
```

```vue
<!-- pages/users/+Page.vue -->
<script setup lang="ts">
import { useData } from 'vike-vue/useData'
import type { Data } from './+data.js'

const { users } = useData<Data>()
</script>

<template>
  <ul>
    <li v-for="user in users" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

::: info
`data()` runs only on the server — never in the browser. It has full access to the DI container, ORM models, and any service registered in a provider.
:::

---

## Auth Guards — `+guard.ts`

`+guard.ts` runs **before the page renders**. Use it to protect pages with authentication or redirect users based on conditions.

```ts
// pages/dashboard/+guard.ts
import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'
import type { BetterAuthInstance } from '@rudderjs/auth'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  // Guards run on both server and client — skip the check client-side
  if (!import.meta.env.SSR) return

  const { app } = await import('@rudderjs/core')
  const auth = app().make<BetterAuthInstance>('auth')

  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers ?? {}),
  })

  if (!session?.user) throw redirect('/login')
}
```

### Guard options

```ts
import { redirect, render } from 'vike/abort'

// Redirect the user
throw redirect('/login')

// Render the error page with a custom status code and message
throw render(401, 'You must be logged in.')
throw render(403, 'You do not have permission to view this page.')
throw render(404)
```

::: tip
Use `+guard.ts` for per-page protection. For protecting a group of pages, place a `+guard.ts` in a parent directory — Vike applies it to all pages in that subtree.
:::

---

## File-Based Routing

Vike derives the URL from the directory name under `pages/`:

| Directory | URL |
|-----------|-----|
| `pages/index/` | `/` |
| `pages/users/` | `/users` |
| `pages/blog/post/` | `/blog/post` |
| `pages/_error/` | Error pages (no URL) |

### Dynamic Routes

Use `@id` in the directory name for dynamic segments:

```
pages/
  users/
    @id/
      +Page.tsx    → /users/123, /users/abc
      +data.ts
```

Access the parameter in `+data.ts`:

```ts
// pages/users/@id/+data.ts
import { resolve } from '@rudderjs/core'
import { UserService } from '../../../app/Services/UserService.js'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: { routeParams: { id: string } }) {
  const userService = resolve<UserService>(UserService)
  const user = await userService.find(pageContext.routeParams.id)
  return { user }
}
```

---

## Error Page

`pages/_error/+Page.tsx` renders for 404, 401, 403, 500, and any other error:

```tsx
// pages/_error/+Page.tsx
import { usePageContext } from 'vike-react/usePageContext'

export default function ErrorPage() {
  const pageContext = usePageContext()
  const { abortStatusCode, abortReason } = pageContext

  if (abortStatusCode === 404) {
    return <h1>Page not found</h1>
  }

  if (abortStatusCode === 401) {
    return <h1>{String(abortReason ?? 'Unauthorized')}</h1>
  }

  return <h1>Something went wrong</h1>
}
```

---

## Multiple UI Frameworks

When you select multiple frameworks in `create-rudderjs-app`, the root `pages/+config.ts` has no renderer. Each page folder declares its own:

```
pages/
  +config.ts       ← vike-photon only (no renderer)
  index/
    +config.ts     ← extends vikeReact (primary)
    +Page.tsx
  vue-demo/
    +config.ts     ← extends vikeVue
    +Page.vue
  solid-demo/
    +config.ts     ← extends vikeSolid
    +Page.tsx
```

When React and Solid coexist, the Vite config uses `include`/`exclude` to route `.tsx` files to the correct plugin:

```ts
// vite.config.ts
plugins: [
  rudderjs(),
  react({ exclude: ['**/pages/solid-demo/**'] }),
  solid({ include: ['**/pages/solid-demo/**'] }),
]
```

---

## Pure API Mode

Pages are optional. If you only need a backend API, omit the `pages/` directory entirely and remove Vike from your `vite.config.ts`. The RudderJS server and routing work fine without any frontend.

---

## Summary

| File | When to create |
|------|---------------|
| `pages/+config.ts` | Always — include renderer here for single-framework apps |
| `pages/mypage/+config.ts` | Multi-framework only — sets renderer per page/subtree |
| `pages/mypage/+Page.tsx` | The page component |
| `pages/mypage/+data.ts` | When the page needs server-fetched data |
| `pages/mypage/+guard.ts` | When the page requires authentication or conditional access |
