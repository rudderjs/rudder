# Frontend

RudderJS uses [Vike](https://vike.dev) for SSR and page routing. You have two ways to render a page: a **controller view** that the route handler returns, or a **Vike page** that lives in `pages/` with file-based routing. They coexist freely in the same app.

## Controller views

Controller views let a route handler return a view by id with props. The framework renders it through Vike's SSR pipeline — the browser gets a fully-hydrated page with SPA navigation between view routes.

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

The view file lives at `app/Views/Dashboard.tsx` and receives `{ title, users }` as typed props.

```tsx
// app/Views/Dashboard.tsx
interface DashboardProps {
  title: string
  users: { id: string; name: string }[]
}

export default function Dashboard({ title, users }: DashboardProps) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1>{title}</h1>
      <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
    </div>
  )
}
```

That's the whole loop. Everything else — URL routing, SSR, hydration, SPA transitions — happens automatically.

### The id → URL convention

View ids map to URLs 1:1 by default. PascalCase filenames become kebab-case ids; nested directories use dots.

| `view(...)` call | View file | URL served at |
|---|---|---|
| `view('reports')` | `app/Views/Reports.tsx` | `/reports` |
| `view('admin.users')` | `app/Views/Admin/Users.tsx` | `/admin/users` |

When the controller URL diverges from the id-derived path, export a `route` constant at the top of the view file:

```tsx
// app/Views/Welcome.tsx
export const route = '/'           // served at /, not /welcome

export default function Welcome() { /* ... */ }
```

Forgetting `export const route` does not throw — the page still renders on direct navigation, but SPA links fall back to full reloads because Vike's client router doesn't know the URL belongs to your view. If a `<Link>` triggers a full page reload, check for a missing `export const route`.

### Multi-framework

The view scanner detects which Vike renderer you installed and emits matching stubs. Install exactly one of `vike-react`, `vike-vue`, or `vike-solid` per project — Vike's own constraint.

| Framework | Renderer | View extension |
|---|---|---|
| React | `vike-react` | `.tsx` |
| Vue | `vike-vue` | `.vue` |
| Solid | `vike-solid` | `.tsx` |
| Vanilla | *(none)* | `.ts` (HTML strings) |

Vanilla mode ships zero client-side JavaScript — the Blade equivalent. Use the `html\`\`` tagged template from `@rudderjs/view`, which auto-escapes every interpolation:

```ts
// app/Views/Invoice.ts
import { html } from '@rudderjs/view'

export default function Invoice({ number, lines }: InvoiceProps) {
  return html`
    <h1>Invoice #${number}</h1>
    <ul>${lines.map(l => html`<li>${l.name}: ${l.amount}</li>`)}</ul>
  `
}
```

Plain template literals do not escape — always use `html\`\`` in vanilla views. Wrap known-trusted markup with `new SafeString(...)` from `@rudderjs/view`.

### Shared layouts

Drop a `+Layout.tsx` under `pages/__view/` and Vike wraps every controller view with it. Nested layouts scope to subdirectories — `pages/__view/admin/+Layout.tsx` wraps only views under `app/Views/Admin/**`.

### Per-page response headers

`view()` takes an optional third argument for response headers — cache-control, CSP, anything else — without leaving the controller. Headers attach via `@rudderjs/vite`'s `+headersResponse` Vike hook (auto-installed in `pages/+headersResponse.ts` by the view scanner):

```ts
// Static headers
Route.get('/pricing', async () => {
  const plans = await Plan.all()
  return view('marketing.pricing', { plans }, {
    headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' },
  })
})

// Function form — for per-request values like CSP nonces
Route.get('/admin/dashboard', async () => {
  const nonce = useCspNonce()
  return view('admin.dashboard', await loadProps(), {
    headers: () => ({
      'content-security-policy': `script-src 'self' 'nonce-${nonce}'`,
    }),
  })
}, [AuthMiddleware()])
```

Reserved headers the framework owns and you can't override: `set-cookie`, `vary`, anything matching `x-rudderjs-*`. These are silently dropped to prevent collisions with the server-hono response pipeline.

### Reading framework state from views

`@rudderjs/vite` ships a page-context enhancer registry. Framework packages register from their provider's `boot()` so per-request state lands on `pageContext` without a `+data.ts`:

| Package | Adds to `pageContext` |
|---|---|
| `@rudderjs/auth` | `pageContext.user` — current authenticated user, or `null` for guests |
| `@rudderjs/session` | `pageContext.flash` — flash bag carried over from the previous request |
| `@rudderjs/localization` | `pageContext.locale` — resolved locale for the current request |

```tsx
// app/Views/Dashboard.tsx
import { usePageContext } from 'vike-react/usePageContext'

export default function Dashboard() {
  const { user, locale, flash } = usePageContext()  // typed via Vike.PageContext augmentation
  return (
    <div>
      <h1>Hello {user?.name ?? 'guest'}</h1>
      {flash.success && <Banner>{flash.success}</Banner>}
    </div>
  )
}
```

App code can register its own enhancers from a service provider:

```ts
import { registerPageContextEnhancer } from '@rudderjs/vite/page-context-enhancers'

registerPageContextEnhancer(async (pageContext) => {
  pageContext.tenant = await resolveTenantForRequest()
})
```

Enhancers run in registration order on every render — keep them fast.

The first sync also writes `pages/+onCreatePageContext.ts`, `pages/+onError.ts`, and `pages/+headersResponse.ts` re-export stubs. They're stock Vike hooks; you can overwrite any of them in place to customize, and the scanner won't replace your edits on subsequent runs.

## Vike pages

Vike pages route by filesystem — the URL is the directory name under `pages/`. Each page is a directory containing `+`-prefixed files.

| File | Purpose |
|---|---|
| `+Page.tsx` / `+Page.vue` | The page component |
| `+data.ts` | SSR data loader — runs server-side, result available via `useData()` |
| `+guard.ts` | Auth guard — runs before render |
| `+config.ts` | Per-page Vike config |

```tsx
// pages/index/+Page.tsx
export default function HomePage() {
  return <h1>Welcome to RudderJS</h1>
}
```

### Server data with `+data.ts`

```ts
// pages/users/+data.ts
import { resolve } from '@rudderjs/core'
import { UserService } from '../../app/Services/UserService.js'

export type Data = Awaited<ReturnType<typeof data>>

export async function data() {
  const userService = resolve<UserService>(UserService)
  return { users: await userService.findAll() }
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

`data()` runs only on the server with full DI access. Its return value is serialized for client hydration.

### Dynamic routes

Use `@id` in the directory name for dynamic segments. The parameter arrives in `pageContext.routeParams`:

```
pages/users/@id/+Page.tsx    → /users/123, /users/abc
pages/users/@id/+data.ts
```

### Renderer config

For single-framework apps, declare the renderer once in `pages/+config.ts`:

```ts
// pages/+config.ts
import vikeReact from 'vike-react/config'
export default { extends: [vikeReact] }
```

For multi-framework apps, leave the root `+config.ts` empty and add a `+config.ts` inside each subtree extending its own renderer.

## Controller views vs. Vike pages

The two render the same way; they differ in **who owns the URL**.

|  | Controller views | Vike pages |
|---|---|---|
| Routing | Explicit (`Route.get('/dashboard', ...)`) | Filesystem |
| Middleware | Router middleware chain | `+guard.ts` |
| Data fetching | In the route handler | `+data.ts` |
| Mental model | Controller fetches data and returns the view | Next/Nuxt-style |

Use **controller views** when the URL belongs to your app's logic — dashboards, admin panels, user-specific pages — and you want middleware, data fetching, and rendering in one place.

Use **Vike pages** when the URL *is* the identity of the page — marketing, documentation, MDX-driven content — or when you need advanced Vike features per-page.

A site can have `pages/index/+Page.tsx` (Vike marketing home), `pages/blog/**` (file-based blog), and `app/Views/Dashboard.tsx` (controller-owned app), and SPA nav between all three works.

## Pure API mode

Pages are optional. Omit the `pages/` directory and remove Vike from `vite.config.ts` — the RudderJS server and routing work fine without any frontend.

## Packages shipping views

Packages publishing UI must not write into `app/Views/` directly — that's the app's namespace. The convention is:

```
packages/<name>/views/<framework>/<Name>.{tsx,vue}
packages/<name>/src/routes.ts          # exports registerXRoutes(router, opts)
```

Consumers vendor the framework-matched views into their own `app/Views/`, then call `registerXRoutes(Route)` to wire the controller routes. `@rudderjs/auth` is the reference implementation.
