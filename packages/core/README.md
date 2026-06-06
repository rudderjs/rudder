# @rudderjs/core

Application bootstrap, service provider lifecycle, and framework-level runtime orchestration.

## Installation

```bash
pnpm add @rudderjs/core
```

## Usage

```ts
import { Application } from '@rudderjs/core'
import { RateLimit } from '@rudderjs/middleware'

// The HTTP adapter is auto-resolved (@rudderjs/server-hono + config('server')).
// Pass `server: hono(config.server)` explicitly to override.
export default Application.configure({ config, providers })
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
- `Listener`, `EventDispatcher`, `dispatcher`, `dispatch()`, `eventsProvider()`
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
- Re-exports from `@rudderjs/console`, `@rudderjs/support`, and `@rudderjs/contracts` types plus built-in DI and Events primitives

## Configuration

- `AppConfig`
  - `name?`, `env?`, `debug?`
  - `providers?`
  - `config?` (config object bound into the container)
- `ConfigureOptions`
  - `server`, `config?`, `providers?`

## Container

The DI `Container` is the heart of the framework — services bound here are resolvable via `@Inject()`, contextual bindings (`when().needs().give()`), and direct `make()` calls. Beyond `bind` / `singleton` / `scoped` / `instance`, two convenience surfaces help framework providers and plugin-style fan-out:

### Conditional binding (`*If`)

`bindIf` / `singletonIf` / `scopedIf` register a binding only when the token is currently unbound. Lets framework providers register a sane default that an app provider can override by binding the same token first:

```ts
// Inside CacheServiceProvider.register()
this.app.singletonIf(CacheManager, c => new CacheManager(c.make(ConfigRepo)))
```

If an app provider already bound `CacheManager` before this provider registers, the framework default is skipped — no ad-hoc `if (!app.has(...))` dance.

### Tagging

Group bindings under one or more tag names, then resolve them all at once. Useful for plugin fan-out — exporters, channels, recorders:

```ts
container.bind('csv.exporter',  () => new CsvExporter())
container.bind('xlsx.exporter', () => new XlsxExporter())
container.bind('json.exporter', () => new JsonExporter())

container.tag(['csv.exporter', 'xlsx.exporter', 'json.exporter'], 'reports.exporters')
// or, additively:
container.tag('json.exporter', ['reports.exporters', 'serializers.json'])

const exporters = container.tagged<Exporter>('reports.exporters')
// → [CsvExporter, XlsxExporter, JsonExporter] — resolved in insertion order
```

`tagged()` returns `[]` for unknown tags (no throw). Singletons stay singletons across `tagged()` calls. Tagging an unbound token is allowed — `tagged()` will throw the standard "cannot resolve" error when one is asked for, matching Laravel's behavior.

For constructor-time injection, decorate a parameter with `@Tag(name)`:

```ts
import { Injectable, Tag } from '@rudderjs/core'

@Injectable()
class ReportRunner {
  constructor(@Tag('reports.exporters') private exporters: Exporter[]) {}
}
```

For contextual binding, pair the `tagToken()` sentinel with `when().needs().give()`:

```ts
import { tagToken } from '@rudderjs/core'

container.when(ReportRunner)
  .needs(tagToken('reports.exporters'))
  .give(c => c.tagged<Exporter>('reports.exporters').filter(e => e.enabled))
```

`@Tag` is constructor-only — `design:paramtypes` metadata is dropped on method parameters by esbuild/Vite.

### Extending bindings

`extend()` wraps the resolved value with a decorator function. Useful for telemetry, tracing, or feature flags without subclassing:

```ts
container.singleton(Logger, () => new ConsoleLogger())

container.extend<Logger>(Logger, (logger, c) =>
  new TelescopeLoggerProxy(logger, c.make(Telescope))
)
```

Multiple `extend()` calls chain in registration order. Singletons cache the wrapped value (extenders run once); transient bindings re-wrap on every `make()`; scoped bindings re-wrap once per scope. If a value is already cached when `extend()` is called, the new extender wraps it eagerly so consumers that already resolved the token see the wrap on their next `make()`.

### Rebinding hooks

`rebinding()` registers a listener that fires when an existing binding is replaced — useful for test hot-swaps and `app->refresh()` parity:

```ts
container.singleton(Mailer, () => new SesMailer())

container.rebinding<Mailer>(Mailer, (newInstance, c) => {
  c.make(MailQueue).rewire(newInstance)
})

// In a test:
container.instance(Mailer, new FakeMailer())   // listener fires synchronously with the FakeMailer
```

Listeners do **not** fire on the initial bind — only when an already-bound token is rebound via `bind` / `singleton` / `scoped` / `instance`. The listener receives the freshly-resolved value, not the stale singleton cache.

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
import { CacheProvider } from '@rudderjs/cache'

export class AppServiceProvider extends ServiceProvider {
  register() {
    // Static sub-provider
  }

  async boot() {
    // Conditional features — register a sub-provider only when configured
    const config = this.app.make<{ get(k: string): unknown }>('config')
    if (config.get('cache.enabled')) {
      await this.app.register(CacheProvider)
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
import { dispatch, dispatcher, eventsProvider } from '@rudderjs/core'

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
import { eventsProvider } from '@rudderjs/core'
export default [
  eventsProvider({ UserCreated: [SendWelcomeEmail] }),
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

### Testing events (`EventFake`)

```ts
import { EventFake, dispatch } from '@rudderjs/core'

const fake = EventFake.fake()
await dispatch(new UserCreated(42))

fake.assertDispatched('UserCreated')
fake.assertDispatchedTimes('UserCreated', 1)
fake.assertNotDispatched('OrderPlaced')
fake.restore() // always call in afterEach
```

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
| `ValidationResponse` | The wrapped `Response` is emitted directly (used by `FormRequest.failedValidation()` short-circuit) |
| `HttpException` | Status from `statusCode`, JSON or HTML based on `Accept` |
| Unhandled error | Reported via reporter, then `500` (with stack in debug mode) |

## FormRequest

Subclass `FormRequest`, define a Zod schema in `rules()`, and call `validate(req)`. The merged `body + query + params` flows through five optional lifecycle hooks that mirror Laravel's `FormRequest`:

```ts
import { FormRequest, z } from '@rudderjs/core'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
})

class StoreUser extends FormRequest<typeof schema> {
  rules() { return schema }

  // Mutate input before parsing — sync only.
  protected override prepareForValidation(input: Record<string, unknown>) {
    if (typeof input['email'] === 'string') input['email'] = input['email'].toLowerCase().trim()
  }

  // Per-request message overrides keyed by dot-path. Static string OR function.
  protected override messages() {
    return {
      email:    'Please enter a valid email address.',
      password: (issue: z.core.$ZodRawIssue) =>
        issue.code === 'too_small' ? 'Min 8 characters.' : 'Invalid password.',
    }
  }

  // Cross-field checks against parsed data. Run serially after parse; collect all errors.
  protected override after() {
    return [
      ({ data, addError }) => {
        if (data.email.endsWith('@example.com')) addError('email', 'No example.com addresses')
      },
    ]
  }

  // Final transform after all checks pass; return value replaces resolved data.
  protected override async passedValidation(data: z.infer<typeof schema>) {
    return { ...data, password: await Bcrypt.hash(data.password) }
  }

  // Customize the failure path. Default throws `ValidationError`; return a `Response` to short-circuit.
  protected override failedValidation(errors: Record<string, string[]>): never {
    throw new ValidationError(errors)
  }
}
```

**Pipeline order:** `prepareForValidation → authorize → rules.parse → after → passedValidation`. Both Zod parse failures and `after()` errors converge through `failedValidation(errors)`.

**Short-circuit responses:** `failedValidation` may `return` a Web `Response` to bypass the default 422 — the framework's exception handler unwraps the `ValidationResponse` sentinel and emits the wrapped Response directly.

**Type inference:** parameterize the class with the schema type (`extends FormRequest<typeof schema>`) so `data` in `after()`/`passedValidation` is inferred as `z.infer<typeof schema>`. Without the parameter, `data` is typed as `unknown`.

## Notes

- `Application.create()` is singleton-based and can recreate in development/local mode when config is passed.
- `RudderJS.boot()` boots providers; `RudderJS.handleRequest()` lazily creates the HTTP handler.
- `ValidationError` is always caught and returned as 422 JSON — no try/catch needed in routes.
- `HttpException` is always caught and rendered with its status code — no try/catch needed in routes.
- Unhandled errors are auto-reported and render as 500. In `debug` mode the response includes the exception message and stack trace.
