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
    m.use(RateLimit.perMinute(60))
  })
  .withExceptions((e) => {
    e.render(PaymentError, (err) =>
      new Response(JSON.stringify({ code: err.code }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    // ValidationError → 422 JSON is handled automatically — no need to register it
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
- `AppBuilder`, `RudderJS`
- `app()`, `resolve()`
- `defineConfig()`
- Re-exports from `@rudderjs/rudder`, `@rudderjs/support`, and `@rudderjs/contracts` types plus built-in DI and Events primitives

## Configuration

- `AppConfig`
  - `name?`, `env?`, `debug?`
  - `providers?`
  - `config?` (config object bound into the container)
- `ConfigureOptions`
  - `server`, `config?`, `providers?`

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

```ts
.withExceptions((e) => {
  // Custom error type → custom response
  e.render(PaymentError, (err) =>
    new Response(JSON.stringify({ code: err.code }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    })
  )

  // Re-throw to surface in dev error page / 500 in prod
  e.ignore(InternalDebugError)

  // ValidationError → 422 JSON is handled automatically
})
```

## Notes

- `Application.create()` is singleton-based and can recreate in development/local mode when config is passed.
- `RudderJS.boot()` boots providers; `RudderJS.handleRequest()` lazily creates the HTTP handler.
- `ValidationError` is always caught by the exception handler and returned as 422 JSON — no try/catch needed in routes.
