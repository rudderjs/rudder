# @forge/di

Dependency injection container with decorators for constructor injection.

```bash
pnpm add @forge/di
```

> `reflect-metadata` must also be installed as a regular dependency and imported once at your application entry point.

```bash
pnpm add reflect-metadata
```

---

## Usage

### @Injectable and @Inject

Mark a class with `@Injectable()` to allow the container to auto-resolve it. Use `@Inject(token)` to override a specific constructor parameter's resolution token.

```ts
import 'reflect-metadata'
import { Injectable, Inject, container } from '@forge/di'

@Injectable()
class DatabaseConnection {
  connect() { /* ... */ }
}

@Injectable()
class UserRepository {
  constructor(private db: DatabaseConnection) {}

  findAll() {
    this.db.connect()
    // ...
  }
}

@Injectable()
class UserService {
  constructor(
    private repo: UserRepository,
    @Inject('config') private config: Record<string, unknown>,
  ) {}
}

// Bind a plain value under a string token
container.instance('config', { host: 'localhost' })

// Auto-resolve — DatabaseConnection and UserRepository are injected automatically
const service = container.make(UserService)
```

### Manual Bindings

```ts
import { container } from '@forge/di'
import { PaymentService } from './PaymentService.js'
import { StripePaymentService } from './StripePaymentService.js'

// Factory binding — new instance every call
container.bind(PaymentService, () => new StripePaymentService())

// Singleton — same instance every call
container.singleton(PaymentService, (c) => new StripePaymentService())

// Pre-built instance
container.instance(PaymentService, new StripePaymentService())

// Alias — resolve 'payment' as PaymentService
container.alias('payment', PaymentService)

const svc = container.make<PaymentService>('payment')
```

---

## Container API

The global `container` singleton (and any `Container` instance) exposes the following methods.

| Method | Signature | Description |
|---|---|---|
| `bind` | `(token, factory: (c: Container) => T) => void` | Registers a factory. A new instance is created on every `make()` call. |
| `singleton` | `(token, factory: (c: Container) => T) => void` | Registers a singleton factory. The instance is created once and cached. |
| `instance` | `(token, value: T) => void` | Registers a pre-built value. Always returns the same object. |
| `alias` | `(alias, target) => void` | Maps `alias` to `target`. `make(alias)` resolves `target`. |
| `make<T>` | `(token) => T` | Resolves `token` from the container. If the token is an `@Injectable` class with no explicit binding, it is auto-resolved via constructor metadata. |
| `has` | `(token) => boolean` | Returns `true` if `token` has a binding, instance, or alias registered. |
| `forget` | `(token) => void` | Removes the binding for `token`. |
| `reset` | `() => void` | Clears all bindings, instances, and aliases from the container. |

---

## @Injectable()

```ts
@Injectable()
class MyService { ... }
```

Decorating a class with `@Injectable()` instructs the container to use TypeScript constructor metadata (emitted by `emitDecoratorMetadata`) for auto-resolution. Without this decorator, `container.make(MyService)` will throw if no explicit binding exists.

---

## @Inject(token)

```ts
constructor(@Inject('redis') private cache: CacheClient) {}
```

Overrides the resolution token for a specific constructor parameter. Use this when the parameter type is an interface (erased at runtime), a primitive, or a string-keyed binding.

---

## container Global Singleton

`container` is a module-level singleton stored on `globalThis.__forge_container__`. It is shared across the entire process, including dynamic imports and hot-module boundaries. All service providers and the `app()` / `resolve()` helpers from `@forge/core` use this same instance.

---

## Notes

- `reflect-metadata` must be imported **once**, at the very top of your application entry point (e.g. `src/index.ts`), before any other imports that use decorators. Importing it in individual service files is not sufficient.
- Install `reflect-metadata` as a regular dependency (`pnpm add reflect-metadata`), not a devDependency. It is required at runtime.
- Enable `experimentalDecorators: true` and `emitDecoratorMetadata: true` in your `tsconfig.json`.
- This package has `sideEffects: ["./dist/index.js"]` — it registers decorator metadata at import time and cannot be fully tree-shaken.
