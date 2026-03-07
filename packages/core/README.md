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

## Notes

- `Application.create()` is singleton-based and can recreate in development/local mode when config is passed.
- `BoostKit.boot()` boots providers; `BoostKit.handleRequest()` lazily creates the HTTP handler.
