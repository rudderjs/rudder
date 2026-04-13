---
status: done
created: 2026-04-11
completed: 2026-04-11
---

# Plan: Laravel-style `auth()` ergonomics

## Overview

Bring Laravel 11/12/13's `auth()->user()` / `$request->user()` ergonomics to RudderJS. Today, reading "who is the current user?" inside a route handler requires 10+ lines of manager lookup + `runWithAuth` context wrapping, even though all the pieces (ALS-based `currentAuth()`, the `Auth` facade, the `AppRequest.user` augmentation) are already in place.

After this plan:

```ts
// Global auth() helper — mirrors Laravel's auth()->user()
import { auth } from '@rudderjs/auth'
Route.get('/', async () => {
  const user = await auth().user()
  return view('welcome', { user })
})

// Or via req.user — mirrors Laravel's $request->user()
Route.get('/', async (req) => {
  return view('welcome', { user: req.user })
})
```

No middleware to wire per-route, no manager lookup, no `runWithAuth` at the call site.

---

## Why this matters

The welcome route in `playground/routes/web.ts` currently spends 18 lines answering "is anyone signed in?":

```ts
Route.get('/', async () => {
  let user: { name: string; email: string } | null = null
  try {
    const manager = app().make<AuthManager>('auth.manager')
    await runWithAuth(manager, async () => {
      const authUser = await Auth.user()
      if (authUser) {
        const record = authUser as unknown as Record<string, unknown>
        user = { name: String(record['name'] ?? ''), email: String(record['email'] ?? '') }
      }
    })
  } catch { /* auth not registered */ }
  return view('welcome', { user, ... })
}, webMw)
```

That's a code smell — the fact that we have to explain AsyncLocalStorage to users for the most common auth question ever. Laravel nails this exact thing in one line. We can too without changing the underlying ALS model, because all the glue already exists; it's just not wired to run automatically.

---

## Current state

What already works (don't re-invent):

1. **`@rudderjs/auth/auth-manager.ts`** — `currentAuth()` reads the ALS store, `runWithAuth(manager, fn)` wraps a callback. The `Auth` facade (capital-A) already delegates to `currentAuth().guard(...)`.
2. **`@rudderjs/contracts.AppRequest`** — augmented by `@rudderjs/auth` with an optional `user?: AuthUser` field (packages/auth/src/index.ts:9-13).
3. **`AuthMiddleware()`** — already runs `runWithAuth` and populates `(req.raw).__rjs_user` + `req.user` (packages/auth/src/index.ts:56-73). It's opt-in per route today.
4. **`RequireAuth()`** — same as AuthMiddleware but 401s on unauthenticated requests.

What's missing:

- A way to get `runWithAuth` to wrap *every* HTTP request automatically when auth is registered, so user code never has to.
- A short lowercase `auth()` helper that returns the current `AuthManager` (Laravel parity with `auth()->user()`).

---

## Design

### 1. Auto-wrap requests in `runWithAuth` (global middleware)

Add `AuthMiddleware()` as a global middleware automatically from `AuthServiceProvider.boot()`. This is a one-line change in the provider:

```ts
// packages/auth/src/provider.ts (or wherever AuthServiceProvider.boot lives)
boot() {
  // ... existing manager registration ...
  const router = this.app.make<Router>('router')
  router.use(AuthMiddleware())   // global — wraps every request in runWithAuth, sets req.user
}
```

Result:

- Every request now runs inside `runWithAuth(manager, …)`, so `currentAuth()` and the `Auth` facade work from any handler without manual wrapping.
- `req.user` is populated before any route handler runs (matching Laravel's `$request->user()`).
- Performance: one ALS wrap + one session read per request. Negligible (in-memory). Matches Laravel's `StartSession` + `Authenticate` cost profile.

Tradeoff: this is opt-out by design. If a user doesn't want auth on every request, they don't install `@rudderjs/auth` / don't register the provider. Provider-scoped is the right granularity — Laravel's `web` middleware group makes the same call.

### 2. Add the lowercase `auth()` helper

Add a free function export in `@rudderjs/auth/auth-manager.ts`:

```ts
export function auth(): AuthManager {
  return currentAuth()
}
```

Then `packages/auth/src/index.ts` adds:

```ts
export { auth } from './auth-manager.js'
```

Call sites:

```ts
import { auth } from '@rudderjs/auth'
await auth().user()              // current user or null
await auth().check()             // true/false
await auth().guard('api').user() // different guard
```

Naming note: `Auth` (capital, the class/facade) and `auth` (lowercase, the getter function) coexist without conflict. `app` / `app()` from `@rudderjs/core` is the precedent.

### 3. Document `req.user` as the preferred HTTP shape

`req.user` already works via the existing module augmentation — once the global middleware runs (step 1), it's populated on every request. No code changes needed, just documentation. It's the most Laravel-ish at the call site:

```ts
Route.get('/', async (req) => {
  return view('welcome', { user: req.user })
})
```

Tradeoff vs `auth().user()`:

- `req.user` — zero await, property access, TypeScript-typed. Only works inside HTTP handlers.
- `auth().user()` — works anywhere (HTTP, CLI commands, queue workers, scheduled jobs), because the ALS context is populated wherever `runWithAuth` has been called. Always awaited.

Ship both.

---

## Non-goals

- **Do not** change `runWithAuth` or `currentAuth` — they stay as the low-level primitives.
- **Do not** rewrite `Auth` (capital) — it stays as the facade-style class. `auth()` is a sibling, not a replacement.
- **Do not** auto-register AuthMiddleware for non-HTTP contexts (CLI, queues) — those callers are responsible for calling `runWithAuth` themselves because there's no per-invocation "request" to wrap.
- **Do not** touch `server-hono` internals — adding a global middleware via `router.use(...)` already flows through the server adapter's existing middleware pipeline. No adapter-level change needed, which means `server-express` / future adapters get this for free.

---

## Changes by package

### `@rudderjs/auth`

1. **`src/auth-manager.ts`** — add `export function auth(): AuthManager { return currentAuth() }`.
2. **`src/index.ts`** — re-export `auth`.
3. **`src/provider.ts`** (or wherever `AuthServiceProvider.boot` lives — locate during implementation) — call `router.use(AuthMiddleware())` in `boot()`, guarded by a check that the router is available.

### `playground/routes/web.ts`

Rewrite the welcome route:

```ts
import { auth } from '@rudderjs/auth'

Route.get('/', async () => {
  const authUser = await auth().user()
  const user = authUser
    ? { name: String((authUser as any).name ?? ''), email: String((authUser as any).email ?? '') }
    : null

  return view('welcome', {
    appName:       config<string>('app.name', 'RudderJS'),
    rudderVersion: rudderCorePkg.version,
    nodeVersion:   process.version.replace(/^v/, ''),
    env:           config<string>('app.env', 'development'),
    user,
  })
}, webMw)
```

Drop imports: `app`, `AuthManager`, `Auth`, `runWithAuth`.
Keep imports: `config`, `view`, `auth` (new).

18 lines → ~8.

Alternative even-shorter form using `req.user`:

```ts
Route.get('/', async (req) => view('welcome', {
  appName:       config<string>('app.name', 'RudderJS'),
  rudderVersion: rudderCorePkg.version,
  nodeVersion:   process.version.replace(/^v/, ''),
  env:           config<string>('app.env', 'development'),
  user:          req.user ?? null,
}), webMw)
```

Pick `auth().user()` for the playground since it's the demo-ier of the two and shows the helper. Document `req.user` in CLAUDE.md / docs as the alternative.

### Other playground files affected

- **`app/Controllers/AuthController.ts`** — simplify `signIn`, `signUp`, `signOut` to drop their `runWithAuth` wraps. After the global middleware lands, `Auth.attempt(...)` and friends work directly without the context wrap.
- **`routes/api.ts`** `/api/me` — can drop `AuthMiddleware()` from the per-route middleware array (global now covers it). Route body becomes `return res.json({ user: req.user ?? null })`.

Both are consequence cleanups, not new work — they fall out of step 1.

---

## Phases

### Phase 1 — Ship `auth()` + global middleware

1. Locate `AuthServiceProvider.boot()` and confirm it has access to the router.
2. Add `auth()` export in auth-manager.ts + re-export from index.ts.
3. Register `AuthMiddleware()` globally in `AuthServiceProvider.boot()`.
4. Verify: `pnpm build` from root, `pnpm typecheck` in playground.
5. Boot playground, hit `/` signed-in and signed-out — welcome page shows the right state.
6. Boot playground, POST to `/api/auth/sign-in/email` — still works.
7. Hit `/api/me` with and without a session cookie — still works.

### Phase 2 — Playground cleanup

1. Rewrite `routes/web.ts` welcome route.
2. Drop `runWithAuth` wraps from `AuthController` methods.
3. Drop `AuthMiddleware()` from `/api/me` middleware array.
4. `pnpm typecheck` clean (modulo the 4 pre-existing unrelated errors).
5. Manual re-test the same three paths from phase 1.

### Phase 3 — Docs

1. Update `CLAUDE.md` or `docs/` to describe `auth()` and `req.user` as the primary ways to read the current user.
2. Note that non-HTTP callers (CLI, queue, scheduler) still need to call `runWithAuth` themselves.

---

## Risks

- **Double-registration of AuthMiddleware**: if a user has been manually adding `AuthMiddleware()` per route, the global one runs first, and their per-route one runs again. Harmless (idempotent — both just look up the current user and set the same `req.user`), but wasteful. Mitigation: document that the per-route version is redundant now; don't remove the ability to add it manually (some users may want a different guard name per route).
- **Breaking `RequireAuth`**: `RequireAuth()` still works unchanged — it's a separate middleware that 401s on unauthenticated users. The global `AuthMiddleware` runs first and populates the context; `RequireAuth` then reads it and gates. No conflict.
- **Order sensitivity**: the global auth middleware must run *after* `SessionMiddleware` (needs the session to resolve the guard). Since both run via `router.use(...)` and the session provider boots before the auth provider (existing order in `playground/bootstrap/providers.ts`), global middleware registration order follows provider boot order — should be correct, but verify during phase 1.
- **CLI path**: CLI commands don't go through the HTTP pipeline, so `auth()` called from a command still throws "No auth context" unless the command wraps itself in `runWithAuth`. That's intentional (non-goal #3) but worth a friendly error message upgrade in `currentAuth()` — the current message already says "Use AuthMiddleware" which is misleading in a CLI context. Optional polish in phase 3.
