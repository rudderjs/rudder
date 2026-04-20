# Controller Views

Controller views give you Laravel's `return view('dashboard', $data)` pattern — routes return a view by id, the framework renders it through Vike's SSR pipeline, and the browser gets a fully-hydrated page with SPA navigation.

```ts
// routes/web.ts
Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { title: 'Dashboard', users })
})
```

The view file lives at `app/Views/Dashboard.tsx` and receives `{ title, users }` as typed props. Everything else — URL routing, SSR, hydration, SPA transitions — happens automatically.

::: tip Already in your scaffolded project
If you created your app with `create-rudder-app`, you've already got controller views. The landing page at `/` is `app/Views/Welcome.tsx`, and the auth pages (`/login`, `/register`, etc.) are under `app/Views/Auth/`. This guide explains how to add your own.
:::

---

## Why controller views?

Vike pages (covered in [Frontend Pages & SSR](/guide/frontend-pages)) route by filesystem — URL is the filename, data is co-located in `+data.ts`, guards live in `+guard.ts`. That's great for marketing sites and content-heavy apps.

Controller views flip the model: the **controller owns everything** — URL, middleware, data, and the view — in a single place. That shape matches web apps built around domain logic: the controller fetches data, runs authorization, decides what to render.

| | Vike pages | Controller views |
|---|---|---|
| Routing | Filesystem | Explicit (`Route.get('/dashboard', ...)`) |
| Middleware | `+guard.ts` | Router middleware chain |
| Data fetching | `+data.ts` | Controller — same place as the route |
| Mental model | Next/Nuxt-style | Laravel controller → view |

The two coexist. A single app can have `pages/marketing/+Page.tsx` (Vike) and `app/Views/Dashboard.tsx` (controller view) and SPA navigation between them is seamless.

---

## Your first view

### 1. Create the view file

```tsx
// app/Views/Reports.tsx
interface ReportsProps {
  title: string
  entries: { id: number; name: string; total: number }[]
}

export default function Reports({ title, entries }: ReportsProps) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <ul className="divide-y">
        {entries.map(e => (
          <li key={e.id} className="flex justify-between py-2">
            <span>{e.name}</span>
            <span>{e.total}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

This is a normal component in your primary framework (React / Vue / Solid) — use hooks, event handlers, icon libraries, anything Vike supports.

### 2. Register the route

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { Report } from '../app/Models/Report.js'

Route.get('/reports', async () => {
  const entries = await Report.orderBy('total', 'desc').limit(10).get()
  return view('reports', { title: 'Top Reports', entries })
})
```

Visit `/reports` — you get the SSR'd page, hydrated client-side, ready for SPA links.

That's the whole loop. No adapter layer, no JSON envelope, no per-page `+Page.tsx` / `+data.ts` / `+config.ts`. The framework generates those automatically from your view files at dev/build time.

---

## The id → URL convention

View ids map to URLs 1:1 by default:

| `view(...)` call | View file | URL served at |
|---|---|---|
| `view('reports')` | `app/Views/Reports.tsx` | `/reports` |
| `view('admin.users')` | `app/Views/Admin/Users.tsx` | `/admin/users` |
| `view('settings.profile')` | `app/Views/Settings/Profile.tsx` | `/settings/profile` |

PascalCase filenames become kebab-case ids. Directory nesting uses dots. **Your controller must use the matching URL** — `Route.get('/reports', ...)` for `view('reports')`.

### Overriding the URL

Some views need a URL that doesn't match the id — the home page lives at `/`, not `/welcome`, and the auth pages sit at `/login` instead of `/auth/login`. Export a `route` constant at the top of the view file:

```tsx
// app/Views/Welcome.tsx
export const route = '/'       // served at /, not /welcome

export default function Welcome() { /* ... */ }
```

```tsx
// app/Views/Auth/Login.tsx
export const route = '/login'  // served at /login, not /auth/login

export default function Login() { /* ... */ }
```

**This is required whenever the controller URL diverges from the id-derived path.** If you forget it, the page still works on direct navigation, but SPA nav falls back to full page reloads because Vike's client router doesn't know the URL belongs to your view. No error is thrown — just a silent perf regression. If you click a `<Link>` and see the browser do a full page reload, check for a missing `export const route`.

---

## Passing data

The second argument to `view()` is the props object. Whatever you pass is serialized for client hydration and passed to your view component:

```ts
Route.get('/dashboard', async () => {
  const user = await auth().user()
  const stats = {
    totalPosts:    await Post.count(),
    pendingJobs:   await Job.where('status', 'pending').count(),
    recentSignups: await User.orderBy('createdAt', 'desc').limit(5).get(),
  }

  return view('dashboard', { user, stats })
})
```

Because the controller runs server-side, you get full DI access — `auth()`, `resolve()`, the ORM, the cache, queue dispatches, whatever. Data hits the view as plain objects.

::: warning Serialization
Props must be serializable — plain objects, arrays, strings, numbers, booleans, dates. Functions, class instances with methods, and non-serializable objects don't survive the SSR → client boundary. Transform Model instances to plain objects before returning:

```ts
return view('reports', {
  entries: reports.map(r => ({ id: r.id, name: r.name, total: r.total }))
})
```
:::

---

## Middleware on view routes

Middleware runs **before** the view is rendered. If a middleware short-circuits — redirects, returns 401, throws — the view function never executes:

```ts
import { RequireAuth } from '@rudderjs/auth'

Route.get('/dashboard', async () => {
  return view('dashboard', { ...props })
}, [RequireAuth()])
```

If the route is on the `web` group (loaded via `withRouting({ web })`), `@rudderjs/session` and `@rudderjs/auth` already run automatically — so `req.user` is populated and `auth().user()` works inside your controller. You only need per-route middleware when you want explicit enforcement (`RequireAuth`) or a one-off policy check.

---

## Multi-framework support

`@rudderjs/view` auto-detects which Vike renderer you installed and emits matching stubs:

| Framework | Vike renderer | View extension |
|---|---|---|
| React | `vike-react` | `.tsx` / `.jsx` |
| Vue | `vike-vue` | `.vue` |
| Solid | `vike-solid` | `.tsx` / `.jsx` |
| Vanilla | *(none installed)* | `.ts` / `.js` |

Install exactly one renderer per project — Vike's own constraint. The scanner probes `node_modules/vike-*/package.json` at plugin construction time and picks the right stub automatically. No config needed.

### Vanilla HTML-string mode

Install no `vike-*` renderer and views become HTML-string functions — no hydration, zero client-side JavaScript. The Blade equivalent, perfect for admin reports, printable invoices, HTML email bodies, webhook responses, marketing landing pages.

```ts
// app/Views/Invoice.ts
import { html } from '@rudderjs/view'

interface InvoiceProps {
  number: string
  lines:  { description: string; amount: number }[]
}

export default function Invoice({ number, lines }: InvoiceProps) {
  return html`
    <div class="mx-auto max-w-2xl p-8">
      <h1 class="text-2xl">Invoice #${number}</h1>
      <table class="w-full border-collapse">
        ${lines.map(l => html`
          <tr>
            <td class="border p-2">${l.description}</td>
            <td class="border p-2 text-right">${l.amount.toFixed(2)}</td>
          </tr>
        `)}
      </table>
    </div>
  `
}
```

The `html\`\`` tagged template **auto-escapes every interpolation** — you can't accidentally ship an XSS hole by forgetting an escape. Nested `html\`\`` templates compose without re-escaping because they're `SafeString` instances. Plain template literals don't escape — use `html\`\`` in every vanilla view.

```ts
import { html, escapeHtml, SafeString } from '@rudderjs/view'

// Safe by default
html`<p>${user.name}</p>`

// Escape hatch for trusted markup (CMS output, rendered markdown)
const fromCms = new SafeString(cms.renderTrustedHtml())
html`<article>${fromCms}</article>`

// DON'T — raw template literal ships `<script>` as-is
const bad = `<p>${user.name}</p>`
```

Vanilla views still run the full controller pipeline — middleware, DI, ORM, validation, request context. You just get HTML instead of a hydrated React tree.

---

## Shared layouts

Drop a `+Layout.tsx` under `pages/__view/` and Vike wraps every controller view with it:

```tsx
// pages/__view/+Layout.tsx
import type { ReactNode } from 'react'
import { Nav } from '@/components/Nav'

export default function ViewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <Nav />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

Nested layouts scope to subdirectories — `pages/__view/admin/+Layout.tsx` wraps only views under `app/Views/Admin/**`. Vike composes layouts outward automatically.

The scanner only manages `+Page.tsx`, `+route.ts`, `+data.ts`, and `+config.ts` — anything else (layouts, custom guards, framework-specific config) is preserved when it regenerates.

---

## When to use views vs Vike pages directly

Use **controller views** when:

- The URL belongs to your app's logic, not the content (dashboards, admin panels, user-specific pages)
- You want middleware, data fetching, and rendering in the same function
- You're translating Laravel mental models to Node
- You need to pass context-heavy props that come from DI, auth, or complex services

Use **Vike pages directly** when:

- The URL *is* the identity of the page (marketing, documentation, static content)
- You want filesystem-based routing for a section of the site
- You're building an MDX-driven content area
- The page needs advanced Vike features (streaming, custom renderers, page transitions) with per-page config

They coexist freely. A site can have `pages/index/+Page.tsx` (Vike marketing home), `pages/blog/**` (file-based blog), and `app/Views/Dashboard.tsx` (controller-owned app), and SPA nav between them just works.

---

## Packages shipping views

If you're publishing a RudderJS package that ships UI, don't use `app/Views/` directly — that's the app's namespace. Instead:

```
packages/<name>/views/<framework>/<Name>.{tsx,vue}   # one view file per framework
packages/<name>/src/routes.ts                        # exports registerXRoutes(router, opts)
```

Consumers vendor the framework-matched views into their own `app/Views/`, then call `registerXRoutes(router)` to wire the controller routes. `@rudderjs/auth` is the reference implementation — it ships `views/react/` and `views/vue/`, and exposes `registerAuthRoutes()` that wires up `/login`, `/register`, `/forgot-password`, `/reset-password` against whichever views the app has vendored.

This is what `create-rudder-app`'s Auth option does during scaffolding — copies the right framework's auth views into `app/Views/Auth/` and calls `registerAuthRoutes(Route)` in `routes/web.ts`.

---

## Common pitfalls

- **SPA nav falls back to full reloads.** The controller URL doesn't match the id-derived URL. Add `export const route = '/...'` at the top of the view file.
- **"Multiple renderers installed" error at dev startup.** You installed two of `vike-react` / `vike-vue` / `vike-solid`. Pick one.
- **Parameterized URLs (`/users/:id`) don't work as controller views.** V1 limitation. Either keep those as regular Vike pages, or resolve the param in the controller and delegate to a non-parameterized view.
- **Props disappear on hydration.** Non-serializable values (functions, Model instances with methods, class references) don't survive the SSR boundary. Serialize to plain objects before returning.
- **XSS in vanilla mode.** Plain template literals ship interpolations unescaped. Always use the `html\`\`` tagged template; wrap known-trusted markup with `new SafeString(...)`.
- **Vendored views out of sync.** If you upgrade `@rudderjs/auth` and it ships updated views, re-run `pnpm rudder vendor:publish --tag=auth-views` to refresh your `app/Views/Auth/` copies. The package's `registerAuthRoutes()` expects the current view shapes.
- **Mixed vanilla + framework views in one project.** Not supported in v1 — pick one mode per project.

---

## Next Steps

- [Frontend Pages & SSR](/guide/frontend-pages) — when to reach for Vike pages directly
- [Routing](/guide/routing) — the router API that drives controller view URLs
- [Middleware](/guide/middleware) — web/api groups and middleware wiring
