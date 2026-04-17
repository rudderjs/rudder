# Mental Model

> **Read this if you are coming from Laravel, or if you've ever asked "why is this user showing up in the wrong request?"**

RudderJS borrows most of Laravel's ergonomics — service providers, DI, the `Auth` / `Cache` / `Session` facades, an Eloquent-style ORM, a Rudder CLI. But there is **one fundamental difference** in how the framework is wired, and nearly every "weird bug" in a RudderJS app traces back to this one thing.

**The RudderJS DI container is process-scoped. Laravel's is request-scoped.**

This one-page doc explains what that means, what to do about it, and which patterns to reach for.

---

## The three scopes

Every value in your application lives in exactly one of three scopes:

| Scope | Lifetime | How it's created | Example |
|---|---|---|---|
| **Process** | Until `node` exits | `app.singleton(Foo, ...)` | `AuthManager`, `CacheStore`, `QueueManager`, `PrismaClient` |
| **Request** | One HTTP request | `runWithX()` establishes it, `currentX()` reads it | Current user, current session, request context |
| **Transient** | Per `app().make()` call | `app.bind(Foo, ...)` | Stateless helpers, per-call builders |

The single core rule follows directly:

> **Never store request-scoped state on a process-scoped service.** Put it in AsyncLocalStorage instead.

---

## Why it matters — the Laravel difference

In Laravel (PHP-FPM / Swoole / Roadrunner with request isolation), the DI container is rebuilt per request. A `singleton` binding gives you a fresh instance every request, and any state on that instance is safely per-user. Laravel code that caches per-user data in a service field is correct and idiomatic.

In Node, **one `Application` instance handles every request for the entire lifetime of the process.** An `app.singleton(Foo, ...)` binding returns the same instance to request #1, request #42, and request #1,000,000. Any instance field is shared across all of them. Any cache keyed on an implicit "current user" will leak across users.

There is no daemon recycler that will save you. This is the runtime model.

---

## The wrong / right pattern

This is the bug class most commonly shipped by developers new to RudderJS:

### ❌ Wrong — state leaks across requests

```ts
// @rudderjs/auth — pre-fix AuthManager (bug shipped once, fixed in 2026-04)
class AuthManager {
  private _guards = new Map<string, SessionGuard>()

  guard(name = 'web'): SessionGuard {
    if (!this._guards.has(name)) {
      this._guards.set(name, new SessionGuard(/* ... */))
    }
    return this._guards.get(name)!
  }
}
```

The `Map` is on the instance. The instance is a process-wide singleton. `SessionGuard` holds a `_user` field that's set on login. **Request #2's `guard().user()` can return request #1's user.** This is the ghost-user bug.

### ✓ Right — state scoped via AsyncLocalStorage

```ts
import { AsyncLocalStorage } from 'node:async_hooks'

const _als = new AsyncLocalStorage<AuthManager>()

export function runWithAuth<T>(manager: AuthManager, fn: () => T): T {
  return _als.run(manager, fn)
}

export function currentAuth(): AuthManager {
  const m = _als.getStore()
  if (!m) throw new Error('[RudderJS Auth] No auth context. Use AuthMiddleware.')
  return m
}
```

A single `AuthMiddleware` establishes a fresh `AuthManager` per request and calls `runWithAuth(manager, next)`. Every downstream `currentAuth().user()` reads the request-scoped manager. **Two concurrent requests cannot see each other's state, and code outside a request scope throws loudly instead of returning a silent ghost.**

This is the pattern RudderJS ships for `Auth`, `Context`, `Localization`, and (internally) `Session`. Reach for it whenever you write a stateful service.

---

## How to pick the right scope

A quick flowchart:

- Does the value depend on **which HTTP request** is being served? → request-scoped → use ALS.
- Does the value depend on **which user** is making the request? → request-scoped → use ALS.
- Is it a connection pool, config registry, or shared cache? → process-scoped → `app.singleton()`.
- Is it cheap to build and holds no shared resources? → transient → `app.bind()` or just construct it inline.

If in doubt, ask: "if two requests run at the same moment, does each need its own copy?" If yes → ALS.

---

## The `runWithX()` / `currentX()` convention

Every request-scoped facade in RudderJS follows the same shape:

```ts
import { runWithAuth, currentAuth } from '@rudderjs/auth'

// 1. Middleware establishes the scope once per request
app.withMiddleware((m) => {
  m.use(async (req, next) => {
    const manager = app().make<AuthManager>('auth.manager')
    await runWithAuth(manager, next)
  })
})

// 2. Anywhere downstream reads from the current scope
const user = await currentAuth().user()
```

Invariant: if you call `currentAuth()` outside a `runWithAuth()` scope, it throws immediately with a clear error. Silent ghosts are impossible.

The built-ins that follow this pattern today:

| Package | `runWith*` | `current*` |
|---|---|---|
| `@rudderjs/auth` | `runWithAuth()` | `currentAuth()` |
| `@rudderjs/context` | `runWithContext()` | `Context.get()` / `hasContext()` |
| `@rudderjs/localization` | `runWithLocale()` | (via `trans()` / `locale()`) |

When you build a package of your own that holds per-request state, copy this shape. Do not invent a new pattern.

---

## Common mistakes + how to spot them

### 1. Caching per-request data in a provider's `boot()` closure

```ts
// ❌ The closure captures `users` ONCE at boot, not per-request
class CacheProvider extends ServiceProvider {
  async boot() {
    const users = await User.all()
    app().singleton('active-users', () => users)  // frozen at boot!
  }
}
```

This compiles, runs, and silently serves stale data forever. HMR will make it look intermittent. Fix: resolve the value lazily inside the callback, or establish ALS-scoped data via middleware.

### 2. Storing request metadata on `globalThis`

```ts
// ❌ Node does not recycle globals. Works until two concurrent requests race.
;(globalThis as any).__currentUser = user
```

Use ALS for anything request-scoped.

### 3. Mutating a process-scoped client

```ts
// ❌ prisma is a singleton — don't assign per-user context to it
const prisma = app().make(PrismaClient)
prisma._currentUserId = user.id  // leaks to every other request
```

Either pass the user ID explicitly to queries, or store it in ALS and read it from a wrapper.

### 4. Provider ordering that assumes request scope

`ServiceProvider.register()` and `boot()` run at app startup, **not per request**. Do not call `currentAuth()` / `currentContext()` / `currentSession()` from either method — there is no request scope at boot time.

---

## If you're migrating from Laravel

A quick cheat-sheet:

| Laravel | RudderJS | Note |
|---|---|---|
| `app()->make(Foo::class)` (fresh per request) | `app().make(Foo)` (process singleton) | Use ALS for per-request state |
| `request()` | `req` / `res` in route handlers | Not available outside handlers |
| `auth()->user()` | `await currentAuth().user()` | Async; inside `runWithAuth()` scope |
| `session('key')` | `await Session.get('key')` | Inside `sessionMiddleware` |
| `config('key')` | `config('key')` | ✓ identical |
| `cache()->get('k')` | `await Cache.get('k')` | Async; process singleton (correct, shared is fine) |

The facades you know (`Auth`, `Cache`, `Session`, `Log`) still work — but understand that they are thin readers over process-scoped managers, and request-scoped data inside them is ALS-backed.

---

## Summary

- **One container, one process, many requests.** Nothing is recycled per-request.
- **Store request-scoped state in AsyncLocalStorage.** Follow the `runWithX()` / `currentX()` pattern.
- **Do not cache per-user data on a singleton.** Do not mutate a singleton with per-user context.
- **If you miss Laravel's per-request container**, that feeling is the bug you're about to ship. Reach for ALS instead.

When this model clicks, RudderJS becomes Laravel for Node without the weirdness. Until it clicks, every bug feels mysterious. This page is the bridge.
