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

export default Application.configure({
  server: hono({ port: 3000 }),
  providers: [],
})
  .withRouting({ api: () => import('../routes/api.js') })
  .withMiddleware(() => {})
  .withExceptions(() => {})
  .create()
```

## API Reference

- `ServiceProvider`
- `Application`, `AppConfig`
- `ConfigureOptions`, `RoutingOptions`
- `MiddlewareConfigurator`, `ExceptionConfigurator`
- `AppBuilder`, `BoostKit`
- `app()`, `resolve()`
- `defineConfig()`
- Re-exports from `@boostkit/artisan`, `@boostkit/di`, `@boostkit/support`, and `@boostkit/contracts` types

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
