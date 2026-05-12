# Facades

Facades give you a static, expressive way to reach the framework's services without resolving them from the container by hand. They are short, memorable functions you can use anywhere in your application code — controllers, services, jobs, listeners — without `import`ing the underlying class.

```ts
import { app, config, dispatch } from '@rudderjs/core'
import { auth } from '@rudderjs/auth'
import { view } from '@rudderjs/view'

const user = await auth().user()
const port = config('server.port')
dispatch(new UserRegistered(user))
return view('dashboard', { user })
```

Behind every facade is a singleton resolved from the container. The function is just a more ergonomic way to reach it.

## Core helpers

| Helper | Package | Returns | Example |
|---|---|---|---|
| `app()` | `@rudderjs/core` | `Application` | `app().make(UserService)` |
| `resolve<T>(token)` | `@rudderjs/core` | `T` | `resolve(UserService)` |
| `config(key, fallback?)` | `@rudderjs/core` | typed value | `config('server.port', 3000)` |
| `dispatch(event)` | `@rudderjs/core` | `Promise<void>` | `dispatch(new UserRegistered(user))` |
| `report(err)` | `@rudderjs/core` | `void` | `report(new Error('failed'))` |
| `abort(status, msg?)` | `@rudderjs/core` | throws | `abort(404, 'Not found')` |
| `abort_if(cond, status)` | `@rudderjs/core` | throws if true | `abort_if(!user, 401)` |

`app()` and `resolve()` both reach the container — `resolve(X)` is shorthand for `app().make(X)`. Use whichever reads better at the call site.

## Domain facades

These facades wrap their package's manager. They are typed so your editor autocompletes the methods.

| Facade | Package | What it wraps |
|---|---|---|
| `auth()` | `@rudderjs/auth` | `AuthManager` — the request-scoped auth manager |
| `Cache` | `@rudderjs/cache` | The configured cache store |
| `Session` | `@rudderjs/session` | The request-scoped session store |
| `Log` | `@rudderjs/log` | The configured logger |
| `Storage` | `@rudderjs/storage` | The configured storage disk |
| `Mail` | `@rudderjs/mail` | The mailer |
| `Queue` | `@rudderjs/queue` | The queue dispatcher |
| `Schedule` | `@rudderjs/schedule` | The cron scheduler |
| `view(id, props)` | `@rudderjs/view` | Returns a view response — call from a route handler |
| `trans(key, params?)` | `@rudderjs/localization` | Translate a key in the current locale (async — lazy-loads the namespace) |
| `getLocale()` | `@rudderjs/localization` | The current request's locale |

```ts
import { Cache } from '@rudderjs/cache'
import { Log } from '@rudderjs/log'
import { Session } from '@rudderjs/session'

await Cache.set('user:42', user, 600)
Log.info('user.created', { userId: user.id })
Session.put('flash.success', 'Saved!')   // Session writes are sync
```

## Request-scoped facades

`auth()` and `Session` both live behind AsyncLocalStorage — they read from the current request's scope. They behave slightly differently when called outside a request:

- **`auth().user()` soft-fails to `null`.** Matches Laravel's `Auth::user()` semantics — unauthenticated, not a hard error. Safe to reference from api handlers (which run without `AuthMiddleware` by default), CLI scripts, or background jobs; it just returns `null`.
- **`Session.get(...)` / `Session.flash(...)` throw.** Session data lives in cookies that only exist inside an HTTP request — there's no sensible fallback. Use `Session.maybeCurrent()` for a non-throwing check before calling other methods.

```ts
// ✓ Safe — returns null outside a request
import { auth } from '@rudderjs/auth'

class AppServiceProvider extends ServiceProvider {
  async boot() {
    const user = await auth().user()  // null during boot
  }
}
```

```ts
// ❌ Throws — no session context
import { Session } from '@rudderjs/session'

class AppServiceProvider extends ServiceProvider {
  async boot() {
    Session.get('theme')   // throws: "No session in context"
  }
}
```

```ts
// ✓ Works — runs inside an HTTP request
Route.get('/me', async () => {
  const user  = await auth().user()
  const theme = Session.get('theme')
  return { user, theme }
})
```

For the rationale, see [Request Lifecycle](/guide/lifecycle).

## Why use facades?

Facades exist for ergonomics — they are a thin layer over the container, and the container is always available too. Use facades when:

- The call site reads better as `auth().user()` than `app().make(AuthManager).user()`.
- The service is request-scoped and the facade enforces "must be inside a request" at the call site.

Use the container directly when:

- You want explicit dependency declaration in a constructor (`constructor(private auth: AuthManager) {}`).
- You are writing a library and don't want to require consumers to install the facade's package.
- You are writing tests and prefer to inject mocks via constructors over swapping container bindings.

The two styles compose freely — many RudderJS apps use both, choosing per-call-site.

## Testing with facades

Most facades expose a `fake()` helper that swaps the underlying singleton with an in-memory test double. The fake **returns the test double** — assertion helpers live on the returned instance, not on the facade itself:

```ts
import { Cache } from '@rudderjs/cache'

test('caches the user', async () => {
  const fake = Cache.fake()
  await UserService.warmCache(user)
  fake.assertSet('user:42')
  fake.restore()
})
```

`fake()` doubles ship with `@rudderjs/cache` (`Cache.fake()`), `@rudderjs/queue` (`Queue.fake()`), `@rudderjs/mail` (`Mail.fake()`), `@rudderjs/storage` (`Storage.fake()`), `@rudderjs/notification` (`NotificationFake.fake()` — note: not on the `Notification` class), and event dispatches via `EventFake` from `@rudderjs/core`. Each test double exposes its own assertion helpers — see the package's docs for the exact names (e.g. `assertSet`/`assertSentTo`/`assertDispatched`).
