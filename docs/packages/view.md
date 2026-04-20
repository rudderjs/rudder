# @rudderjs/view

Laravel-style controller-returned views, rendered through Vike's SSR pipeline. Controllers return `view('id', props)` and the framework takes care of SSR, hydration, and SPA navigation.

```ts
import { view } from '@rudderjs/view'

Route.get('/dashboard', async () => {
  const users = await User.all()
  return view('dashboard', { title: 'Dashboard', users })
})
```

See the [Controller Views guide](/guide/views) for a tutorial-style walkthrough. This page is the API reference.

## Installation

```bash
pnpm add @rudderjs/view @rudderjs/vite vike
```

Included by default in projects scaffolded with `create-rudder-app`.

`@rudderjs/vite` provides the scanner that discovers view files and generates the virtual Vike pages. `@rudderjs/server-hono` detects `ViewResponse` from controller handlers automatically — no extra wiring.

## `view(id, props)`

Returns a `ViewResponse`. When a controller returns one, the server adapter resolves it via Vike's `renderPage()`.

```ts
view('dashboard')                        // no props
view('dashboard', { title: 'Home' })     // with props
view('admin.users', { users })            // nested directory
```

| Argument | Type | Description |
|---|---|---|
| `id` | `string` | View identifier. Maps 1:1 to a file under `app/Views/` and to a URL. |
| `props` | `Record<string, unknown>?` | Props passed to the view component. Must be serializable. |

## id → URL mapping

PascalCase filenames become kebab-case ids. Directory nesting uses dots.

| `view(...)` call | File | URL |
|---|---|---|
| `view('dashboard')` | `app/Views/Dashboard.tsx` | `/dashboard` |
| `view('admin.users')` | `app/Views/Admin/Users.tsx` | `/admin/users` |
| `view('settings.profile')` | `app/Views/Settings/Profile.tsx` | `/settings/profile` |

Your controller's URL must match. Mismatches cause SPA navigation to fall back to full page reloads.

### Overriding the URL

When the URL diverges from the id-derived path, export a `route` constant at the top of the view file:

```tsx
// app/Views/Welcome.tsx
export const route = '/'        // served at /, not /welcome

export default function Welcome() { /* ... */ }
```

```tsx
// app/Views/Auth/Login.tsx
export const route = '/login'   // served at /login, not /auth/login

export default function Login() { /* ... */ }
```

**Required whenever the URL diverges.** The scanner reads this export at build time and wires the Vike page to the explicit path. No error is thrown if you forget — SPA nav just silently regresses to full page reloads.

## Framework support

The scanner auto-detects which Vike renderer is installed and emits matching stubs. Install exactly one:

| Framework | Vike renderer | Extension |
|---|---|---|
| React | `vike-react` | `.tsx` / `.jsx` |
| Vue | `vike-vue` | `.vue` |
| Solid | `vike-solid` | `.tsx` / `.jsx` |
| Vanilla | *(none)* | `.ts` / `.js` |

## Vanilla HTML-string mode

When no `vike-*` renderer is installed, views return HTML strings — no hydration, zero client-side JavaScript. The Blade equivalent, useful for printable invoices, HTML email bodies, webhook responses.

```ts
// app/Views/Invoice.ts
import { html } from '@rudderjs/view'

export default function Invoice({ number, lines }) {
  return html`
    <div>
      <h1>Invoice #${number}</h1>
      <table>
        ${lines.map(l => html`
          <tr><td>${l.description}</td><td>${l.amount.toFixed(2)}</td></tr>
        `)}
      </table>
    </div>
  `
}
```

The `html\`\`` tagged template **auto-escapes every interpolation** — you can't accidentally ship an XSS hole. Nested `html\`\`` blocks pass through as `SafeString` without re-escaping. Arrays of `SafeString` join automatically.

```ts
import { html, escapeHtml, SafeString } from '@rudderjs/view'

html`<p>${user.name}</p>`                           // safe, auto-escaped
new SafeString(cms.renderTrustedHtml())             // escape hatch for trusted markup
const raw = `<p>${escapeHtml(user.name)}</p>`       // standalone escape function

// ❌ Raw template literal — XSS if user.name is '<script>'
const bad = `<p>${user.name}</p>`
```

## Shared layouts

Drop a `+Layout.tsx` under `pages/__view/` and Vike wraps every controller view with it:

```
pages/__view/+Layout.tsx            ← wraps all controller views
pages/__view/admin/+Layout.tsx      ← wraps only app/Views/Admin/**
```

The scanner only manages `+Page.tsx`, `+route.ts`, `+data.ts`, and `+config.ts`. Anything else (`+Layout.tsx`, custom guards, framework config) is preserved on regenerate.

## Exports

```ts
import {
  view,              // (id, props?) → ViewResponse
  ViewResponse,       // class returned by view()
  isViewResponse,     // type guard (duck-typed via __rudder_view__)
  html,               // auto-escaping tagged template
  escapeHtml,         // standalone escape function
  SafeString,         // trusted-markup wrapper
} from '@rudderjs/view'

import type { ViewProps, ViewResolveContext } from '@rudderjs/view'
```

## Packages shipping views

Third-party `@rudderjs/*` packages that ship UI (auth pages, admin panels, etc.) do **not** use `app/Views/` — that's the app's namespace. Instead:

```
packages/<name>/views/<framework>/<Name>.{tsx,vue}   # one per framework
packages/<name>/src/routes.ts                        # exports registerXRoutes(router, opts)
```

The app vendors the framework-matched views into its own `app/Views/`, then calls `registerXRoutes(router)` to wire the controller routes. `@rudderjs/auth` is the reference implementation.

---

## Common pitfalls

- **SPA nav falls back to full reloads.** Controller URL doesn't match the id-derived URL. Add `export const route = '/...'` at the top of the view file.
- **"Multiple renderers installed" at dev startup.** Install exactly one of `vike-react` / `vike-vue` / `vike-solid`.
- **Parameterized URLs (`/users/:id`) don't work as controller views in v1.** Either keep as regular Vike pages, or resolve the param in the controller and delegate to a non-parameterized view.
- **Non-serializable props disappear on hydration.** Functions, class instances with methods, and non-plain objects don't survive SSR. Transform Model instances to plain objects first.
- **XSS in vanilla mode.** Plain template literals don't auto-escape. Always use `html\`\``; wrap trusted markup with `new SafeString(...)`.
- **Mixed vanilla + framework views.** Not supported in v1 — pick one mode per project.
