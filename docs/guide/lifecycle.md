# Request Lifecycle

Read this if you have ever asked *"why is this user showing up in the wrong request?"* — or if you are coming from a per-request DI container in another language.

There is one fundamental fact about how RudderJS is wired, and nearly every "weird bug" in a RudderJS app traces back to it.

> **The DI container is process-scoped, not request-scoped.**

This page explains what that means and which patterns to reach for.

## Three scopes

Every value in your application lives in exactly one of three scopes:

| Scope | Lifetime | Created with | Examples |
|---|---|---|---|
| **Process** | Until `node` exits | `app.singleton(Foo, ...)` | `AuthManager`, `CacheStore`, `QueueManager`, `PrismaClient` |
| **Request** | One HTTP request | `runWithX()` establishes, `currentX()` reads | Current user, current session |
| **Transient** | Per `app().make()` call | `app.bind(Foo, ...)` | Stateless helpers, per-call builders |

The single core rule follows directly:

> Never store request-scoped state on a process-scoped service. Put it in AsyncLocalStorage instead.

## Why it matters

Some frameworks rebuild their DI container per request — a `singleton` binding gives you a fresh instance every request, and any state on that instance is safely per-user. RudderJS does **not** work that way.

**One `Application` instance handles every request for the entire lifetime of the Node process.** An `app.singleton(Foo, ...)` binding returns the same instance to request #1, request #42, and request #1,000,000. Any field on that instance is shared across all of them. Anything keyed on an implicit "current user" leaks across users.

There is no daemon recycler that will save you. This is the runtime model.

## The pattern

This is the bug class most commonly shipped by developers new to RudderJS.

```ts
// ❌ Wrong — state leaks across requests
class AuthManager {
  private _guards = new Map<string, SessionGuard>()
  guard(name = 'web') {
    if (!this._guards.has(name)) this._guards.set(name, new SessionGuard())
    return this._guards.get(name)!
  }
}
```

The `Map` is on the instance. The instance is a process-wide singleton. `SessionGuard` holds a `_user` field that is set on login. Request #2's `guard().user()` can return request #1's user. This is the ghost-user bug.

```ts
// ✓ Right — state scoped via AsyncLocalStorage
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

A single `AuthMiddleware` establishes a fresh `AuthManager` per request and calls `runWithAuth(manager, next)`. Every downstream `currentAuth().user()` reads the request-scoped manager. Two concurrent requests cannot see each other's state, and code outside a request scope throws loudly instead of returning a silent ghost.

This is the pattern RudderJS ships for `Auth`, `Context`, `Localization`, and `Session`. Reach for it whenever you write a stateful service.

## Picking the right scope

A quick flowchart:

- Does the value depend on **which HTTP request** is being served? → request-scoped → use ALS.
- Does the value depend on **which user** is making the request? → request-scoped → use ALS.
- Is it a connection pool, config registry, or shared cache? → process-scoped → `app.singleton()`.
- Is it cheap to build and holds no shared resources? → transient → `app.bind()` or just construct it inline.

If in doubt, ask: *"if two requests run at the same moment, does each need its own copy?"* If yes, use ALS.

## The `runWithX` / `currentX` convention

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

If you call `currentAuth()` outside a `runWithAuth()` scope, it throws immediately with a clear error. Silent ghosts are impossible.

| Package | `runWith*` | `current*` |
|---|---|---|
| `@rudderjs/auth` | `runWithAuth()` | `currentAuth()` |
| `@rudderjs/context` | `runWithContext()` | `Context.get()` |
| `@rudderjs/localization` | `runWithLocale()` | accessed via `trans()` / `getLocale()` |

When you build a package of your own that holds per-request state, copy this shape.

## Common mistakes

### Caching per-request data in a provider's `boot()` closure

```ts
// ❌ The closure captures `users` once at boot, not per-request
class CacheProvider extends ServiceProvider {
  async boot() {
    const users = await User.all()
    app().singleton('active-users', () => users)  // frozen at boot
  }
}
```

Resolve the value lazily inside the callback, or establish ALS-scoped data via middleware.

### Storing request metadata on `globalThis`

```ts
// ❌ Works until two concurrent requests race
;(globalThis as any).__currentUser = user
```

Use ALS for anything request-scoped.

### Mutating a process-scoped client

```ts
// ❌ prisma is a singleton — don't assign per-user context
const prisma = app().make(PrismaClient)
prisma._currentUserId = user.id  // leaks to every other request
```

Pass the user ID explicitly to queries, or store it in ALS and read it from a wrapper.

### Calling `currentX()` from `register()` or `boot()`

`ServiceProvider.register()` and `boot()` run at app startup, not per request. There is no request scope at boot time. Calling `currentAuth()`, `currentContext()`, or `currentSession()` from either method throws.

## Coming from Laravel

| Laravel | RudderJS | Note |
|---|---|---|
| `app()->make(Foo::class)` (fresh per request) | `app().make(Foo)` (process singleton) | Use ALS for per-request state |
| `request()` | `req` / `res` in handlers | Not available outside handlers |
| `auth()->user()` | `await currentAuth().user()` | Async; inside `runWithAuth()` scope |
| `session('key')` | `await Session.get('key')` | Inside `sessionMiddleware` |
| `config('key')` | `config('key')` | Identical |
| `cache()->get('k')` | `await Cache.get('k')` | Async; process singleton (correct, shared is fine) |

The familiar facades (`Auth`, `Cache`, `Session`, `Log`) all exist — they are thin readers over process-scoped managers, and request-scoped data inside them is ALS-backed.

## Summary

- One container, one process, many requests. Nothing is recycled per-request.
- Store request-scoped state in AsyncLocalStorage. Follow the `runWithX` / `currentX` pattern.
- Do not cache per-user data on a singleton. Do not mutate a singleton with per-user context.
