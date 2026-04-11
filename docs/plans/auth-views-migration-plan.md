---
status: draft
created: 2026-04-11
references:
  - controller-views-plan.md
---

# Plan: Migrate `@rudderjs/auth` to controller-returned views

## Why this package first

`@rudderjs/auth` is the **simplest non-trivial package that ships UI** — four pages (login, register, forgot-password, reset-password), three framework variants (react/vue/solid) each, plus per-page guards. It has the most pre-existing pain points and the smallest blast radius. Once this works, the same pattern applies to telescope/pulse/horizon and (eventually) pilotiq panels.

This migration is the **reference implementation** — its file layout, helper API, and override mechanism become the template every other package copies.

---

## Current state (the pain we're fixing)

`packages/auth/pages/{react,vue,solid}/<page>/` ships both `+Page.tsx` and `+guard.ts`. The playground vendors these by *copying* them into `playground/pages/(auth)/<page>/`. Concretely:

- **Duplication**: `packages/auth/pages/react/login/+Page.tsx` and `playground/pages/(auth)/login/+Page.tsx` are byte-identical copies. Drift is inevitable.
- **Three sources of truth per route**: route handler in `routes/api.ts` (e.g. `Route.post('/api/auth/sign-in/email', ...)`), page component in `pages/(auth)/login/+Page.tsx`, guard in `+guard.ts`. Adding a middleware (e.g. CSRF, rate limit) means editing two places, in two different mental models (router middleware vs. Vike guard).
- **Filesystem-based discovery**: consumers must place auth pages under their `pages/` dir at the right paths. The scaffolder hard-codes this. Any rename in the auth package breaks every existing consumer.
- **Guards run server-side via Vike `+guard.ts`**, not via router middleware. So `RequireAuth`, `RateLimit`, and `CsrfMiddleware` (which all live in `@rudderjs/middleware`) aren't usable for auth pages — auth pages re-implement the guard manually inside `+guard.ts`.

## Target state

`@rudderjs/auth` ships **pure presentational view components** plus a **single route registration helper**. Consumers wire it with one line. Nothing in `pages/`.

```
packages/auth/
├── views/
│   ├── react/
│   │   ├── Login.tsx          ← pure component, takes props
│   │   ├── Register.tsx
│   │   ├── ForgotPassword.tsx
│   │   └── ResetPassword.tsx
│   ├── vue/
│   │   └── *.vue
│   └── solid/
│       └── *.tsx
└── src/
    └── routes.ts              ← registerAuthRoutes() helper
```

Consumer's `routes/web.ts`:

```ts
import { Route } from '@rudderjs/router'
import { registerAuthRoutes } from '@rudderjs/auth/routes'

registerAuthRoutes(Route, { framework: 'react' })
```

That single call registers `/login`, `/register`, `/forgot-password`, `/reset-password` (GET pages + POST submit handlers), with `RateLimit`, `CsrfMiddleware`, and `RequireGuest` middleware applied via the normal router chain. No `+guard.ts`, no `+Page.tsx` in the consumer's `pages/`.

The view files are vendored into the consumer's `app/Views/Auth/` by the scaffolder (Phase 1) or auto-discovered from the package via a "vendor view" resolver (Phase 2 — see "Phase 2: Vendor view publishing" below).

---

## Phase 1: Restructure the package

### 1.1 Move pages → views

For each of `login`, `register`, `forgot-password`, `reset-password`, and each framework (`react`, `vue`, `solid`):

- `packages/auth/pages/react/login/+Page.tsx` → `packages/auth/views/react/Login.tsx`
- Strip the guard logic out of the component file (it moves to the route helper as middleware)
- Convert hard-coded `fetch('/api/auth/sign-in/email')` calls to use props supplied by the controller (e.g. `{ submitUrl, csrfToken, errors }`) — no more URL coupling inside the component
- Component signature becomes:
  ```ts
  interface LoginProps {
    submitUrl:    string         // '/api/auth/sign-in/email'
    csrfToken:    string
    errors?:      Record<string, string>
    redirectTo?:  string
  }
  export default function Login(props: LoginProps) { ... }
  ```

The component becomes a **pure form** with no implicit URL knowledge. The controller decides where the form posts.

Delete `+guard.ts` files entirely — the guard logic moves to a `RequireGuest` middleware in the route helper.

### 1.2 New `RequireGuest` middleware

Add to `@rudderjs/auth` (or `@rudderjs/middleware` if it doesn't fit):

```ts
export function RequireGuest(redirectTo = '/'): MiddlewareHandler {
  return async (req, res, next) => {
    const auth = app().make<BetterAuthInstance>('auth')
    const session = await auth.api.getSession({ headers: new Headers(req.headers) })
    if (session?.user) return res.redirect(redirectTo)
    await next()
  }
}
```

This is the controller-mode equivalent of `+guard.ts` — a normal router middleware that any package can use.

### 1.3 Route registration helper

```ts
// packages/auth/src/routes.ts
import type { Router } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { CsrfMiddleware, RateLimit } from '@rudderjs/middleware'
import { RequireGuest } from './middleware/require-guest.js'

interface RegisterAuthRoutesOptions {
  /** Which UI framework's views to render — must match the consumer's Vike setup */
  framework?: 'react' | 'vue' | 'solid'
  /** Override view ids if the consumer customized them under app/Views/Auth/ */
  views?: Partial<Record<'login' | 'register' | 'forgotPassword' | 'resetPassword', string>>
  /** Where to redirect successful sign-ins (default: '/') */
  homeUrl?: string
}

export function registerAuthRoutes(
  router: Router,
  opts: RegisterAuthRoutesOptions = {},
): void {
  const homeUrl = opts.homeUrl ?? '/'
  const guestOnly = [RequireGuest(homeUrl), CsrfMiddleware()]
  const submitLimit = RateLimit.perMinute(10).by(req => req.headers['x-forwarded-for'] ?? 'unknown')

  // GET /login — renders the login form view
  router.get('/login', async (req) => {
    return view(opts.views?.login ?? 'auth.login', {
      submitUrl: '/api/auth/sign-in/email',
      csrfToken: req.session?.csrfToken ?? '',
    })
  }, guestOnly)

  // POST /api/auth/sign-in/email — handled by existing better-auth integration
  // (no view, just JSON — already wired in the auth provider)

  // ...same for register, forgot-password, reset-password
}
```

Note: the **POST submit handlers stay where they already are** — wired through better-auth's existing API surface (`/api/auth/*`). The migration only changes how the **GET pages** are rendered. The views post to those existing endpoints.

### 1.4 Per-framework view ids

Since `view('auth.login')` resolves to `app/Views/Auth/Login.tsx` (one file), the framework choice happens at the file level: react projects get `Login.tsx`, vue projects get `Login.vue`. The `framework` option on `registerAuthRoutes` exists only to drive the vendor-publish step (Phase 2) — at runtime, only one file exists in `app/Views/Auth/` and the framework is determined by the consumer's Vike config.

---

## Phase 2: Vendor view publishing (Laravel-style)

Once the package restructure works, add a **publish** mechanism so consumers don't have to copy view files manually.

```bash
pnpm rudder vendor:publish --tag=auth-views
```

This copies `node_modules/@rudderjs/auth/views/<framework>/**` → `app/Views/Auth/**`. The user can then edit them. The package is the source of truth on first install; the user owns the copies after publishing.

This mirrors `php artisan vendor:publish --tag=auth-views` exactly. New rudder command lives in `@rudderjs/auth/boost`.

**Optional: vendor view fallback resolver.** If `app/Views/Auth/Login.tsx` does not exist when `view('auth.login')` is called, fall back to `node_modules/@rudderjs/auth/views/<framework>/Login.tsx`. The Vite scanner needs a small extension: also scan `node_modules/@rudderjs/*/views/<framework>/**` and emit virtual pages for them with a lower-priority id. This way the package "just works" without publishing, but publishing makes the views customizable.

I'd ship this fallback in Phase 2 — it's the difference between "auth works out of the box" (yes) and "you must run vendor:publish first" (annoying).

---

## Phase 3: Scaffolder + playground updates

### 3.1 Scaffolder

`create-rudder-app`:
- Stop copying `packages/auth/pages/<framework>/**` into `playground/pages/(auth)/**`
- Instead, run `vendor:publish --tag=auth-views` after `pnpm install`
- Add `registerAuthRoutes(Route, { framework })` to the generated `routes/web.ts`

### 3.2 Playground

- Delete `playground/pages/(auth)/` entirely
- Add `registerAuthRoutes(Route, { framework: 'react' })` to `routes/api.ts`
- Run `pnpm rudder vendor:publish --tag=auth-views` to seed `app/Views/Auth/`
- Verify all four flows (login, register, forgot, reset) work end-to-end in the browser

---

## Migration template — what other packages copy

Once the auth migration lands, every other package that ships UI follows the same shape:

```
packages/<name>/
├── views/
│   ├── react/
│   ├── vue/
│   └── solid/
└── src/
    └── routes.ts              ← register<Name>Routes(router, opts)
```

Plus a `--tag=<name>-views` entry in the vendor:publish registry.

Migration order (easiest → hardest):

1. **`@rudderjs/auth`** — this plan
2. **`@rudderjs/telescope`** — single dashboard page, mostly read-only
3. **`@rudderjs/pulse`** — same as telescope
4. **`@rudderjs/horizon`** — queue UI, slightly more interactive
5. **`@pilotiq/panels`** — many pages, complex; defer until 1–4 prove the pattern

---

## Open questions

1. **POST submit handlers**: better-auth already exposes `/api/auth/*` endpoints via the `auth` provider. Do we want the route helper to *also* register the POST handlers (so the package owns the full URL surface), or leave them where they are? Recommendation: leave them — they're not view-related, and reshuffling them widens the migration.
2. **Locale-aware view resolution**: `view('auth.login')` could fall back to `view('auth.login.fr')` if `getLocale() === 'fr'` and the file exists. Defer to a follow-up.
3. **Vendor view scanner perf**: scanning `node_modules/@rudderjs/*/views/**` on every dev boot may be slow on big monorepos. Cache the manifest by package version. Defer to Phase 2 implementation.
4. **Framework mixing**: a consumer is on `vike-react`, but installs a package whose views only exist for `vue`. We should warn at registration time, not 404 at request time.

---

## Scope cut for v1

- **Phase 1 only** — manual vendoring (consumer copies views from the package's README).
- **Four routes**: login, register, forgot-password, reset-password.
- **React only** — vue/solid migrate after the pattern proves out.
- **No vendor:publish command** — Phase 2 work.
- **No fallback resolver** — Phase 2 work.
- **Consumer playground updated by hand** — no scaffolder changes yet.

Estimated surface: ~600 LOC moved + ~150 LOC new (`RequireGuest`, `registerAuthRoutes`, four view restructures).

## Success criteria

When this is done:

- `playground/pages/(auth)/` directory is **deleted**.
- `playground/routes/api.ts` contains exactly **one line** for auth UI: `registerAuthRoutes(Route)`.
- Login flow works end-to-end in the browser, including CSRF, rate-limiting, and redirect-after-login.
- All four flows (login/register/forgot/reset) render via `view('auth.<id>', props)`.
- The auth package's `pages/` directory is **deleted**.
- A user can customize `app/Views/Auth/Login.tsx` and see the change immediately on `/login` without touching the auth package.
