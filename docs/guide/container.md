# Service Container

The service container is the heart of RudderJS. It is a powerful dependency-injection container that resolves classes and their dependencies for you, supports constructor injection via TypeScript decorators, and is the same instance used by every part of the framework.

```ts
import 'reflect-metadata'
import { Injectable, app } from '@rudderjs/core'

@Injectable()
class Logger {
  log(message: string) { console.log(message) }
}

@Injectable()
class UserService {
  constructor(private readonly logger: Logger) {}
  greet(name: string) { this.logger.log(`Hello, ${name}!`) }
}

const service = app().make(UserService)
service.greet('Alice')
```

`reflect-metadata` must be imported once at your entry point (`bootstrap/app.ts`), and `experimentalDecorators: true` + `emitDecoratorMetadata: true` must be set in `tsconfig.json`. Both are present in scaffolded apps.

## Binding

Three ways to register something with the container:

```ts
// Transient — new instance on every make()
app().bind(MyService, (c) => new MyService(c.make(Logger)))

// Singleton — same instance every time
app().singleton(DatabaseService, (c) => new DatabaseService())

// Pre-built instance
app().instance('config.app', { name: 'MyApp', debug: true })
```

`app()` returns the global container. Inside a service provider, prefer `this.app` — it points at the same container.

### Aliases

Multiple keys can resolve to the same binding:

```ts
app().alias('log', Logger)
const logger = app().make<Logger>('log')
```

### Existence checks

```ts
if (app().has(UserService)) {
  // …
}
```

## Resolving

`make()` resolves a binding. For `@Injectable` classes without an explicit binding, the container auto-constructs them by reading TypeScript's metadata to discover constructor parameter types:

```ts
const service = app().make(UserService)
const name    = app().make<string>('app.name')
```

When a constructor parameter has no runtime type — primitives, interfaces, string tokens — use `@Inject(token)`:

```ts
import { Injectable, Inject } from '@rudderjs/core'

@Injectable()
class GreetingService {
  constructor(
    @Inject('app.name') private readonly appName: string,
  ) {}
}

app().instance('app.name', 'MyApp')
const svc = app().make(GreetingService)
```

## Conditional binding

`bindIf()`, `singletonIf()`, and `scopedIf()` register a binding **only when the token is currently unbound**. They let framework providers register a sane default that the app can override by binding the same token first:

```ts
// Inside CacheServiceProvider.register()
this.app.singletonIf(CacheManager, (c) => new CacheManager(c.make(ConfigRepo)))
```

If an app provider already bound `CacheManager` before this provider runs, the framework default is skipped — no ad-hoc `if (!app.has(...))` dance.

## Tagging

Group bindings under one or more tag names, then resolve them all at once. Useful for plugin fan-out — exporters, channels, notification recorders:

```ts
app().bind('csv.exporter',  () => new CsvExporter())
app().bind('xlsx.exporter', () => new XlsxExporter())
app().bind('json.exporter', () => new JsonExporter())

// Tag a list of tokens under one tag…
app().tag(['csv.exporter', 'xlsx.exporter', 'json.exporter'], 'reports.exporters')

// …or tag one token under multiple tags additively.
app().tag('json.exporter', ['reports.exporters', 'serializers.json'])

const exporters = app().tagged<Exporter>('reports.exporters')
// → [CsvExporter, XlsxExporter, JsonExporter] in insertion order
```

`tagged()` returns `[]` for unknown tags — no throw. Singletons stay singletons across multiple `tagged()` calls. Tagging an unbound token is allowed; `tagged()` will throw the standard "cannot resolve" error when that one is asked for.

For constructor injection, decorate a parameter with `@Tag(name)`:

```ts
import { Injectable, Tag } from '@rudderjs/core'

@Injectable()
class ReportRunner {
  constructor(@Tag('reports.exporters') private exporters: Exporter[]) {}
}
```

For contextual binding, pair the `tagToken()` sentinel with `when().needs().give()` to filter or transform the resolved set:

```ts
import { tagToken } from '@rudderjs/core'

app().when(ReportRunner)
  .needs(tagToken('reports.exporters'))
  .give((c) => c.tagged<Exporter>('reports.exporters').filter((e) => e.enabled))
```

`@Tag` is constructor-only. Method-parameter metadata is dropped by esbuild/Vite, so method-level `@Tag` won't work — see the Tips section.

## Extending bindings

`extend()` wraps the resolved value with a decorator function — useful for telemetry, tracing, or feature flags without subclassing:

```ts
app().singleton(Logger, () => new ConsoleLogger())

app().extend<Logger>(Logger, (logger, c) =>
  new TelescopeLoggerProxy(logger, c.make(Telescope))
)
```

Multiple `extend()` calls chain in registration order. Singletons cache the wrapped value (extenders run once); transient bindings re-wrap on every `make()`; scoped bindings re-wrap once per request scope. If a value is already cached when `extend()` is called, the new extender wraps it eagerly so consumers that already resolved the token see the wrapped value on their next `make()`.

## Rebinding hooks

`rebinding()` registers a listener that fires when an existing binding is **replaced** — useful for test hot-swaps and pre-resolved consumers that need to pick up the new instance:

```ts
app().singleton(Mailer, () => new SesMailer())

app().rebinding<Mailer>(Mailer, (newInstance, c) => {
  c.make(MailQueue).rewire(newInstance)
})

// In a test:
app().instance(Mailer, new FakeMailer())  // listener fires synchronously with FakeMailer
```

Listeners do **not** fire on the initial bind — only when an already-bound token is rebound via `bind` / `singleton` / `scoped` / `instance`. The listener receives the freshly-resolved value, not the stale singleton cache.

## Container lifecycle

The container is created once when `Application.configure(...).create()` runs and lives for the entire process. Service providers populate it during boot; route handlers and services resolve from it on demand.

The container is **synchronous**. If you need async setup (open a connection, run a migration), do it in a service provider's `boot()` hook — `boot()` can be `async`, `register()` cannot.

For per-request state, do **not** mutate the container or store request data on a singleton. Use AsyncLocalStorage instead — see [Request Lifecycle](/guide/lifecycle).

## Using the container in providers

`ServiceProvider.register()` and `boot()` both receive `this.app` — the container:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { UserService } from '../Services/UserService.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(UserService, () => new UserService())
  }

  async boot(): Promise<void> {
    const service = this.app.make(UserService)
    await service.warmUp()
  }
}
```

Resolve other bindings only inside `boot()` — during `register()` other providers may not have run yet, and the binding you want may not exist.

## Using the container in controllers

Decorator-based controllers receive their dependencies via constructor injection. The container resolves them automatically:

```ts
import { Controller, Get } from '@rudderjs/router'
import { Injectable } from '@rudderjs/core'
import { UserService } from '../Services/UserService.js'

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

## Container API reference

All mutating methods return `this` for fluent chaining. Tokens can be a `string`, `symbol`, or class constructor (keyed by class name).

| Method | Description |
|---|---|
| `bind(token, factory)` | Factory binding — new instance on every `make()`. Factory receives the container as its argument. |
| `singleton(token, factory)` | Singleton — factory runs once; result cached for subsequent calls. |
| `scoped(token, factory)` | Per-request singleton via AsyncLocalStorage — one instance per HTTP request scope. |
| `instance(token, value)` | Registers a pre-built value. Always returns the same object reference. |
| `bindIf` / `singletonIf` / `scopedIf` | Same as `bind` / `singleton` / `scoped` but only when the token is currently unbound. |
| `tag(tokens, tags)` | Adds one or more tokens to one or more tag names. Additive across calls. |
| `tagged<T>(tag)` | Resolves every token under `tag` in insertion order. Returns `[]` for unknown tags. |
| `extend(token, fn)` | Wraps the resolved value with a decorator. Chains in registration order. |
| `rebinding(token, listener)` | Fires when an existing binding is replaced. Does NOT fire on initial bind. |
| `alias(from, to)` | Maps the string `from` to `to`. `make(from)` resolves `to`. |
| `make<T>(token)` | Resolves the token. If the token is an `@Injectable` class with no explicit binding, auto-resolves via constructor metadata. Throws if no binding is found. |
| `has(token)` | `true` if the token (or its alias target) has a binding or instance registered. |
| `forget(token)` | Removes the binding and any cached singleton instance. |
| `reset()` | Clears all bindings, instances, and aliases. |

## Tips

- Always import `reflect-metadata` once at the entry point. Install it as a regular dependency, not a devDependency.
- `@Injectable()` is required for auto-resolution. Classes without it must be explicitly bound.
- Method-level decorators **do not** preserve metadata under Vite/esbuild. Method-level DI must take explicit tokens — never rely on reflection at the method level.
