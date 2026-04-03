# Dependency Injection (DI)

Dependency injection container with decorator-based constructor injection.

```bash
pnpm add @rudderjs/core reflect-metadata
```

> Install `reflect-metadata` as a regular dependency — it is required at runtime. Import it once at the top of your application entry point, before any other imports that use decorators.

---

## Setup

`tsconfig.json` must have:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`bootstrap/app.ts` (or equivalent entry point):

```ts
import 'reflect-metadata'
// all other imports follow
```

---

## `@Injectable()` and `@Inject(token)`

Mark a class with `@Injectable()` to allow the container to auto-resolve it from constructor parameter types. Use `@Inject(token)` to override a specific parameter's resolution key.

```ts
import { Injectable, Inject, container } from '@rudderjs/core'

@Injectable()
class DatabaseConnection {
  connect() { /* ... */ }
}

@Injectable()
class UserRepository {
  constructor(private db: DatabaseConnection) {}
}

@Injectable()
class UserService {
  constructor(
    private repo: UserRepository,
    @Inject('config') private config: Record<string, unknown>,
  ) {}
}

container.instance('config', { host: 'localhost' })

// DatabaseConnection and UserRepository are injected automatically
const service = container.make(UserService)
```

---

## Manual Bindings

```ts
import { container } from '@rudderjs/core'

// Factory — new instance on every make()
container.bind(PaymentService, () => new StripePaymentService())

// Singleton — created once, cached forever
container.singleton('mailer', c => new Mailer(c.make('config')))

// Pre-built value
container.instance('app.name', 'RudderJS')

// Alias — make('payment') resolves PaymentService
container.alias('payment', PaymentService)
container.make<PaymentService>('payment')
```

---

## Container API

All mutating methods return `this` for fluent chaining. Tokens can be a `string`, `symbol`, or `Constructor` (keyed by class name).

| Method | Description |
|---|---|
| `bind(token, factory)` | Factory binding — new instance on every `make()`. Factory receives the `Container` as its argument. |
| `singleton(token, factory)` | Singleton — factory runs once; result is cached for subsequent calls. |
| `instance(token, value)` | Registers a pre-built value. Always returns the same object reference. |
| `alias(from, to)` | Maps the string `from` to `to`. `make(from)` resolves `to`. |
| `make<T>(token)` | Resolves the token. If the token is an `@Injectable` class with no explicit binding, auto-resolves via constructor metadata. Throws if no binding is found. |
| `has(token)` | `true` if the token (or its alias target) has a binding or instance registered. |
| `forget(token)` | Removes the binding and any cached singleton instance for the token. Returns `this`. |
| `reset()` | Clears all bindings, instances, and aliases. Returns `this`. |

---

## `@Injectable()`

```ts
@Injectable()
class MyService { ... }
```

Decorating a class with `@Injectable()` instructs the container to read TypeScript's emitted `design:paramtypes` metadata for auto-resolution. Without this decorator, `container.make(MyClass)` throws unless an explicit binding exists.

---

## `@Inject(token)`

```ts
constructor(@Inject('redis') private cache: CacheClient) {}
```

Overrides the resolution token for a specific constructor parameter. Use this when the parameter type is an interface (erased at runtime), a primitive, or a string/symbol-keyed binding.

---

## `container` Global Singleton

`container` is a module-level singleton exported from `@rudderjs/core`. All service providers, `app().make()`, and `resolve()` use this same instance.

```ts
import { container } from '@rudderjs/core'

const service = container.make(UserService)
// equivalent to:
import { resolve } from '@rudderjs/core'
const service = resolve(UserService)
```

---

## Notes

- Import `reflect-metadata` **once at the entry point** before any decorated class is loaded. Importing it inside individual service files is not sufficient.
- `reflect-metadata` must be a regular dependency (`pnpm add reflect-metadata`), not a devDependency. It is required at runtime.
- Enable `experimentalDecorators: true` and `emitDecoratorMetadata: true` in your `tsconfig.json`.
- `sideEffects: ["./dist/index.js"]` — this package registers metadata at import time and cannot be fully tree-shaken.
