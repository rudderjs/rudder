# @rudderjs/view

Laravel-style controller-returned views for RudderJS, rendered through Vike's SSR pipeline.

```ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { User } from '@/app/Models/User.js'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { title: 'Dashboard', users })
})
```

The view file lives at `app/Views/Dashboard.tsx`, takes typed props, and is rendered server-side with full hydration. Client-side navigation to and from controller views is full SPA — no full page reloads, no Inertia adapter, no JSON envelope. Just Vike doing what it's already great at.

**Framework support:** React, Vue, Solid, and vanilla HTML-string mode are all supported. The scanner auto-detects which Vike renderer is installed (`vike-react`, `vike-vue`, `vike-solid`) and emits the matching stub — see [Framework support](#framework-support) below.

---

## Why use this instead of Vike pages directly?

| | Vike `pages/` | `@rudderjs/view` |
|---|---|---|
| **Routing** | Filesystem | Explicit, in `routes/api.ts` |
| **Middleware** | Per-page `+guard.ts` | Router middleware chain (auth, rate limit, CSRF) |
| **Data fetching** | `+data.ts` per page | Controller — same place as the route |
| **Mental model** | Next/Nuxt-style file routing | Laravel controller → view |
| **Customization per route** | Awkward (multiple files) | One controller function |

Use `@rudderjs/view` when you want **the controller to own the URL, the middleware, the data, and the view** — same shape as `return view('dashboard', $data)` in Laravel. Use Vike pages directly for marketing pages, static content, or anywhere the URL *is* the identity of the page.

The two coexist: a single app can have `pages/index/+Page.tsx` (Vike) and `app/Views/Dashboard.tsx` (controller) at the same time, and SPA navigation between them is seamless.

---

## Installation

This package is part of the RudderJS monorepo and is included by default in projects scaffolded with `create-rudder-app`. To add it manually:

```bash
pnpm add @rudderjs/view @rudderjs/vite vike
```

`@rudderjs/vite` provides the Vite plugin that scans `app/Views/**` and generates the virtual Vike pages. `@rudderjs/server-hono` provides the runtime detection of `ViewResponse` (no extra wiring needed — it's automatic).

---

## Usage

### 1. Create a view component

```tsx
// app/Views/Dashboard.tsx
import { Button } from '@/components/ui/button'

interface DashboardProps {
  title: string
  users: { id: number; name: string; email: string }[]
}

export default function Dashboard({ title, users }: DashboardProps) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="mb-4 text-3xl font-bold">{title}</h1>
      <ul className="divide-y rounded-md border">
        {users.map(u => (
          <li key={u.id} className="flex items-center justify-between p-3">
            <span>{u.name}</span>
            <span className="text-muted-foreground">{u.email}</span>
          </li>
        ))}
      </ul>
      <Button>Click me</Button>
    </div>
  )
}
```

This is a normal React/Vue/Solid component. You can:

- Import other components, hooks, icon libraries, anything Vike supports
- Use `useState`, `useEffect`, event handlers — full client interactivity after hydration
- Compose with shared layouts (see "Layouts" below)

### 2. Register a controller route

```ts
// routes/api.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { Auth, AuthMiddleware } from '@rudderjs/auth'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', {
    title: 'Dashboard',
    users: users.map(u => ({ id: u.id, name: u.name, email: u.email })),
  })
}, [AuthMiddleware()])
```

The middleware runs **before** the view is rendered — exactly like Laravel. If `AuthMiddleware()` redirects, the view never executes.

That's it. Visit `/dashboard` and you'll get the SSR'd page with the users list, hydrated client-side, ready for SPA navigation.

---

## How view ids map to files

| `view(...)` call | Looks for | URL it must be served at |
|---|---|---|
| `view('dashboard')` | `app/Views/Dashboard.tsx` | `/dashboard` |
| `view('admin.users')` | `app/Views/Admin/Users.tsx` | `/admin/users` |
| `view('settings.profile')` | `app/Views/Settings/Profile.tsx` | `/settings/profile` |

The id maps 1:1 to the URL path by convention. The Vite plugin scans `app/Views/**`, derives the id from the file path (PascalCase → kebab-case, dots for nested dirs), and generates the matching Vike route. **Your controller route must use the same URL** — `Route.get('/dashboard', ...)` for `view('dashboard')`. Mismatches cause SPA navigation to fall back to full reloads.

Parameterized URLs (`/users/:id`) are not supported as controller views in v1 — those should stay as regular Vike pages or use a different route that returns `view()` after resolving the param.

---

## Shared layouts

`@rudderjs/view` inherits Vike's filesystem-based layout composition. Drop a `+Layout.tsx` next to the generated stubs and Vike wraps every view with it:

```
playground/pages/__view/+Layout.tsx        ← wraps all controller views
```

```tsx
// playground/pages/__view/+Layout.tsx
import type { ReactNode } from 'react'
import { AdminSidebar } from '@/components/AdminSidebar'

export default function ViewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <AdminSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

The scanner only manages `+Page.tsx`, `+route.ts`, `+data.ts`, and `+config.ts` — any other file in `pages/__view/` (like `+Layout.tsx`) is preserved on regenerate.

For nested layouts (e.g. an admin shell that wraps `app/Views/Admin/**` only), put a `+Layout.tsx` in `pages/__view/admin/`. Vike composes the layouts outward automatically.

---

## Framework support

`@rudderjs/vite`'s view scanner auto-detects which Vike renderer is installed and emits the right stub per framework. One framework per project — this mirrors Vike's own single-renderer constraint.

| Framework | Vike renderer | View file extension | Stub generated |
|---|---|---|---|
| **React** | `vike-react` | `.tsx` / `.jsx` | `+Page.tsx` |
| **Vue** | `vike-vue` | `.vue` | `+Page.vue` |
| **Solid** | `vike-solid` | `.tsx` / `.jsx` | `+Page.tsx` |
| **Vanilla** | *(none)* | `.ts` / `.js` | `+Page.ts` |

The scanner detects the framework once at plugin construction time by probing `node_modules/vike-*/package.json`. Install exactly one of `vike-react`, `vike-vue`, `vike-solid` — installing more than one throws a clear error. Install none of them and the scanner falls into **vanilla mode**.

### Vanilla (HTML-string) mode

When no `vike-*` renderer is installed, view files export a function returning an HTML string — no hydration, zero client-side JavaScript. This is the Blade equivalent: perfect for admin reports, printable invoices, HTML email bodies, webhook responses, marketing landing pages, anything where React is overkill.

```ts
// app/Views/AdminReport.ts
import { html } from '@rudderjs/view'

interface AdminReportProps {
  title: string
  rows:  { name: string; total: number }[]
}

export default function AdminReport({ title, rows }: AdminReportProps) {
  return html`
    <div class="mx-auto max-w-4xl p-8">
      <h1 class="text-3xl font-bold">${title}</h1>
      <table class="w-full border-collapse">
        ${rows.map(r => html`
          <tr>
            <td class="border p-2">${r.name}</td>
            <td class="border p-2 text-right">${r.total}</td>
          </tr>
        `)}
      </table>
    </div>
  `
}
```

The `html\`\`` tag auto-escapes every interpolated value — `title`, `r.name`, and everything else — so you can't accidentally ship an XSS hole by forgetting an escape. Nested `html\`\`` blocks (like the inner `<tr>` template) pass through without being re-escaped because they're `SafeString` instances. Arrays of `SafeString` join automatically.

```ts
// routes/api.ts
Route.get('/admin/report', async () => {
  const rows = await Orders.groupBy('customer').select('name', sum('total'))
  return view('admin.report', { title: 'Monthly Report', rows })
})
```

**Why you should prefer `html\`\`` over raw template literals:** vanilla views do **not** auto-escape interpolations the way JSX does. A plain template literal will happily ship `<script>` straight into the page. The `html\`\`` tag fixes this by escaping every interpolation unless it's explicitly wrapped in a `SafeString` (which is what `html\`\`` itself returns, so nested templates compose naturally).

```ts
import { html, escapeHtml, SafeString } from '@rudderjs/view'

// Use html`` in 99% of cases — safe by default
html`<p>${user.name}</p>`

// escapeHtml() is available if you're building a raw string for some reason
const raw = `<p>${escapeHtml(user.name)}</p>`

// SafeString is the escape hatch for markup you *know* is safe (from a CMS,
// a markdown renderer you trust, etc). Use sparingly.
const fromCms = new SafeString(cms.renderTrustedHtml())
html`<article>${fromCms}</article>`

// ❌ Raw template literal with no escape — XSS if user.name is '<script>'
const bad = `<p>${user.name}</p>`
```

Vanilla views still benefit from the full controller pipeline — middleware, DI, ORM, validation, request context — all run before the view function is called. You just get HTML instead of a hydrated React tree.

Mixed-mode (vanilla `.ts` views alongside React `.tsx` views in a single project) is not supported in v1 — it requires per-page Vike config overrides that Vike doesn't expose cleanly yet. Tracked for a later phase.

---

## SPA navigation

Every link to a controller view triggers a small `pageContext.json` fetch (~400 bytes), not a full page reload. This works between any combination of:

- Vike page → Vike page (Vike's native SPA nav)
- Vike page → controller view
- Controller view → controller view
- Controller view → Vike page

No `<Link>` component needed — plain `<a href="/dashboard">` tags are intercepted by Vike's client router automatically. URL changes, content swaps, no white flash.

---

## How it works internally

The package is a thin coordination layer. The heavy lifting is done by `@rudderjs/vite` (which generates the virtual Vike pages) and `@rudderjs/server-hono` (which intercepts `ViewResponse` from controller handlers and resolves it via Vike's `renderPage()`).

1. **`view(id, props)`** returns a `ViewResponse` instance (a class with a static `__rudder_view__` marker).
2. **`@rudderjs/server-hono`** detects the marker via duck-typing (no hard import on this package) and calls `result.toResponse()` after the controller's middleware chain runs.
3. **`toResponse()`** builds the Vike URL from the id (`'home'` → `/home`), preserves the `.pageContext.json` suffix if the request came from SPA nav, and calls Vike's `renderPage()`.
4. **`renderPage()`** routes the URL to the matching Vike page (the auto-generated stub at `pages/__view/<id>/+Page.tsx`), which reads `pageContext.viewProps` and passes them to the user's view component.
5. **The HTML is streamed back** with the controller-supplied props serialized for client hydration.

For SPA navigation, a separate fetch handler in `@rudderjs/server-hono` recognizes Vike's `*.pageContext.json` URL pattern and rewrites it to the bare URL — but only for paths registered as controller routes, so Vike's own pages are unaffected.

---

## Comparison with Inertia

| | Inertia (Laravel + React/Vue) | `@rudderjs/view` |
|---|---|---|
| Adapter layer | Yes (`@inertiajs/react` + `inertia-laravel`) | No — uses Vike directly |
| JSON envelope | Yes — every response wrapped | No — Vike's native `pageContext.json` |
| Client router | Custom Inertia router | Vike's built-in router |
| Code splitting | Runtime registry lookup | Build-time per-page chunks (Vite) |
| Streaming SSR | No | Yes (Vike inherits) |
| Backend coupling | Any (PHP, Rails, Node) | RudderJS + Vike + Vite specifically |

The cost of Vike + Vite coupling buys: smaller payloads, no adapter overhead, build-time code splitting, streaming SSR, automatic prefetching. The pitch in one line: **Inertia's DX, Vike's performance, Laravel's ergonomics.**

---

## License

MIT
