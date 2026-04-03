# Dynamic Provider Registration

Providers can be registered at runtime using `app.register()`. This is useful when a provider needs to conditionally register other providers during its own `boot()` phase.

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
import { PanelServiceProvider } from '@rudderjs/panels'
import { TodoServiceProvider } from '../Modules/Todo/TodoServiceProvider.js'

export class AppServiceProvider {
  async boot() {
    app().register(PanelServiceProvider)
    app().register(TodoServiceProvider)
  }
}
```

### Panels extensions

The `panels()` factory accepts an extensions array. Each extension is a provider that gets dynamically registered when panels boots:

```ts
// bootstrap/providers.ts
import { panels } from '@rudderjs/panels'
import { media } from '@rudderjs/media'
import { AdminPanel } from '../app/Panels/AdminPanel.js'

export default [
  panels([AdminPanel], [
    media({ conversions: [...] }),
  ]),
]
```

Under the hood, `panels()` calls `app().register()` for each extension provider during its own boot phase.

### Conditional features

Register providers only when certain conditions are met:

```ts
export class AppServiceProvider {
  async boot() {
    if (Env.get('ENABLE_ANALYTICS')) {
      const { AnalyticsProvider } = await import('../Providers/AnalyticsProvider.js')
      app().register(AnalyticsProvider)
    }
  }
}
```

## Notes

- The duplicate guard uses both class reference equality and `constructor.name` string matching. This prevents double-registration even when the same provider is referenced from multiple code paths.
- Dynamic registration follows the same lifecycle as static providers: `register()` runs first, then `boot()`.
- If `boot()` throws, the error propagates to the caller -- it is not silently swallowed.
