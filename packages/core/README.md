# @rudderjs/core

Application bootstrap, service provider lifecycle, and framework-level runtime orchestration.

## Installation

```bash
pnpm add @rudderjs/core
```

## Usage

```ts
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    web:      () => import('../routes/web.js'),
    api:      () => import('../routes/api.js'),
    commands: () => import('../routes/console.js'),
  })
  .withMiddleware((m) => {
    // Global — runs on every request
    m.use(RateLimit.perMinute(60))

    // Group-scoped — only runs on routes loaded via withRouting({ web } / { api })
    m.web(CsrfMiddleware())
    m.api(RateLimit.perMinute(120))
  })
  .withExceptions((e) => {
    // Custom error type → custom response
    e.render(PaymentError, (err) =>
      new Response(JSON.stringify({ code: err.code }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    // Override the reporter (default: @rudderjs/log when installed, otherwise console.error)
    e.reportUsing((err) => Sentry.captureException(err))
    // Re-throw to the server's native fallback
    e.ignore(DebugOnlyError)
  })
  .create()
```

## API Reference

- `ServiceProvider` — `register()`, `boot()`, `publishes()`
- `PublishGroup` — `{ from, to, tag? }`
- `getPublishGroups()` — returns the global publish registry (used by `vendor:publish`)
- `Listener`, `EventDispatcher`, `dispatcher`, `dispatch()`, `events()`
- `Application`, `AppConfig`
- `ConfigureOptions`, `RoutingOptions`
- `MiddlewareConfigurator`, `ExceptionConfigurator`
- `appendToGroup(group, handler)` — provider-facing helper to install middleware into the `web` or `api` group
- `AppBuilder`, `RudderJS`
- `app()`, `resolve()`
- `defineConfig()`
- `HttpException` — HTTP error with `statusCode`, `message`, `headers`
- `abort(status, message?, headers?)` — throws `HttpException`
- `abort_if(condition, status, message?)` — conditional abort
- `abort_unless(condition, status, message?)` — inverse conditional abort
- `report(err)` — report an error to the configured reporter
- `report_if(condition, err)` — conditional report
- `setExceptionReporter(fn)` — override the global reporter (wired automatically by `@rudderjs/log`)
- Re-exports from `@rudderjs/rudder`, `@rudderjs/support`, and `@rudderjs/contracts` types plus built-in DI and Events primitives

## Configuration

- `AppConfig`
  - `name?`, `env?`, `debug?`
  - `providers?`
  - `config?` (config object bound into the container)
- `ConfigureOptions`
  - `server`, `config?`, `providers?`

## Middleware Groups

Routes loaded via `withRouting({ web })` are tagged `web`; via `withRouting({ api })` tagged `api`. The server adapter prepends the matching group's middleware stack before per-route middleware — Laravel-style.

```ts
.withMiddleware((m) => {
  m.use(RateLimit.perMinute(60))   // global — every request
  m.web(CsrfMiddleware())           // only on web routes
  m.api(RateLimit.perMinute(120))   // only on api routes
})
```

**Execution order:** `m.use(...)` → group (`m.web` / `m.api`) → per-route middleware → handler.

Framework packages install into a group during `boot()` via `appendToGroup('web', handler)` from `@rudderjs/core` — this is how `@rudderjs/session` and `@rudderjs/auth` keep session + user resolution on web routes only, leaving api routes stateless by default.

```ts
import { ServiceProvider, appendToGroup } from '@rudderjs/core'

export class MyPackageProvider extends ServiceProvider {
  async boot() {
    appendToGroup('web', myWebOnlyMiddleware)
  }
}
```

## Dynamic Provider Registration

Providers can register other providers at runtime — useful for modules, conditional features, and package composition:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { cache } from '@rudderjs/cache'
import { panels } from '@rudderjs/panels'
import { adminPanel } from '../Panels/Admin/AdminPanel.js'

export class AppServiceProvider extends ServiceProvider {
  register() {
    // Static sub-provider
  }

  async boot() {
    // Register panels from your own provider
    await this.app.register(panels([adminPanel]))

    // Conditional features
    const config = this.app.make<{ get(k: string): unknown }>('config')
    if (config.get('cache.enabled')) {
      await this.app.register(cache(cacheConfig))
    }
  }
}
```

`register()` calls the provider's `register()` immediately so bindings are available. If the app is already booted, `boot()` runs too. Duplicate providers (by class reference or class name) are silently skipped.

## Publishing Assets

Service providers can declare publishable assets (pages, config files, migrations) that users copy into their app with `pnpm rudder vendor:publish`.

```ts
import { ServiceProvider } from '@rudderjs/core'

export class MyPackageServiceProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    this.publishes({
      from: new URL('../pages', import.meta.url).pathname,
      to:   'pages/(panels)',
      tag:  'my-package-pages',
    })
  }
}
```

Multiple groups with different tags:

```ts
this.publishes([
  { from: new URL('../pages', import.meta.url).pathname, to: 'pages/(panels)', tag: 'my-pages' },
  { from: new URL('../config', import.meta.url).pathname, to: 'config',        tag: 'my-config' },
])
```

Users publish with:

```bash
pnpm rudder vendor:publish --tag=my-package-pages
pnpm rudder vendor:publish --provider=MyPackageServiceProvider
pnpm rudder vendor:publish --list   # see all available assets
```

## Events

```ts
import { dispatch, dispatcher, events } from '@rudderjs/core'

// Define an event
class UserCreated {
  constructor(public readonly id: number) {}
}

// Define a listener
class SendWelcomeEmail {
  async handle(event: UserCreated) {
    await mailer.send(event.id)
  }
}

// Register via provider in bootstrap/providers.ts
import { events } from '@rudderjs/core'
export default [
  events({ UserCreated: [SendWelcomeEmail] }),
]

// Dispatch anywhere
await dispatch(new UserCreated(42))
```

### `EventDispatcher` API

| Method | Description |
|--------|-------------|
| `register(name, ...listeners)` | Register listeners for an event name. Use `'*'` for wildcard (all events). |
| `dispatch(event)` | Dispatch to matching listeners, then wildcard listeners. Awaited in order. |
| `count(name)` | Number of listeners for an event name. |
| `hasListeners(name)` | `true` if at least one listener is registered. |
| `list()` | `Record<string, number>` snapshot of all registered events and counts. |
| `reset()` | Clear all listeners (testing / hot-reload). |

## Exception Handling

### `abort()` helpers

Throw an `HttpException` from anywhere — routes, services, middleware:

```ts
import { abort, abort_if, abort_unless } from '@rudderjs/core'

abort(404)                            // throws HttpException(404, 'Not Found')
abort(403, 'Insufficient permissions')
abort(402, 'Payment required', { 'X-Upgrade-URL': '/billing' })

abort_if(!user, 401)                  // abort if condition is true
abort_unless(user.isAdmin, 403)       // abort if condition is false
```

`HttpException` is caught automatically and rendered as JSON or HTML based on the request's `Accept` header — no `try/catch` needed.

### `report()` helpers

Manually report an error without aborting the request:

```ts
import { report, report_if } from '@rudderjs/core'

report(new Error('Stripe webhook failed'))
report_if(payment.failed, payment.error)
```

When `@rudderjs/log` is installed, `report()` routes through the log channel automatically. Otherwise it falls back to `console.error`.

### `withExceptions` configurator

```ts
.withExceptions((e) => {
  // Custom error type → custom Response
  e.render(PaymentError, (err, req) =>
    Response.json({ code: err.code }, { status: 402 })
  )

  // Override the reporter (default: @rudderjs/log or console.error)
  e.reportUsing((err) => Sentry.captureException(err))

  // Re-throw to the server's native fallback handler
  e.ignore(DebugOnlyError)
})
```

### Built-in handling (no configuration needed)

| Error type | Response |
|---|---|
| `ValidationError` | `422` JSON `{ message, errors }` |
| `HttpException` | Status from `statusCode`, JSON or HTML based on `Accept` |
| Unhandled error | Reported via reporter, then `500` (with stack in debug mode) |

## Notes

- `Application.create()` is singleton-based and can recreate in development/local mode when config is passed.
- `RudderJS.boot()` boots providers; `RudderJS.handleRequest()` lazily creates the HTTP handler.
- `ValidationError` is always caught and returned as 422 JSON — no try/catch needed in routes.
- `HttpException` is always caught and rendered with its status code — no try/catch needed in routes.
- Unhandled errors are auto-reported and render as 500. In `debug` mode the response includes the exception message and stack trace.
