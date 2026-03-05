# @boostkit/di

Dependency injection container with decorator-based constructor injection.

## Installation

```bash
pnpm add @boostkit/di reflect-metadata
```

> `reflect-metadata` must be a regular dependency (not devDependency) and imported once at your application entry point before any decorated class is loaded.

---

## Setup

Enable decorator metadata in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` at the top of your entry point:

```ts
import 'reflect-metadata'
```

---

## Decorators

### `@Injectable()`

Marks a class for automatic constructor resolution. The container reads TypeScript's emitted `design:paramtypes` metadata to inject dependencies.

```ts
import { Injectable, container } from '@boostkit/di'

@Injectable()
class Logger {
  log(msg: string) { console.log(msg) }
}

@Injectable()
class UserService {
  constructor(private logger: Logger) {}
}

const svc = container.make(UserService)
// Logger is auto-resolved and injected
```

Without `@Injectable()`, `container.make(MyClass)` throws if no explicit binding exists.

### `@Inject(token)`

Overrides the resolution token for a specific constructor parameter. Use this when the parameter type is an interface (erased at runtime), a primitive, or a string/symbol-keyed binding.

```ts
@Injectable()
class UserService {
  constructor(
    private logger: Logger,
    @Inject('config') private config: AppConfig,
  ) {}
}

container.instance('config', { host: 'localhost' })
container.make(UserService)
```

---

## Container API

All mutating methods return `this` for fluent chaining.

```ts
container
  .bind(PaymentService, () => new StripePaymentService())
  .singleton('mailer', c => new Mailer(c.make('config')))
  .instance('app.name', 'BoostKit')
  .alias('payment', PaymentService)
```

| Method | Description |
|---|---|
| `bind(token, factory)` | Factory binding — new instance on every `make()`. |
| `singleton(token, factory)` | Singleton — factory runs once, result is cached. |
| `instance(token, value)` | Registers a pre-built value. Always returns the same object. |
| `alias(from, to)` | Maps `from` to `to` — `make(from)` resolves `to`. |
| `make<T>(token)` | Resolves the token. Auto-resolves `@Injectable` classes with no explicit binding. |
| `has(token)` | `true` if the token (or its alias target) has a binding or instance. |
| `forget(token)` | Removes the binding and cached instance for the token. |
| `reset()` | Clears all bindings, instances, and aliases. |

Tokens can be a `string`, `symbol`, or a `Constructor` (keyed by class name).

---

## Global `container`

`container` is a module-level singleton exported from `@boostkit/di` and re-exported from `@boostkit/core`. All service providers, `app().make()`, and `resolve()` use this same instance.

```ts
import { container } from '@boostkit/di'
// or
import { container } from '@boostkit/core'
```

---

## Notes

- `reflect-metadata` must be imported **once at the entry point** before any decorated class is loaded. Importing it inside individual files is not reliable.
- `@Injectable()` requires `emitDecoratorMetadata: true` — without it, `design:paramtypes` is not emitted and auto-resolution will not work.
- `sideEffects: ["./dist/index.js"]` — this package registers metadata at import time and cannot be fully tree-shaken.
