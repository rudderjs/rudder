# @boostkit/core

Application bootstrap, service provider lifecycle, and framework-level runtime orchestration.

## Installation

```bash
pnpm add @boostkit/core
```

## Usage

```ts
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import { RateLimit } from '@boostkit/middleware'

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

- `ServiceProvider`
- `Listener`, `EventDispatcher`, `dispatcher`, `dispatch()`, `events()`
- `Application`, `AppConfig`
- `ConfigureOptions`, `RoutingOptions`
- `MiddlewareConfigurator`, `ExceptionConfigurator`
- `AppBuilder`, `BoostKit`
- `app()`, `resolve()`
- `defineConfig()`
- Re-exports from `@boostkit/artisan`, `@boostkit/support`, and `@boostkit/contracts` types plus built-in DI and Events primitives

## Configuration

- `AppConfig`
  - `name?`, `env?`, `debug?`
  - `providers?`
  - `config?` (config object bound into the container)
- `ConfigureOptions`
  - `server`, `config?`, `providers?`

## Events

```ts
import { dispatch, dispatcher, events } from '@boostkit/core'

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
import { events } from '@boostkit/core'
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
- `BoostKit.boot()` boots providers; `BoostKit.handleRequest()` lazily creates the HTTP handler.
- `ValidationError` is always caught by the exception handler and returned as 422 JSON — no try/catch needed in routes.
