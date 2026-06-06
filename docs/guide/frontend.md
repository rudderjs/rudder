# Frontend

Rudder uses [Vike](https://vike.dev) for SSR and page routing. You have two ways to render a page: a **controller view** that the route handler returns, or a **Vike page** that lives in `pages/` with file-based routing. They coexist freely in the same app.

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

::: tip Compile-time prop checks
Export the view's `Props` interface — `view('dashboard', ...)` then type-checks the props you pass against the receiving component. See [Typed Views](/guide/typed-views).
:::

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

::: warning Enhancers require `app/Views/`
Enhancers run through the `pages/+onCreatePageContext.ts` hook, which the view scanner emits only when `app/Views/` contains at least one view. In an app that uses Vike pages directly with no controller views, registered enhancers (including the framework's `pageContext.user` / `flash` / `locale`) never run.
:::

The first sync also writes `pages/+onCreatePageContext.ts`, `pages/+onError.ts`, and `pages/+headersResponse.ts` re-export stubs. They're stock Vike hooks; you can overwrite any of them in place to customize, and the scanner won't replace your edits on subsequent runs.

## Client-safe imports

View files — and anything reachable from them — are bundled for the **browser**, so they must not pull in server-only framework code. Prefer the [page-context enhancers](#reading-framework-state-from-views) above for per-request state. When you do need framework helpers in client-reachable code, import them from the **client-safe entry points**:

- **`@rudderjs/core/client`** — `app`, `resolve`, `Env`, `env`, `config`, `Container` + the DI decorators, validation (`z`, `FormRequest`, `ValidationError`), exceptions, and contracts types. Import these from `@rudderjs/core/client`, **not** the main `@rudderjs/core` entry: the main entry re-exports the `rudder` CLI surface (which statically imports `node:*`) and crashes the browser bundle.
- **`@rudderjs/middleware/client`** — browser-safe middleware helpers such as `getCsrfToken()`.

```ts
// A component shared by the server render and client hydration
import { Env, config } from '@rudderjs/core/client'   // ✅ client-safe
// import { Env, config } from '@rudderjs/core'        // ❌ pulls the CLI / node: chain → crashes in the browser
```

The server keeps importing everything from the main entries (`@rudderjs/core`, providers, `defaultProviders`, the `rudder` CLI) — only code that lands in the client bundle needs the `/client` variants. ORM `Model` classes are themselves client-safe to *import* (the class definition evaluates in the browser); just don't run queries client-side.

Get this wrong and the symptom is a browser-side `ReferenceError: process is not defined` (or `Module "node:…" has been externalized for browser compatibility`) — and in a Vike app the client router never attaches, so navigation silently falls back to full page reloads.

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
  return <h1>Welcome to Rudder</h1>
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

## Hot reload in dev

Rudder runs two reload tracks in `pnpm dev`:

- **Frontend** — `app/Views/**`, `pages/**`, and any client component go through Vike + Vite's native HMR. The component swaps in place in ~50ms with no page reload and browser state preserved.
- **Backend** — a change under `routes/`, `bootstrap/`, or `app/` (except `app/Views/`) re-bootstraps the app (every provider's `boot()` re-runs) and triggers a full browser reload. `@rudderjs/vite` invalidates only the edited file's import subtree — not the whole module graph — so the framework stays warm and the reload is fast.

### Watching a linked package

A package consumed from source that registers routes, views, or config in a service provider's `boot()` (e.g. a workspace/linked package in a monorepo) isn't under `app/`, so edits to it wouldn't trigger a reload. Opt it in:

```ts
// vite.config.ts
import rudderjs from '@rudderjs/vite'

export default defineConfig({
  plugins: [
    rudderjs({ watch: ['@your-scope/your-package'] }), // package name(s) or absolute dir(s)
    // ...
  ],
})
```

Editing the watched package's source then re-bootstraps the app like an `app/` edit, no restart. Package-name entries are also pulled into the SSR module graph in dev (`ssr.noExternal`) so Vite re-evaluates them on change. A package with native dependencies that can't be transformed by Vite's SSR pipeline can't be watched this way — pass an absolute source directory instead and keep it externalized.

### Diagnosing reload time

Two env flags print timing to the dev log (zero overhead when unset):

- `RUDDER_HMR_TRACE=1` — segments each reload (`watcher→reimport`, `reboot→ready`, invalidation).
- `RUDDER_PERF_TRACE=2` — per-provider `boot()` timing (level `2` adds the per-provider lines to the level-`1` boot summary).

```bash
RUDDER_HMR_TRACE=1 RUDDER_PERF_TRACE=2 pnpm dev
```

## Pure API mode

Pages are optional. Omit the `pages/` directory and remove Vike from `vite.config.ts` — the Rudder server and routing work fine without any frontend.

## Packages shipping views

Packages publishing UI must not write into `app/Views/` directly — that's the app's namespace. The convention is:

```
packages/<name>/views/<framework>/<Name>.{tsx,vue}
packages/<name>/src/routes.ts          # exports registerXRoutes(router, opts)
```

Consumers vendor the framework-matched views into their own `app/Views/`, then call `registerXRoutes(Route)` to wire the controller routes. `@rudderjs/auth` is the reference implementation.
