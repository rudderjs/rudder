# Auth Views (Login / Register UI)

## Vendor the view files

`@rudderjs/auth` ships React and Vue auth views. Vendor them into your app:

```bash
pnpm rudder vendor:publish --tag=auth-views
```

This copies `@rudderjs/auth/views/react/` (or `/vue/`) into `app/Views/Auth/`. After vendoring, the files belong to your app — edit them freely.

## Register the controller routes

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { registerAuthRoutes } from '@rudderjs/auth/routes'

registerAuthRoutes(Route)
```

`registerAuthRoutes(Route)` registers:

| URL | View id |
|---|---|
| `GET /login`           | `auth.login` |
| `GET /register`        | `auth.register` |
| `GET /forgot-password` | `auth.forgot-password` |
| `GET /reset-password`  | `auth.reset-password` |

The view-id mapping uses `view('id', props)` and lands in `app/Views/Auth/<File>.tsx`.

## Customize paths and view ids

```ts
registerAuthRoutes(Route, {
  paths: {
    login:    '/sign-in',
    register: '/sign-up',
  },
  views: {
    login:    'auth.sign-in',     // maps to app/Views/Auth/SignIn.tsx
    register: 'auth.sign-up',
  },
  homeUrl: '/dashboard',          // redirect destination for authenticated users
})
```

## Add the `route` export to vendored views

Vendored auth views need an explicit URL because the id-derived default (`/auth/login`) doesn't match the controller route (`/login`).

```tsx
// app/Views/Auth/Login.tsx
export const route = '/login'

export default function Login(props: { /* ... */ }) { /* ... */ }
```

Without this, **SPA navigation falls back to full page reloads** because Vike's client route table doesn't match the browser URL.

## Pitfalls

❌ **Don't** assume POST handlers come from `registerAuthRoutes`:

```ts
registerAuthRoutes(Route)
// ❌ POST /login / POST /register / POST /logout — those are YOUR job
```

✅ **Do** add them in `routes/api.ts` or `routes/web.ts` using `auth().attempt()` / `auth().login()` / `auth().logout()`.

❌ **Don't** skip the `route` export when customizing URLs:

```tsx
// app/Views/Auth/Login.tsx — no route export
export default function Login() { /* ... */ }
```

✅ **Do** add it so SPA nav works:

```tsx
export const route = '/sign-in'
export default function Login() { /* ... */ }
```

❌ **Don't** mix `vike-react` and `vike-vue` — the scanner errors at boot.

✅ **Do** pick one renderer per project; vendor the matching auth views (`--tag=auth-views` auto-detects).
