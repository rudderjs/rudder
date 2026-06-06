# @rudderjs/view

## Overview

Laravel-style controller-returned views for RudderJS. Controllers return `view('id', props)` and the page is rendered through Vike's SSR pipeline — no Inertia adapter, no JSON envelope. The scanner in `@rudderjs/vite` discovers view files in `app/Views/**`, generates matching Vike pages under `pages/__view/`, and auto-detects the installed renderer (`vike-react`, `vike-vue`, `vike-solid`, or vanilla HTML-string mode).

## Key Patterns

### Controller → view flow

```tsx
// app/Views/Dashboard.tsx
interface DashboardProps { title: string; users: User[] }

export default function Dashboard({ title, users }: DashboardProps) {
  return (
    <div>
      <h1>{title}</h1>
      <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
    </div>
  )
}
```

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { AuthMiddleware } from '@rudderjs/auth'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { title: 'Dashboard', users })
}, [AuthMiddleware()])
```

Middleware runs before the view is rendered. If the middleware short-circuits (redirect / 401), the view function never executes.

### id → URL mapping

The view id maps 1:1 to the URL path by default:

| `view(...)` call       | View file                       | URL served at        |
|------------------------|---------------------------------|----------------------|
| `view('dashboard')`    | `app/Views/Dashboard.tsx`       | `/dashboard`         |
| `view('admin.users')`  | `app/Views/Admin/Users.tsx`     | `/admin/users`       |
| `view('settings.profile')` | `app/Views/Settings/Profile.tsx` | `/settings/profile` |

**Override** when the controller URL diverges from the id-derived path:

```tsx
// app/Views/Welcome.tsx
export const route = '/'            // served at /, not /welcome

export default function Welcome() { /* ... */ }
```

Without the `route` export, SPA nav falls back to full reloads because Vike's client route table doesn't match the browser URL.

### Vanilla HTML-string mode (no JS framework installed)

When no `vike-*` renderer is installed, view files return HTML strings. Use the `html\`\`` tagged template — it auto-escapes interpolations (XSS-safe by default) and composes nested templates without re-escaping:

```ts
// app/Views/AdminReport.ts
import { html } from '@rudderjs/view'

export default function AdminReport({ title, rows }) {
  return html`
    <div>
      <h1>${title}</h1>
      <table>
        ${rows.map(r => html`
          <tr><td>${r.name}</td><td>${r.total}</td></tr>
        `)}
      </table>
    </div>
  `
}
```

`html\`\`` returns a `SafeString`. Raw template literals (`` `<p>${user.name}</p>` ``) do **not** auto-escape — always use the `html\`\`` tag, or wrap with `escapeHtml()` / `new SafeString(trusted)` as needed.

### Shared layouts

Drop a `+Layout.tsx` anywhere under `pages/__view/` and Vike wraps the matching views with it:

```
pages/__view/+Layout.tsx              ← wraps all controller views
pages/__view/admin/+Layout.tsx        ← wraps only app/Views/Admin/**
```

The scanner only manages `+Page.*`, `+route.ts`, `+data.ts`, and `+config.ts`. Any other file (`+Layout.tsx`, custom guards, etc.) is preserved on regenerate.

### Packages shipping views

Third-party packages use a different shape — **do not** ship `+Page.tsx` / `+guard.ts` directly. Instead:

```
packages/<name>/views/<framework>/<Name>.{tsx,vue}   # view files per framework
packages/<name>/src/routes.ts                        # exports registerXRoutes(router, opts)
```

`@rudderjs/auth` is the reference implementation — the scanner picks up view files that the consuming app vendors into `app/Views/`, and `registerAuthRoutes(router)` wires up the controller routes.

## Common Pitfalls

- **SPA nav falling back to full reloads**: controller URL ≠ view id-derived URL. Fix: add `export const route = '/...'` at the top of the view file so the scanner generates the matching Vike route.
- **Multi-renderer error from the scanner**: install exactly one of `vike-react` / `vike-vue` / `vike-solid`. Installing two throws at scanner boot.
- **Missing view file**: the scanner reports unresolved view ids at dev / build time. Check the id against the filesystem — PascalCase file names map to kebab-case ids (`AdminUsers.tsx` → `admin-users`).
- **Parameterized controller views**: v1 does not support `/users/:id` as a controller-owned view. Keep those as regular Vike pages or resolve the param in the controller and delegate to a non-parameterized view.
- **XSS in vanilla mode**: raw template literals ship interpolations verbatim. Always use the `html\`\`` tag. Only use `new SafeString(...)` for markup you know is trusted (CMS output, rendered markdown, etc).
- **Mixed vanilla + framework views**: not supported in v1 — one project picks one mode.
- **Importing view code in non-view paths**: views live in `app/Views/` and are scanned by `@rudderjs/vite`. Importing a view module from a job / provider / CLI command won't be hydrated, won't have Vike's page context, and will usually throw or behave unexpectedly.

## Key Imports

```ts
import {
  view,               // controller factory — returns ViewResponse
  isViewResponse,     // type guard (duck-typed via __rudder_view__)
  html,               // auto-escaping tagged template for vanilla mode
  escapeHtml,         // standalone escape function
  SafeString,         // wrapper for trusted markup (escape hatch)
  ViewResponse,       // class returned by view()
} from '@rudderjs/view'

import type { ViewProps, ViewResolveContext } from '@rudderjs/view'
```
