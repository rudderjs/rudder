---
name: controller-views
description: Creating controller-returned views with route overrides, multi-framework support, and the html tagged template in RudderJS
---

# Controller Views

## When to use this skill

Load this skill when you need to create controller-returned views using `view('id', props)`, override route mappings, build vanilla HTML views with auto-escaping, or understand the multi-framework view pipeline.

## Key concepts

- **view() function**: Returns a `ViewResponse` that the server adapter (`@rudderjs/server-hono`) detects and renders through Vike's SSR pipeline.
- **ID-to-URL mapping**: `view('dashboard')` -> URL `/dashboard`, `view('admin.users')` -> `/admin/users`. Dots become path separators, the id is lowercased.
- **Route override**: Export `const route = '/custom-path'` at the top of a view file to decouple the URL from the id-derived default.
- **View file location**: `app/Views/<PascalCaseId>.tsx` (or `.vue`, `.ts` for vanilla).
- **Scanner**: `@rudderjs/vite` scans `app/Views/` at build/dev time and generates Vike pages under `/__view/<id>`.
- **Multi-framework**: Auto-detects `vike-react`, `vike-vue`, or `vike-solid`. Only one renderer can be installed at a time.
- **Vanilla views**: For zero-client-JS pages, use plain `.ts` files that return strings. Use `html` tagged template for auto-escaping.
- **SPA navigation**: Full client-side navigation between controller views via `pageContext.json` fetches -- no full page reloads.

## Step-by-step

### 1. Create a basic view

```tsx
// app/Views/Dashboard.tsx
import { usePageContext } from 'vike-react/usePageContext'

export default function Dashboard() {
  const { viewProps } = usePageContext() as { viewProps: { users: any[] } }
  return (
    <div>
      <h1>Dashboard</h1>
      <p>{viewProps.users.length} users</p>
    </div>
  )
}
```

### 2. Return the view from a route handler

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { users })
})

Route.get('/about', async () => {
  return view('about', { version: '1.0.0' })
})
```

### 3. Route override (when URL differs from id)

When the controller URL doesn't match the id-derived path, add `export const route` to the view file:

```tsx
// app/Views/Welcome.tsx
// Without this, the id 'welcome' would map to /welcome
// But we want it at /
export const route = '/'

export default function Welcome() {
  return <h1>Welcome to RudderJS</h1>
}
```

```tsx
// app/Views/Auth/Login.tsx
export const route = '/login'

export default function Login() {
  // ...
}
```

The scanner picks up the `export const route` and generates the correct Vike route table entry. Without this, SPA navigation between controller views falls back to full page reloads.

### 4. View file naming conventions

| View ID | File path | Default URL |
|---------|-----------|-------------|
| `'dashboard'` | `app/Views/Dashboard.tsx` | `/dashboard` |
| `'about'` | `app/Views/About.tsx` | `/about` |
| `'admin.users'` | `app/Views/Admin/Users.tsx` | `/admin/users` |
| `'auth.login'` | `app/Views/Auth/Login.tsx` | `/auth/login` |

### 5. Pass props from the controller

```ts
// Controller-side
Route.get('/users/:id', async (req) => {
  const user = await User.find(req.params.id)
  if (!user) return { status: 404 }
  return view('users.show', { user: user.toJSON() })
})
```

```tsx
// app/Views/Users/Show.tsx
import { usePageContext } from 'vike-react/usePageContext'

export default function UserShow() {
  const { viewProps } = usePageContext() as { viewProps: { user: Record<string, unknown> } }
  const { user } = viewProps
  return <h1>{user.name as string}</h1>
}
```

### 6. Vanilla views (zero client JS)

For pages that don't need interactivity -- admin reports, emails, static content:

```ts
// app/Views/AdminReport.ts
import { html } from '@rudderjs/view'

interface AdminReportProps {
  title: string
  rows: { name: string; total: number }[]
}

export default function AdminReport({ title, rows }: AdminReportProps): string {
  return html`
    <h1>${title}</h1>
    <table>
      <thead><tr><th>Name</th><th>Total</th></tr></thead>
      <tbody>
        ${rows.map(r => html`<tr><td>${r.name}</td><td>${r.total}</td></tr>`)}
      </tbody>
    </table>
  `.toString()
}
```

The `html` tagged template:
- **Primitives** (string, number): auto-escaped via `escapeHtml()`
- **null / undefined / false**: rendered as empty string
- **Arrays**: each item recursively handled, joined without separator
- **`SafeString`**: passed through unchanged (nested `html` calls return `SafeString`)

### 7. Manual escaping (without html tag)

```ts
import { escapeHtml } from '@rudderjs/view'

export default function Page({ userInput }: { userInput: string }): string {
  return `<div>${escapeHtml(userInput)}</div>`
}
```

### 8. Injecting trusted HTML

```ts
import { html, SafeString } from '@rudderjs/view'

const trustedMarkdown = new SafeString(renderedMarkdownHtml)

export default function Page(): string {
  return html`
    <article>${trustedMarkdown}</article>
  `.toString()
}
```

### 9. Auth-aware welcome page

```tsx
// app/Views/Welcome.tsx
export const route = '/'

import { usePageContext } from 'vike-react/usePageContext'

export default function Welcome() {
  const ctx = usePageContext() as { viewProps: { user?: { name: string } } }
  const user = ctx.viewProps.user

  return (
    <div>
      <h1>Welcome to RudderJS</h1>
      {user ? (
        <p>Signed in as {user.name} <a href="/api/auth/logout">Sign out</a></p>
      ) : (
        <nav>
          <a href="/login">Log in</a>
          <a href="/register">Register</a>
        </nav>
      )}
    </div>
  )
}
```

### 10. Package views (for library authors)

Packages that ship views follow this structure:

```
packages/my-package/
  views/
    react/
      MyComponent.tsx
    vue/
      MyComponent.vue
  src/
    routes.ts  # exports registerMyRoutes(router, opts)
```

```ts
// packages/my-package/src/routes.ts
import type { Router } from '@rudderjs/router'
import { view } from '@rudderjs/view'

export function registerMyRoutes(router: Router, opts = {}): void {
  router.get('/my-page', async () => view('my-package.page', {}))
}
```

Consumer apps vendor the views into `app/Views/` via `vendor:publish`.

## Examples

See `playground/app/Views/Welcome.tsx` for the default landing page, `playground/app/Views/Auth/` for vendored auth views, and `playground/routes/web.ts` for route registration.

## Common pitfalls

- **Missing route override causes full reloads**: If a controller serves a view at `/login` but the view file has no `export const route = '/login'`, the scanner derives `/auth/login` from the id `auth.login`. The browser URL and Vike's route table don't match, so SPA nav falls back to full page reloads. Always add `export const route` when the URL diverges from the id.
- **Only one renderer**: Install exactly one of `vike-react` / `vike-vue` / `vike-solid`. Having multiple triggers a "multi-renderer installed" error from the scanner.
- **Scanner requires @rudderjs/vite**: The `view()` function alone doesn't discover files. The `@rudderjs/vite` plugin's scanner generates Vike pages at dev/build time.
- **viewProps access**: In React, read props via `usePageContext().viewProps`. The props are injected into Vike's `pageContext` by the `ViewResponse.toResponse()` method.
- **Vanilla view return type**: Vanilla views must return a `string` from their default export. Use `.toString()` on the `SafeString` returned by `html`.
- **View files are PascalCase**: `view('admin.users')` expects `app/Views/Admin/Users.tsx` (PascalCase directories and filename).
