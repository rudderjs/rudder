# Dependency Injection

BoostKit includes a lightweight but powerful DI container (part of `@boostkit/core`) with support for constructor injection using TypeScript decorators.

## Quick Start

```ts
import 'reflect-metadata'
import { Container, Injectable, Inject } from '@boostkit/core'

@Injectable()
class Logger {
  log(message: string) { console.log(message) }
}

@Injectable()
class UserService {
  constructor(private readonly logger: Logger) {}

  greet(name: string) {
    this.logger.log(`Hello, ${name}!`)
  }
}

const container = new Container()
const service = container.make(UserService)
service.greet('Alice')  // → Hello, Alice!
```

## The `@Injectable()` Decorator

Mark any class with `@Injectable()` to enable auto-resolution:

```ts
@Injectable()
class EmailService {
  constructor(private readonly config: Config, private readonly logger: Logger) {}
}
```

The container reads TypeScript metadata to discover constructor parameter types and resolves them automatically. This requires:

1. `reflect-metadata` imported once at your **entry point** (`src/index.ts`)
2. `experimentalDecorators: true` and `emitDecoratorMetadata: true` in `tsconfig.json`

## The `@Inject(token)` Decorator

When a constructor parameter is a primitive or interface (which has no runtime type), use `@Inject(token)` to specify the binding key:

```ts
@Injectable()
class GreetingService {
  constructor(
    @Inject('app.name') private readonly appName: string,
  ) {}

  greet() { return `Welcome to ${this.appName}!` }
}

container.instance('app.name', 'MyApp')
const svc = container.make(GreetingService)
```

## Container API

### `container.bind(token, factory)`

Registers a binding that creates a **new instance** on every `make()` call:

```ts
container.bind(MyService, (c) => new MyService(c.make(Logger)))
```

### `container.singleton(token, factory)`

Registers a binding that creates the instance **once** and caches it:

```ts
container.singleton(DatabaseService, (c) => new DatabaseService(c.make(Logger)))
```

### `container.instance(token, value)`

Binds an already-created instance directly:

```ts
container.instance('config.app', { name: 'MyApp', debug: true })
container.instance(Logger, new Logger())
```

### `container.make(token)`

Resolves a binding. For `@Injectable` classes without an explicit binding, the container auto-constructs them:

```ts
const service = container.make(UserService)
const name    = container.make<string>('app.name')
```

### `container.alias(alias, target)`

Creates an alias so multiple keys resolve the same binding:

```ts
container.alias('log', Logger)
const logger = container.make<Logger>('log')
```

### `container.has(token)`

Checks whether a binding is registered:

```ts
if (container.has(UserService)) {
  const svc = container.make(UserService)
}
```

### `container.forget(token)` / `container.reset()`

Remove a specific binding or clear all bindings:

```ts
container.forget(UserService)
container.reset()
```

## Global Container

BoostKit exports a **global container singleton** that is the same instance used by the application. Use `app()` to access it anywhere after boot:

```ts
import { app } from '@boostkit/core'

const service = app().make(UserService)
```

## Using DI in Service Providers

The `register()` and `boot()` lifecycle hooks receive `this.app` — the application container:

```ts
export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
  }

  boot(): void {
    const service = this.app.make(UserService)
    service.warmUp()
  }
}
```

## Using DI in Controllers

When using decorator-based controllers, the container resolves constructor parameters:

```ts
@Controller('/users')
@Injectable()
class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('/')
  async index() {
    return { data: await this.userService.all() }
  }
}

router.registerController(UserController)
```

## Notes

- Always import `reflect-metadata` **once** at the entry point — `src/index.ts`
- Install `reflect-metadata` as a regular dependency (not devDependency)
- `@Injectable()` is required for auto-resolution; classes without it must be explicitly bound
- The container is synchronous; async setup should be done in `ServiceProvider.boot()`
