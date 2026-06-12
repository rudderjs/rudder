# Dynamic Provider Registration

Providers can be registered at runtime using `app().register()`. This is useful when a provider needs to conditionally register other providers during its own `boot()` phase.

## API

```ts
import { app } from '@rudderjs/core'

app().register(MyServiceProvider)
```

**Behavior:**

- Calls `register()` on the provider immediately.
- If the app is already booted (or currently booting), calls `boot()` immediately as well.
- **Duplicate guard** -- skips if a provider with the same class reference or class name is already registered.

## Use Cases

### Module self-registration

An `AppServiceProvider` can register feature modules conditionally:

```ts
// app/Providers/AppServiceProvider.ts
import { app } from '@rudderjs/core'
import { TodoServiceProvider } from '../Modules/Todo/TodoServiceProvider.js'
import { ReportingServiceProvider } from '../Modules/Reporting/ReportingServiceProvider.js'

export class AppServiceProvider {
  async boot() {
    await app().register(TodoServiceProvider)
    await app().register(ReportingServiceProvider)
  }
}
```

### Plugin factories

A plugin factory can dynamically register child providers when its own boot runs. A typical shape: a top-level `panels()` (or similar) factory accepts an extensions array and calls `app().register()` for each extension during its boot phase, so apps can opt into media, workspaces, lexical, etc. without wiring them up in `providers.ts` directly.

### Conditional features

Register providers only when certain conditions are met:

```ts
export class AppServiceProvider {
  async boot() {
    if (Env.get('ENABLE_ANALYTICS')) {
      const { AnalyticsProvider } = await import('../Providers/AnalyticsProvider.js')
      await app().register(AnalyticsProvider)
    }
  }
}
```

## Notes

- The duplicate guard uses both class reference equality and `constructor.name` string matching. This prevents double-registration even when the same provider is referenced from multiple code paths.
- Dynamic registration follows the same lifecycle as static providers: `register()` runs first, then `boot()`.
- If `boot()` throws, the error propagates to the caller -- it is not silently swallowed.
